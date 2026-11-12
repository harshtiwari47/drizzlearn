import crypto from "node:crypto";
import { query } from "./db.js";
import { logger } from "./logger.js";

const LOCAL_EMBEDDING_DIMS = 128;
const LOCAL_EMBEDDING_MODEL = "local-hash-v1";
const REMOTE_EMBEDDING_MODEL = "gemini-embedding-001";
const REMOTE_EMBED_TIMEOUT_MS = 3_500;
const REMOTE_EMBED_COOLDOWN_MS = 120_000;
const VALID_SOURCE_TYPES = new Set(["note", "lesson", "flashcard", "practice_attempt"]);

const STOPWORDS = new Set([
  "a", "about", "an", "and", "are", "as", "at", "be", "been", "being", "but", "by",
  "can", "could", "did", "do", "does", "explain", "for", "from", "give", "had", "has",
  "have", "help", "hint", "how", "i", "if", "in", "into", "is", "it", "its", "lesson",
  "me", "my", "of", "on", "onto", "or", "please", "quiz", "review", "should", "show",
  "tell", "that", "the", "then", "these", "this", "those", "to", "was", "were", "what",
  "when", "where", "which", "who", "why", "with", "work", "would", "you", "your",
]);

let remoteEmbedCooldownUntil = 0;

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || "")).digest("hex");
}

function parseJsonSafe(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export function normalizeSourceType(type) {
  const raw = String(type || "").toLowerCase();
  if (raw === "practice" || raw === "attempt" || raw === "practice_attempt") return "practice_attempt";
  if (raw === "notes") return "note";
  if (raw === "lessons") return "lesson";
  if (raw === "flashcards") return "flashcard";
  return VALID_SOURCE_TYPES.has(raw) ? raw : "note";
}

export function toPublicSourceType(sourceType) {
  return sourceType === "practice_attempt" ? "practice" : sourceType;
}

export function formatCanonicalSourceId(sourceType, sourceId) {
  const normalized = normalizeSourceType(sourceType);
  if (normalized === "practice_attempt") return `attempt:${sourceId}`;
  return `${normalized}:${sourceId}`;
}

/**
 * Lightweight deterministic stemmer for English morphological normalization.
 */
function stemToken(word) {
  let w = String(word || "").toLowerCase();
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("tion") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ment") && w.length > 6) return w.slice(0, -4);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("ly") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

/**
 * Analyze a learner query into cleaned tokens, stems, and word bigrams.
 */
export function analyzeQuery(text) {
  const rawText = String(text || "").trim();
  const rawTokens = rawText.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  const meaningful = rawTokens.filter((token) => !STOPWORDS.has(token));
  const tokens = meaningful.length > 0 ? meaningful : rawTokens;
  const uniqueTokens = [...new Set(tokens)];
  const stems = [...new Set(uniqueTokens.map(stemToken))];
  const bigrams = [];
  for (let i = 0; i < tokens.length - 1 && bigrams.length < 14; i++) {
    bigrams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return { rawText, tokens, uniqueTokens, stems, bigrams: [...new Set(bigrams)] };
}

function splitOversizedText(text, maxChars, overlapChars) {
  const segments = String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const segment of segments) {
    if (segment.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      const step = Math.max(100, maxChars - overlapChars);
      for (let start = 0; start < segment.length; start += step) {
        const slice = segment.slice(start, start + maxChars).trim();
        if (slice) chunks.push(slice);
        if (start + maxChars >= segment.length) break;
      }
      continue;
    }

    const candidate = current ? `${current} ${segment}` : segment;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      chunks.push(current);
      const overlap = overlapChars > 0 ? current.slice(-overlapChars).trim() : "";
      current = overlap && overlap.length + 1 + segment.length <= maxChars ? `${overlap} ${segment}` : segment;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Structure-aware Markdown chunker preserving heading hierarchy and overlapping oversized segments.
 */
export function chunkDocument({ title = "", body = "", maxChars = 760, overlapChars = 120 } = {}) {
  const cleanTitle = String(title || "").trim();
  const normalizedBody = String(body || "").replace(/\r\n/g, "\n").trim();

  if (!cleanTitle && !normalizedBody) return [];
  if (!normalizedBody) {
    return [
      {
        chunkIndex: 0,
        heading: cleanTitle,
        content: cleanTitle,
        contentHash: sha256(cleanTitle),
      },
    ];
  }

  // Split by Markdown heading lines while capturing each heading
  const lines = normalizedBody.split("\n");
  const sections = [];
  let activeHeading = cleanTitle;
  let buffer = [];

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      const text = buffer.join("\n").trim();
      if (text) sections.push({ heading: activeHeading, text });
      activeHeading = headingMatch[1].trim();
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  const trailing = buffer.join("\n").trim();
  if (trailing) sections.push({ heading: activeHeading, text: trailing });
  if (sections.length === 0) sections.push({ heading: cleanTitle, text: normalizedBody });

  const rawChunks = [];
  for (const section of sections) {
    const prefix = section.heading && !section.text.startsWith(section.heading) ? `[${section.heading}]\n` : "";
    const paragraphs = section.text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    let current = "";
    for (const para of paragraphs) {
      const targetMax = Math.max(240, maxChars - prefix.length);
      if (para.length > targetMax) {
        if (current) {
          rawChunks.push({ heading: section.heading, content: `${prefix}${current}`.trim() });
          current = "";
        }
        const splitPieces = splitOversizedText(para, targetMax, overlapChars);
        for (const piece of splitPieces) {
          rawChunks.push({ heading: section.heading, content: `${prefix}${piece}`.trim() });
        }
        continue;
      }

      const candidate = current ? `${current}\n\n${para}` : para;
      if (candidate.length <= targetMax) {
        current = candidate;
      } else {
        rawChunks.push({ heading: section.heading, content: `${prefix}${current}`.trim() });
        const overlap = overlapChars > 0 ? current.slice(-overlapChars).trim() : "";
        current = overlap && overlap.length + 2 + para.length <= targetMax ? `${overlap}\n\n${para}` : para;
      }
    }

    if (current) {
      rawChunks.push({ heading: section.heading, content: `${prefix}${current}`.trim() });
    }
  }

  return rawChunks.map((chunk, index) => ({
    chunkIndex: index,
    heading: chunk.heading || cleanTitle,
    content: chunk.content,
    contentHash: sha256(`${cleanTitle}\n${chunk.content}`),
  }));
}

function fnv1a32(str, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function projectFeature(vec, feature, weight) {
  const dims = vec.length;
  const h1 = fnv1a32(feature, 0x811c9dc5);
  const h2 = fnv1a32(feature, 0x9e3779b9);
  const idx = h1 % dims;
  const sign = (h2 & 1) === 0 ? 1 : -1;
  vec[idx] += sign * weight;
}

/**
 * Compute a deterministic L2-normalized local semantic vector combining unigrams, stems, bigrams, and char 3-grams.
 */
export function computeLocalSemanticVector(text, dims = LOCAL_EMBEDDING_DIMS) {
  const vec = new Float64Array(dims);
  const analysis = analyzeQuery(text);
  const tokens = analysis.tokens;

  for (const token of tokens) {
    projectFeature(vec, `w:${token}`, 1.0);
    const stem = stemToken(token);
    if (stem !== token) {
      projectFeature(vec, `s:${stem}`, 0.85);
    }
    if (token.length >= 3) {
      const padded = `^${token}$`;
      for (let i = 0; i <= padded.length - 3; i++) {
        projectFeature(vec, `c:${padded.slice(i, i + 3)}`, 0.45);
      }
    }
  }

  for (const bigram of analysis.bigrams) {
    projectFeature(vec, `b:${bigram}`, 1.4);
  }

  let normSq = 0;
  for (let i = 0; i < dims; i++) normSq += vec[i] * vec[i];
  const norm = Math.sqrt(normSq);
  if (norm === 0) return Array.from(vec);

  const out = new Array(dims);
  for (let i = 0; i < dims; i++) {
    out[i] = Math.round((vec[i] / norm) * 1_000_000) / 1_000_000;
  }
  return out;
}

function remoteEmbeddingsPermitted() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return false;
  if (process.env.RAG_DISABLE_REMOTE_EMBEDDINGS === "1") return false;
  const baseUrl = process.env.GEMINI_BASE_URL || "";
  if (baseUrl && !baseUrl.includes("googleapis.com")) return false;
  if (process.env.NODE_ENV === "test" && process.env.RAG_ENABLE_REMOTE_EMBEDDINGS !== "1") return false;
  if (Date.now() < remoteEmbedCooldownUntil) return false;
  return true;
}

/**
 * Optionally compute a dense Gemini embedding with strict 3.5s timeout and circuit breaker.
 * Always returns null on failure so hybrid retrieval seamlessly falls back to local semantic vectors + BM25.
 */
export async function fetchRemoteEmbedding(text, { timeoutMs = REMOTE_EMBED_TIMEOUT_MS } = {}) {
  if (!remoteEmbeddingsPermitted()) return null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const cleanText = String(text || "").trim().slice(0, 6000);
  if (!cleanText) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${REMOTE_EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${REMOTE_EMBEDDING_MODEL}`,
        content: { parts: [{ text: cleanText }] },
      }),
    });
    if (!response.ok) {
      remoteEmbedCooldownUntil = Date.now() + REMOTE_EMBED_COOLDOWN_MS;
      return null;
    }
    const payload = await response.json();
    const values = payload?.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      return null;
    }
    return { vector: values, model: REMOTE_EMBEDDING_MODEL };
  } catch {
    remoteEmbedCooldownUntil = Date.now() + REMOTE_EMBED_COOLDOWN_MS;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Safe cosine similarity between two equal-length numeric vectors.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    normA += a * a;
    normB += b * b;
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1, sim));
}

function tokenizeSet(text) {
  return new Set(String(text || "").toLowerCase().match(/[a-z0-9]{2,}/g) || []);
}

function computeBm25Score(candidate, queryAnalysis, avgDocLen) {
  const titleLower = String(candidate.title || "").toLowerCase();
  const contentLower = String(candidate.content || candidate.excerpt || "").toLowerCase();
  const titleTokens = titleLower.match(/[a-z0-9]{2,}/g) || [];
  const bodyTokens = contentLower.match(/[a-z0-9]{2,}/g) || [];

  const titleCounts = new Map();
  const titleStemCounts = new Map();
  for (const t of titleTokens) {
    titleCounts.set(t, (titleCounts.get(t) || 0) + 1);
    const s = stemToken(t);
    titleStemCounts.set(s, (titleStemCounts.get(s) || 0) + 1);
  }

  const bodyCounts = new Map();
  const bodyStemCounts = new Map();
  for (const t of bodyTokens) {
    bodyCounts.set(t, (bodyCounts.get(t) || 0) + 1);
    const s = stemToken(t);
    bodyStemCounts.set(s, (bodyStemCounts.get(s) || 0) + 1);
  }

  const docLen = Math.max(1, titleTokens.length * 2 + bodyTokens.length);
  const k1 = 1.5;
  const b = 0.75;
  const lengthNorm = 1 - b + b * (docLen / Math.max(20, avgDocLen));

  let score = 0;
  for (const qToken of queryAnalysis.uniqueTokens) {
    const qStem = stemToken(qToken);
    const exactTf = (titleCounts.get(qToken) || 0) * 2.4 + (bodyCounts.get(qToken) || 0);
    const stemOnlyTf =
      exactTf > 0 ? 0 : ((titleStemCounts.get(qStem) || 0) * 1.4 + (bodyStemCounts.get(qStem) || 0) * 0.6);
    const tf = exactTf + stemOnlyTf;
    if (tf > 0) {
      score += (tf * (k1 + 1)) / (tf + k1 * lengthNorm);
    }
  }

  for (const bigram of queryAnalysis.bigrams) {
    if (titleLower.includes(bigram)) score += 3.0;
    else if (contentLower.includes(bigram)) score += 1.8;
  }

  return score;
}

/**
 * Score and rank candidate chunks via BM25 + vector cosine similarity + Reciprocal Rank Fusion + pedagogical signals.
 */
export function scoreAndRankCandidates(
  candidates,
  queryAnalysis,
  queryDenseVec = null,
  queryLocalVec = null,
  contextOptions = {}
) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const localQueryVec = queryLocalVec || computeLocalSemanticVector(queryAnalysis.rawText);
  const avgDocLen =
    candidates.reduce((sum, item) => sum + String(item.title || "").split(/\s+/).length * 2 + String(item.content || item.excerpt || "").split(/\s+/).length, 0) /
    Math.max(1, candidates.length);

  const scored = candidates.map((item) => {
    const lexicalScore = computeBm25Score(item, queryAnalysis, avgDocLen);
    const parsedEmbedding = parseJsonSafe(item.embedding, null);
    let vectorScore = 0;
    let matchType = "lexical";

    if (
      queryDenseVec &&
      Array.isArray(parsedEmbedding) &&
      parsedEmbedding.length === queryDenseVec.vector.length &&
      item.embedding_model === queryDenseVec.model
    ) {
      vectorScore = cosineSimilarity(queryDenseVec.vector, parsedEmbedding);
      matchType = lexicalScore > 0 ? "hybrid-dense" : "semantic-dense";
    } else {
      const localDocVec =
        Array.isArray(parsedEmbedding) &&
        parsedEmbedding.length === localQueryVec.length &&
        item.embedding_model === LOCAL_EMBEDDING_MODEL
          ? parsedEmbedding
          : computeLocalSemanticVector(`${item.title || ""}\n${item.content || item.excerpt || ""}`);
      vectorScore = cosineSimilarity(localQueryVec, localDocVec);
      matchType = lexicalScore > 0 ? "hybrid" : "semantic";
    }

    return {
      ...item,
      lexicalScore,
      vectorScore,
      matchType,
    };
  });

  const byLex = [...scored].sort((a, b) => b.lexicalScore - a.lexicalScore);
  const byVec = [...scored].sort((a, b) => b.vectorScore - a.vectorScore);
  const lexRankMap = new Map();
  const vecRankMap = new Map();
  byLex.forEach((item, idx) => lexRankMap.set(item, idx + 1));
  byVec.forEach((item, idx) => vecRankMap.set(item, idx + 1));

  const nowMs = Date.now();
  const targetCourseId = contextOptions.courseId || null;
  const targetLessonId = contextOptions.lessonId || null;

  const fused = scored
    .map((item) => {
      const lexRank = item.lexicalScore > 0 ? lexRankMap.get(item) : scored.length + 50;
      const vecRank = item.vectorScore > 0.02 ? vecRankMap.get(item) : scored.length + 50;
      const rrfScore =
        (item.lexicalScore > 0 ? 1 / (60 + lexRank) : 0) +
        (item.vectorScore > 0.02 ? 1 / (60 + vecRank) : 0);

      let affinityBoost = 0;
      if (targetCourseId && item.course_id === targetCourseId) affinityBoost += 0.008;
      if (targetCourseId && item.course_id && item.course_id !== targetCourseId) affinityBoost -= 0.05;
      if (targetLessonId && item.lesson_id === targetLessonId) affinityBoost += 0.014;

      const meta = parseJsonSafe(item.metadata, {});
      const attemptScore = meta?.score ?? item.score;
      const isRelevant = item.lexicalScore > 0 || item.vectorScore >= 0.14;
      if (
        (item.source_type === "practice_attempt" || item.type === "practice") &&
        attemptScore !== null &&
        attemptScore !== undefined &&
        Number(attemptScore) < 70 &&
        isRelevant
      ) {
        affinityBoost += 0.006;
      }

      const updatedMs = item.updated_at ? Date.parse(item.updated_at) : NaN;
      const ageDays = Number.isFinite(updatedMs) ? Math.max(0, (nowMs - updatedMs) / 86_400_000) : 30;
      const recencyBonus = Math.max(0, 0.002 * Math.exp(-ageDays / 30));

      return {
        ...item,
        rrfScore,
        affinityBoost,
        finalScore: rrfScore + affinityBoost + recencyBonus,
      };
    })
    .filter((item) => {
      if (targetLessonId && item.lesson_id === targetLessonId) return true;
      return item.lexicalScore > 0 || item.vectorScore >= 0.14;
    });

  fused.sort((a, b) => b.finalScore - a.finalScore || b.lexicalScore - a.lexicalScore || b.vectorScore - a.vectorScore);
  return fused;
}

function smartExcerptWindow(text, queryAnalysis, maxChars = 1800) {
  const clean = String(text || "").trim();
  if (clean.length <= maxChars) return clean;
  if (!queryAnalysis?.uniqueTokens?.length) return clean.slice(0, maxChars);

  const lower = clean.toLowerCase();
  let bestPos = 0;
  let bestHits = -1;

  const step = 200;
  for (let start = 0; start < clean.length; start += step) {
    const windowLower = lower.slice(start, start + maxChars);
    let hits = 0;
    for (const token of queryAnalysis.uniqueTokens) {
      if (windowLower.includes(token)) hits += 2;
      else if (windowLower.includes(stemToken(token))) hits += 1;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestPos = start;
    }
    if (start + maxChars >= clean.length) break;
  }

  if (bestPos === 0) return clean.slice(0, maxChars);
  const adjustedStart = Math.max(0, bestPos);
  const slice = clean.slice(adjustedStart, adjustedStart + maxChars - 6).trim();
  const prefix = adjustedStart > 0 ? "..." : "";
  const suffix = adjustedStart + maxChars - 6 < clean.length ? "..." : "";
  return `${prefix}${slice}${suffix}`.slice(0, maxChars);
}

function jaccardOverlap(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const val of setA) {
    if (setB.has(val)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * MMR-style source diversity capping, near-duplicate filtering, and character-budget packing.
 */
export function packRagContext(ranked, { limit = 8, maxContextChars = 9000, maxPerSource = 2, queryAnalysis = null } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, 15));
  const selected = [];
  const sourceCounts = new Map();
  const selectedTokenSets = [];
  let totalChars = 0;

  for (const candidate of ranked) {
    if (selected.length >= safeLimit) break;
    const rawType = candidate.source_type || candidate.type || "note";
    const normType = normalizeSourceType(rawType);
    const rawSourceId = candidate.source_id || String(candidate.id || "").replace(/^(note|lesson|attempt|flashcard):/, "");
    const sourceKey = `${normType}:${rawSourceId}`;
    const currentCount = sourceCounts.get(sourceKey) || 0;
    if (currentCount >= maxPerSource) continue;

    const excerpt = smartExcerptWindow(candidate.content || candidate.excerpt || "", queryAnalysis, 1800);
    const tokenSet = tokenizeSet(`${candidate.title || ""} ${excerpt}`);
    if (selectedTokenSets.some((existing) => jaccardOverlap(existing, tokenSet) > 0.85)) {
      continue;
    }

    if (selected.length > 0 && totalChars + excerpt.length > maxContextChars) {
      continue;
    }

    const meta = parseJsonSafe(candidate.metadata, {});
    const publicType = toPublicSourceType(normType);
    const canonicalId =
      candidate.id && /^(note|lesson|attempt|flashcard):/.test(String(candidate.id))
        ? String(candidate.id)
        : formatCanonicalSourceId(normType, rawSourceId);

    const entry = {
      id: canonicalId,
      type: publicType,
      title: candidate.title || (publicType === "practice" ? "Practice attempt" : "Untitled"),
      courseTitle: candidate.courseTitle || meta?.courseTitle || null,
      excerpt,
      chunkIndex: Number(candidate.chunk_index ?? 0),
      relevance: Number((candidate.finalScore || 0).toFixed(5)),
      matchType: candidate.matchType || "hybrid",
    };

    if (publicType === "practice" || meta?.score !== undefined || candidate.score !== undefined) {
      entry.score = meta?.score ?? candidate.score ?? null;
    }

    selected.push(entry);
    sourceCounts.set(sourceKey, currentCount + 1);
    selectedTokenSets.push(tokenSet);
    totalChars += excerpt.length;
  }

  return selected;
}

/**
 * Re-rank standard 3-query retrieval rows in memory using hybrid BM25 + local semantic RRF without extra DB queries.
 */
export function rankStandardRetrievalRows(rows, question, { limit = 10, courseId = null, lessonId = null } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 15));
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const queryAnalysis = analyzeQuery(question);
  const queryLocalVec = computeLocalSemanticVector(question);
  const candidates = rows.map((row) => ({
    ...row,
    source_type: normalizeSourceType(row.type),
    source_id: String(row.id || "").replace(/^(note|lesson|attempt|flashcard):/, ""),
    content: row.excerpt || "",
    metadata: { courseTitle: row.courseTitle || null, score: row.score },
  }));

  const ranked = scoreAndRankCandidates(candidates, queryAnalysis, null, queryLocalVec, { courseId, lessonId });
  const effectiveRanked = ranked.length > 0 ? ranked : candidates.map((c) => ({ ...c, finalScore: 0.001, matchType: "lexical" }));

  // Preserve group order when all returned rows fit within limit so standard per-type queries stay predictable,
  // while sorting within each group by RRF score and trimming oversized excerpts cleanly.
  if (rows.length <= safeLimit) {
    const scoreMap = new Map(effectiveRanked.map((item) => [item.id, item]));
    return rows.slice(0, safeLimit).map((row) => {
      const scored = scoreMap.get(row.id);
      return {
        ...row,
        excerpt: smartExcerptWindow(row.excerpt || "", queryAnalysis, 1800),
        ...(scored ? { relevance: Number((scored.finalScore || 0).toFixed(5)), matchType: scored.matchType } : {}),
      };
    });
  }

  return packRagContext(effectiveRanked, { limit: safeLimit, queryAnalysis });
}

/**
 * Chunk, embed, and upsert a single learner-owned source into rag_chunks.
 */
export async function indexUserSource(userId, source, { queryFn = query, allowRemoteEmbedding = false } = {}) {
  if (!userId || !source) return { upserted: 0, skipped: 0 };

  const sourceType = normalizeSourceType(source.sourceType || source.type);
  const sourceId = String(source.sourceId || source.id || "");
  if (!sourceId) return { upserted: 0, skipped: 0 };

  const title = String(source.title || "").trim().slice(0, 200);
  const body = String(source.body || "").trim();
  const courseId = source.courseId || source.course_id || null;
  const lessonId = source.lessonId || source.lesson_id || null;
  const metadata = {
    ...(source.metadata && typeof source.metadata === "object" ? source.metadata : {}),
    ...(source.courseTitle ? { courseTitle: source.courseTitle } : {}),
  };

  const chunks = chunkDocument({ title, body });
  if (chunks.length === 0) {
    await deleteUserSourceChunks(userId, sourceType, sourceId, { queryFn });
    return { upserted: 0, skipped: 0 };
  }

  const existingRes = await queryFn(
    `SELECT chunk_index,content_hash,embedding_model FROM rag_chunks WHERE user_id=$1 AND source_type=$2 AND source_id=$3 ORDER BY chunk_index`,
    [userId, sourceType, sourceId]
  );
  const existingByIndex = new Map((existingRes.rows || []).map((row) => [Number(row.chunk_index), row]));

  let upserted = 0;
  let skipped = 0;

  for (const chunk of chunks) {
    const prev = existingByIndex.get(chunk.chunkIndex);
    const targetModel = allowRemoteEmbedding && remoteEmbeddingsPermitted() ? REMOTE_EMBEDDING_MODEL : LOCAL_EMBEDDING_MODEL;
    if (prev && prev.content_hash === chunk.contentHash && (prev.embedding_model === targetModel || !allowRemoteEmbedding)) {
      skipped += 1;
      continue;
    }

    let embedding = null;
    let embeddingModel = LOCAL_EMBEDDING_MODEL;
    if (allowRemoteEmbedding) {
      const remote = await fetchRemoteEmbedding(`${title}\n${chunk.content}`);
      if (remote) {
        embedding = remote.vector;
        embeddingModel = remote.model;
      }
    }
    if (!embedding) {
      embedding = computeLocalSemanticVector(`${title}\n${chunk.content}`);
      embeddingModel = LOCAL_EMBEDDING_MODEL;
    }

    await queryFn(
      `INSERT INTO rag_chunks(user_id,source_type,source_id,course_id,lesson_id,title,chunk_index,content,content_hash,metadata,embedding,embedding_model,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT(user_id,source_type,source_id,chunk_index)
       DO UPDATE SET course_id=EXCLUDED.course_id,lesson_id=EXCLUDED.lesson_id,title=EXCLUDED.title,content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,metadata=EXCLUDED.metadata,embedding=EXCLUDED.embedding,embedding_model=EXCLUDED.embedding_model,updated_at=NOW()
       RETURNING id`,
      [
        userId,
        sourceType,
        sourceId,
        courseId,
        lessonId,
        title,
        chunk.chunkIndex,
        chunk.content,
        chunk.contentHash,
        JSON.stringify(metadata),
        JSON.stringify(embedding),
        embeddingModel,
      ]
    );
    upserted += 1;
  }

  await queryFn(
    `DELETE FROM rag_chunks WHERE user_id=$1 AND source_type=$2 AND source_id=$3 AND chunk_index>=$4`,
    [userId, sourceType, sourceId, chunks.length]
  );

  return { upserted, skipped };
}

/**
 * Remove all persisted RAG chunks for a deleted learner-owned source.
 */
export async function deleteUserSourceChunks(userId, sourceType, sourceId, { queryFn = query } = {}) {
  if (!userId || !sourceId) return;
  const normalizedType = normalizeSourceType(sourceType);
  await queryFn(
    `DELETE FROM rag_chunks WHERE user_id=$1 AND source_type=$2 AND source_id=$3`,
    [userId, normalizedType, String(sourceId)]
  );
}

function buildLessonRagBody(lesson) {
  return [
    lesson.objective ? `Objective: ${lesson.objective}` : "",
    lesson.content_markdown || "",
    lesson.worked_example ? `Worked Example:\n${lesson.worked_example}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildPracticeRagBody(attempt) {
  const result = parseJsonSafe(attempt.result, {});
  return [
    attempt.prompt ? `Prompt: ${attempt.prompt}` : "",
    attempt.submitted_answer ? `Submitted Answer: ${attempt.submitted_answer}` : "",
    result?.explanation ? `Explanation: ${result.explanation}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Incrementally index all study notes, lessons, and flashcards for a generated/updated course.
 */
export async function indexCourseMaterialsRag(userId, courseId, { queryFn = query, allowRemoteEmbedding = false } = {}) {
  if (!userId || !courseId) return { indexedDocuments: 0, chunksCreated: 0 };

  const [courseRes, notesRes, lessonsRes, cardsRes] = await Promise.all([
    queryFn(`SELECT id,title FROM courses WHERE id=$1 AND user_id=$2`, [courseId, userId]),
    queryFn(`SELECT id,user_id,course_id,lesson_id,title,body FROM notes WHERE user_id=$1 AND course_id=$2`, [userId, courseId]),
    queryFn(`SELECT id,course_id,title,objective,content_markdown,worked_example FROM lessons WHERE course_id=$1`, [courseId]),
    queryFn(`SELECT id,user_id,course_id,lesson_id,front,back FROM flashcards WHERE user_id=$1 AND course_id=$2`, [userId, courseId]),
  ]);

  const course = courseRes.rows?.[0];
  if (!course) return { indexedDocuments: 0, chunksCreated: 0 };

  const sources = [];
  for (const note of notesRes.rows || []) {
    sources.push({
      sourceType: "note",
      sourceId: note.id,
      courseId: note.course_id,
      lessonId: note.lesson_id,
      title: note.title,
      body: note.body,
      courseTitle: course.title,
    });
  }
  for (const lesson of lessonsRes.rows || []) {
    sources.push({
      sourceType: "lesson",
      sourceId: lesson.id,
      courseId: lesson.course_id,
      lessonId: lesson.id,
      title: lesson.title,
      body: buildLessonRagBody(lesson),
      courseTitle: course.title,
    });
  }
  for (const card of cardsRes.rows || []) {
    sources.push({
      sourceType: "flashcard",
      sourceId: card.id,
      courseId: card.course_id,
      lessonId: card.lesson_id,
      title: card.front,
      body: `Front: ${card.front}\nBack: ${card.back}`,
      courseTitle: course.title,
    });
  }

  let indexedDocuments = 0;
  let chunksCreated = 0;
  for (const src of sources) {
    const res = await indexUserSource(userId, src, { queryFn, allowRemoteEmbedding });
    indexedDocuments += 1;
    chunksCreated += res.upserted;
  }

  return { indexedDocuments, chunksCreated };
}

async function fetchUserCorpusDocuments(userId, { queryFn = query } = {}) {
  const [notesRes, lessonsRes, cardsRes, attemptsRes] = await Promise.all([
    queryFn(
      `SELECT n.id,n.user_id,n.course_id,n.lesson_id,n.title,n.body,n.origin,n.updated_at,c.title course_title
       FROM notes n LEFT JOIN courses c ON c.id=n.course_id WHERE n.user_id=$1 ORDER BY n.updated_at DESC LIMIT 200`,
      [userId]
    ),
    queryFn(
      `SELECT l.id,l.course_id,l.title,l.objective,l.content_markdown,l.worked_example,l.created_at,c.title course_title
       FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.user_id=$1 ORDER BY l.created_at DESC LIMIT 200`,
      [userId]
    ),
    queryFn(
      `SELECT f.id,f.user_id,f.course_id,f.lesson_id,f.front,f.back,f.due_at,f.repetitions,f.created_at,l.title lesson_title
       FROM flashcards f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.user_id=$1 ORDER BY f.due_at,f.created_at`,
      [userId]
    ),
    queryFn(
      `SELECT id,user_id,task_id,lesson_id,concept,prompt,submitted_answer,result,score,created_at
       FROM practice_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [userId]
    ),
  ]);

  const docs = [];
  for (const note of notesRes.rows || []) {
    docs.push({
      sourceType: "note",
      sourceId: note.id,
      courseId: note.course_id || null,
      lessonId: note.lesson_id || null,
      title: note.title,
      body: note.body || "",
      courseTitle: note.course_title || null,
      updatedAt: note.updated_at || null,
      metadata: { origin: note.origin || "learner", ...(note.course_title ? { courseTitle: note.course_title } : {}) },
    });
  }
  for (const lesson of lessonsRes.rows || []) {
    docs.push({
      sourceType: "lesson",
      sourceId: lesson.id,
      courseId: lesson.course_id || null,
      lessonId: lesson.id,
      title: lesson.title,
      body: buildLessonRagBody(lesson),
      courseTitle: lesson.course_title || null,
      updatedAt: lesson.created_at || null,
      metadata: { ...(lesson.course_title ? { courseTitle: lesson.course_title } : {}) },
    });
  }
  for (const card of cardsRes.rows || []) {
    docs.push({
      sourceType: "flashcard",
      sourceId: card.id,
      courseId: card.course_id || null,
      lessonId: card.lesson_id || null,
      title: card.front,
      body: `Front: ${card.front}\nBack: ${card.back}`,
      updatedAt: card.created_at || null,
      metadata: { repetitions: Number(card.repetitions || 0), ...(card.lesson_title ? { courseTitle: card.lesson_title } : {}) },
    });
  }
  for (const attempt of attemptsRes.rows || []) {
    docs.push({
      sourceType: "practice_attempt",
      sourceId: attempt.id,
      courseId: null,
      lessonId: attempt.lesson_id || null,
      title: attempt.concept || "Practice attempt",
      body: buildPracticeRagBody(attempt),
      updatedAt: attempt.created_at || null,
      metadata: { score: attempt.score ?? null },
    });
  }
  return docs;
}

/**
 * Rebuild/synchronize the full user-owned RAG index across notes, lessons, flashcards, and practice attempts.
 */
export async function reindexUserCorpus(userId, { queryFn = query, allowRemoteEmbedding = false } = {}) {
  const docs = await fetchUserCorpusDocuments(userId, { queryFn });
  await queryFn(`DELETE FROM rag_chunks WHERE user_id=$1`, [userId]);

  const byType = { note: 0, lesson: 0, flashcard: 0, practice: 0 };
  let chunksCreated = 0;
  let usedRemote = false;

  for (const doc of docs) {
    const res = await indexUserSource(userId, doc, { queryFn, allowRemoteEmbedding });
    const publicType = toPublicSourceType(doc.sourceType);
    byType[publicType] = (byType[publicType] || 0) + res.upserted;
    chunksCreated += res.upserted;
    if (allowRemoteEmbedding && remoteEmbeddingsPermitted()) {
      usedRemote = true;
    }
  }

  return {
    indexedDocuments: docs.length,
    chunksCreated,
    byType,
    embeddingMode: usedRemote ? "hybrid-dense+local" : "hybrid-local+bm25",
  };
}

/**
 * Return current RAG index diagnostics for the authenticated user.
 */
export async function getRagStatus(userId, { queryFn = query } = {}) {
  try {
    const res = await queryFn(
      `SELECT source_type,COUNT(*)::int count,MAX(updated_at) last_indexed_at,MAX(embedding_model) embedding_model
       FROM rag_chunks WHERE user_id=$1 GROUP BY source_type`,
      [userId]
    );
    const byType = { note: 0, lesson: 0, flashcard: 0, practice: 0 };
    let chunksCount = 0;
    let lastIndexedAt = null;
    let hasDense = false;

    for (const row of res.rows || []) {
      const count = Number(row.count) || 0;
      const publicType = toPublicSourceType(row.source_type);
      if (row.source_type) {
        byType[publicType] = (byType[publicType] || 0) + count;
      }
      chunksCount += count;
      if (row.last_indexed_at && (!lastIndexedAt || String(row.last_indexed_at) > String(lastIndexedAt))) {
        lastIndexedAt = row.last_indexed_at;
      }
      if (row.embedding_model === REMOTE_EMBEDDING_MODEL) {
        hasDense = true;
      }
    }

    return {
      chunksCount,
      byType,
      embeddingMode: hasDense ? "hybrid-dense+local" : "hybrid-local+bm25",
      lastIndexedAt,
    };
  } catch (error) {
    logger.warn(`Failed to query RAG status for user ${userId}: ${error?.message || error}`, "drizzlearn:rag");
    return {
      chunksCount: 0,
      byType: { note: 0, lesson: 0, flashcard: 0, practice: 0 },
      embeddingMode: "hybrid-local+bm25",
      lastIndexedAt: null,
    };
  }
}

function buildInMemoryChunksFromDocs(docs) {
  const chunks = [];
  for (const doc of docs) {
    const docChunks = chunkDocument({ title: doc.title, body: doc.body });
    for (const chunk of docChunks) {
      chunks.push({
        id: formatCanonicalSourceId(doc.sourceType, doc.sourceId),
        source_type: doc.sourceType,
        source_id: String(doc.sourceId),
        course_id: doc.courseId || null,
        lesson_id: doc.lessonId || null,
        title: doc.title,
        courseTitle: doc.courseTitle || null,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        content_hash: chunk.contentHash,
        metadata: doc.metadata || {},
        embedding: computeLocalSemanticVector(`${doc.title}\n${chunk.content}`),
        embedding_model: LOCAL_EMBEDDING_MODEL,
        updated_at: doc.updatedAt || null,
      });
    }
  }
  return chunks;
}

/**
 * Retrieve deeply-ranked learner context across persisted RAG chunks (with graceful live corpus fallback).
 */
export async function retrieveHybridContext(userId, question, options = {}) {
  const { limit = 8, lessonId = null, courseId = null, mode = null, queryFn = query } = options;
  const queryAnalysis = analyzeQuery(question);
  if (!queryAnalysis.uniqueTokens.length && !lessonId) {
    return [];
  }

  let chunks = [];
  try {
    const res = await queryFn(
      `SELECT id,user_id,source_type,source_id,course_id,lesson_id,title,chunk_index,content,content_hash,metadata,embedding,embedding_model,updated_at
       FROM rag_chunks WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 400`,
      [userId]
    );
    chunks = res.rows || [];
  } catch (error) {
    logger.warn(`rag_chunks lookup unavailable, falling back to live learner corpus: ${error?.message || error}`, "drizzlearn:rag");
    chunks = [];
  }

  // Lazy in-memory chunking if user has no persisted rag_chunks yet
  if (chunks.length === 0) {
    try {
      const docs = await fetchUserCorpusDocuments(userId, { queryFn });
      chunks = buildInMemoryChunksFromDocs(docs);
    } catch (fallbackErr) {
      logger.warn(`Live learner corpus fallback failed: ${fallbackErr?.message || fallbackErr}`, "drizzlearn:rag");
      return [];
    }
  }

  if (chunks.length === 0) return [];

  const queryLocalVec = computeLocalSemanticVector(question);
  const hasRemoteChunks = chunks.some((c) => c.embedding_model === REMOTE_EMBEDDING_MODEL);
  const queryDenseVec = hasRemoteChunks ? await fetchRemoteEmbedding(question) : null;

  const ranked = scoreAndRankCandidates(chunks, queryAnalysis, queryDenseVec, queryLocalVec, {
    courseId,
    lessonId,
    mode,
  });

  return packRagContext(ranked, {
    limit,
    maxContextChars: 9000,
    maxPerSource: 2,
    queryAnalysis,
  });
}
