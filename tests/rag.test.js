import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import {
  analyzeQuery,
  chunkDocument,
  computeLocalSemanticVector,
  cosineSimilarity,
  deleteUserSourceChunks,
  fetchRemoteEmbedding,
  getRagStatus,
  indexUserSource,
  packRagContext,
  reindexUserCorpus,
  retrieveHybridContext,
  scoreAndRankCandidates,
} from "../server/rag-service.js";
import { retrieveLearnerContext } from "../server/retrieval.js";
import { executeMongoQuery, setDbProvider } from "../server/mongo-adapter.js";

const ENV_KEYS = [
  "NVIDIA_API_KEY",
  "AI_API_KEY",
  "NVIDIA_BASE_URL",
  "AI_BASE_URL",
  "NVIDIA_MODEL",
  "AI_MODEL",
  "NVIDIA_FALLBACK_MODELS",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODELS",
  "AI_PROVIDER",
  "RAG_DISABLE_REMOTE_EMBEDDINGS",
  "RAG_ENABLE_REMOTE_EMBEDDINGS",
  "NODE_ENV",
];

function withEnvironment(values, work) {
  const before = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(work)
    .finally(() => {
      for (const key of ENV_KEYS) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    });
}

function installFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = original;
  });
}

function matchesMongoFilter(doc, filter = {}) {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = doc[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$in" in expected) {
        if (!expected.$in.includes(actual)) return false;
        continue;
      }
      if ("$gte" in expected) {
        if (!(actual >= expected.$gte)) return false;
        continue;
      }
    }
    if (actual !== expected) return false;
  }
  return true;
}

function createFakeMongoDb(initialStore = {}) {
  const store = {
    rag_chunks: [],
    notes: [],
    courses: [],
    course_modules: [],
    lessons: [],
    flashcards: [],
    practice_attempts: [],
    ...initialStore,
  };

  const collection = (name) => ({
    async findOne(filter = {}) {
      const rows = store[name] || [];
      return rows.find((item) => matchesMongoFilter(item, filter)) || null;
    },
    find(filter = {}) {
      let rows = (store[name] || []).filter((item) => matchesMongoFilter(item, filter)).map((item) => ({ ...item }));
      const cursor = {
        sort(spec = {}) {
          const entries = Object.entries(spec);
          if (entries.length > 0) {
            rows.sort((a, b) => {
              for (const [field, dir] of entries) {
                const av = a[field] ?? "";
                const bv = b[field] ?? "";
                if (av < bv) return dir < 0 ? 1 : -1;
                if (av > bv) return dir < 0 ? -1 : 1;
              }
              return 0;
            });
          }
          return cursor;
        },
        limit(n) {
          rows = rows.slice(0, n);
          return cursor;
        },
        async toArray() {
          return rows;
        },
      };
      return cursor;
    },
    async insertOne(doc) {
      if (!store[name]) store[name] = [];
      store[name].push({ ...doc });
      return { insertedId: doc.id };
    },
    async updateOne(filter = {}, update = {}, options = {}) {
      if (!store[name]) store[name] = [];
      const existing = store[name].find((item) => matchesMongoFilter(item, filter));
      if (existing) {
        if (update.$set) Object.assign(existing, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      }
      if (options.upsert) {
        const created = {
          ...(update.$setOnInsert || {}),
          ...(update.$set || {}),
        };
        store[name].push(created);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    },
    async deleteOne(filter = {}) {
      const before = (store[name] || []).length;
      store[name] = (store[name] || []).filter((item) => !matchesMongoFilter(item, filter));
      return { deletedCount: before - store[name].length };
    },
    async deleteMany(filter = {}) {
      const before = (store[name] || []).length;
      store[name] = (store[name] || []).filter((item) => !matchesMongoFilter(item, filter));
      return { deletedCount: before - store[name].length };
    },
  });

  return { store, collection };
}

test("chunkDocument preserves Markdown heading breadcrumbs, groups paragraphs, splits oversized text with overlap, and emits deterministic hashes", () => {
  assert.deepEqual(chunkDocument({ title: "", body: "" }), []);

  const titleOnly = chunkDocument({ title: "Standalone Title", body: "" });
  assert.equal(titleOnly.length, 1);
  assert.equal(titleOnly[0].chunkIndex, 0);
  assert.equal(titleOnly[0].heading, "Standalone Title");
  assert.match(titleOnly[0].contentHash, /^[0-9a-f]{64}$/);

  const markdown = [
    "# Relational Schema",
    "First short paragraph explaining primary keys.",
    "",
    "Second short paragraph explaining foreign keys.",
    "",
    "## Indexing Strategy",
    "B-tree indexes accelerate equality and range predicates.",
  ].join("\n");

  const chunksA = chunkDocument({ title: "SQL Guide", body: markdown, maxChars: 760, overlapChars: 120 });
  const chunksB = chunkDocument({ title: "SQL Guide", body: markdown, maxChars: 760, overlapChars: 120 });

  assert.equal(chunksA.length, 2);
  assert.equal(chunksA[0].chunkIndex, 0);
  assert.equal(chunksA[0].heading, "Relational Schema");
  assert.ok(chunksA[0].content.startsWith("[Relational Schema]\n"));
  assert.ok(chunksA[0].content.includes("First short paragraph"));
  assert.ok(chunksA[0].content.includes("Second short paragraph"));

  assert.equal(chunksA[1].chunkIndex, 1);
  assert.equal(chunksA[1].heading, "Indexing Strategy");
  assert.ok(chunksA[1].content.startsWith("[Indexing Strategy]\n"));

  // Deterministic contentHash across runs, sensitive to edits
  assert.equal(chunksA[0].contentHash, chunksB[0].contentHash);
  assert.equal(chunksA[1].contentHash, chunksB[1].contentHash);
  const edited = chunkDocument({ title: "SQL Guide", body: markdown.replace("foreign keys", "surrogate keys") });
  assert.notEqual(edited[0].contentHash, chunksA[0].contentHash);

  // Oversized paragraph splits with overlapChars preserved
  const longSentence = Array.from({ length: 18 }, (_, i) => `Sentence number ${i + 1} explains query planner selectivity and join ordering cleanly.`).join(" ");
  const oversized = chunkDocument({ title: "Query Planner", body: longSentence, maxChars: 300, overlapChars: 60 });
  assert.ok(oversized.length >= 3, "oversized body should split into multiple chunks");
  for (const ch of oversized) {
    assert.ok(ch.content.length <= 300, `chunk exceeded maxChars: ${ch.content.length}`);
    assert.ok(ch.content.startsWith("[Query Planner]\n"));
  }
  // Verify trailing words from chunk 0 overlap into chunk 1
  const tailTokens = oversized[0].content.slice(-45).trim().split(/\s+/).slice(-3).join(" ");
  assert.ok(oversized[1].content.includes(tailTokens), `expected overlap "${tailTokens}" in next chunk`);

  // Grouping paragraphs up to maxChars and splitting when exceeding targetMax
  const p1 = "A".repeat(120);
  const p2 = "B".repeat(110);
  const p3 = "C".repeat(130);
  const grouped = chunkDocument({ title: "Group", body: `${p1}\n\n${p2}\n\n${p3}`, maxChars: 270, overlapChars: 20 });
  assert.equal(grouped.length, 2);
  assert.ok(grouped[0].content.includes(p1) && grouped[0].content.includes(p2));
  assert.ok(grouped[1].content.includes(p3));
});

test("analyzeQuery & computeLocalSemanticVector normalize queries and separate related vs unrelated chunks", () => {
  const analysis = analyzeQuery("Please explain how SQL closures and queries work!");
  assert.deepEqual(analysis.uniqueTokens, ["sql", "closures", "queries"]);
  assert.ok(analysis.stems.includes("sql"));
  assert.ok(analysis.stems.includes("closur"));
  assert.ok(analysis.stems.includes("query"));
  assert.ok(analysis.bigrams.includes("sql closures"));

  // Stopword-only query falls back cleanly to rawTokens rather than returning empty
  const stopOnly = analyzeQuery("please explain how you work");
  assert.deepEqual(stopOnly.tokens, ["please", "explain", "how", "you", "work"]);
  assert.ok(stopOnly.uniqueTokens.length === 5);

  // Empty/punctuation query returns empty arrays and zero vector
  const empty = analyzeQuery("  ??? ... ");
  assert.deepEqual(empty.tokens, []);
  const zeroVec = computeLocalSemanticVector("  ??? ... ");
  assert.equal(zeroVec.length, 128);
  assert.ok(zeroVec.every((v) => v === 0));

  // L2 unit normalization check
  const queryVec = computeLocalSemanticVector("caching database queries");
  assert.equal(queryVec.length, 128);
  const norm = Math.sqrt(queryVec.reduce((acc, v) => acc + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-4, `expected L2 norm ~1, got ${norm}`);

  // Morphologically related chunk scores higher than unrelated topic
  const relatedVec = computeLocalSemanticVector(
    "Database Query Cache Patterns: caching queried tables speeds up repeated SQL reads."
  );
  const unrelatedVec = computeLocalSemanticVector(
    "Baking Sourdough Bread: wild yeast starter hydration and oven steam crust formation."
  );
  const relatedSim = cosineSimilarity(queryVec, relatedVec);
  const unrelatedSim = cosineSimilarity(queryVec, unrelatedVec);
  assert.ok(relatedSim > unrelatedSim, `expected relatedSim (${relatedSim}) > unrelatedSim (${unrelatedSim})`);
  assert.ok(relatedSim > 0.25);
});

test("scoreAndRankCandidates & packRagContext apply RRF, course/lesson affinity, weak-practice boost, diversity, and deduplication", () => {
  const q = "database indexing performance";
  const qAnalysis = analyzeQuery(q);
  const qVec = computeLocalSemanticVector(q);

  // 1. Hybrid RRF ranks dual lexical+semantic matches ahead of unrelated items (unrelated filtered out)
  const hybridCand = {
    id: "note:n-hybrid",
    source_type: "note",
    source_id: "n-hybrid",
    title: "Database Indexing",
    content: "B-tree database indexing dramatically improves query performance.",
    embedding: computeLocalSemanticVector("Database Indexing\nB-tree database indexing dramatically improves query performance."),
    embedding_model: "local-hash-v1",
  };
  const weakLexCand = {
    id: "note:n-partial",
    source_type: "note",
    source_id: "n-partial",
    title: "SQL Tuning",
    content: "Performance depends on avoiding full table scans.",
    embedding: computeLocalSemanticVector("SQL Tuning\nPerformance depends on avoiding full table scans."),
    embedding_model: "local-hash-v1",
  };
  const unrelatedCand = {
    id: "note:n-unrelated",
    source_type: "note",
    source_id: "n-unrelated",
    title: "Watercolor Painting",
    content: "Wet-on-wet pigment blending creates soft cloud gradients.",
    embedding: computeLocalSemanticVector("Watercolor Painting\nWet-on-wet pigment blending creates soft cloud gradients."),
    embedding_model: "local-hash-v1",
  };
  const belowThresholdCand = {
    id: "note:n-orthogonal",
    source_type: "note",
    source_id: "n-orthogonal",
    title: "Zero Match",
    content: "Completely distinct orthogonal terms.",
    embedding: qVec.map((v) => -v),
    embedding_model: "local-hash-v1",
  };

  const rrfRanked = scoreAndRankCandidates([belowThresholdCand, unrelatedCand, weakLexCand, hybridCand], qAnalysis, null, qVec);
  assert.equal(rrfRanked[0].id, "note:n-hybrid");
  assert.equal(rrfRanked[0].matchType, "hybrid");
  assert.equal(rrfRanked[1].id, "note:n-partial");
  assert.ok(rrfRanked[0].rrfScore > rrfRanked[1].rrfScore);
  assert.ok(rrfRanked[1].finalScore > rrfRanked[2].finalScore);
  assert.equal(rrfRanked[2].id, "note:n-unrelated");
  assert.equal(rrfRanked[2].lexicalScore, 0);
  assert.equal(rrfRanked.some((r) => r.id === "note:n-orthogonal"), false, "orthogonal <0.14 vector candidate should be filtered out");

  // 2. courseId & lessonId affinity boosts matching items higher
  const baseDoc = {
    source_type: "note",
    title: "Index Scan Behavior",
    content: "Database indexing avoids sequential scans for selective predicates.",
    updated_at: "2026-11-10T00:00:00Z",
  };
  const noMatch = { ...baseDoc, id: "note:other", source_id: "other", course_id: "c-other", lesson_id: "l-other" };
  const courseMatch = { ...baseDoc, id: "note:course", source_id: "course", course_id: "c-target", lesson_id: "l-other" };
  const lessonMatch = { ...baseDoc, id: "note:lesson", source_id: "lesson", course_id: "c-target", lesson_id: "l-target" };

  const affinityRanked = scoreAndRankCandidates([noMatch, courseMatch, lessonMatch], qAnalysis, null, qVec, {
    courseId: "c-target",
    lessonId: "l-target",
  });
  assert.deepEqual(
    affinityRanked.map((r) => r.id),
    ["note:lesson", "note:course", "note:other"]
  );
  assert.ok(affinityRanked[0].affinityBoost > affinityRanked[1].affinityBoost);
  assert.ok(affinityRanked[1].affinityBoost > affinityRanked[2].affinityBoost);

  // 3. Weak practice attempt (score < 70) matching topic gets misconception priority boost
  const strongAttempt = {
    id: "attempt:strong",
    source_type: "practice_attempt",
    source_id: "strong",
    title: "Database Indexing Checkpoint",
    content: "Database indexing performance relies on selective prefix columns.",
    metadata: { score: 95 },
    updated_at: "2026-11-10T00:00:00Z",
  };
  const weakAttempt = {
    id: "attempt:weak",
    source_type: "practice_attempt",
    source_id: "weak",
    title: "Database Indexing Checkpoint",
    content: "Database indexing performance relies on selective prefix columns.",
    metadata: { score: 35 },
    updated_at: "2026-11-10T00:00:00Z",
  };
  const irrelevantWeakAttempt = {
    id: "attempt:irrel",
    source_type: "practice_attempt",
    source_id: "irrel",
    title: "Pottery Glaze",
    content: "Kiln temperature controls ceramic glaze vitrification.",
    embedding: qVec.map((v) => -v),
    embedding_model: "local-hash-v1",
    metadata: { score: 10 },
    updated_at: "2026-11-10T00:00:00Z",
  };

  const practiceRanked = scoreAndRankCandidates([strongAttempt, weakAttempt, irrelevantWeakAttempt], qAnalysis, null, qVec);
  assert.deepEqual(
    practiceRanked.map((r) => r.id),
    ["attempt:weak", "attempt:strong"]
  );
  assert.ok(Math.abs(practiceRanked[0].affinityBoost - 0.006) < 1e-6);
  assert.equal(practiceRanked[1].affinityBoost, 0);

  // 4. packRagContext caps maxPerSource, skips >85% Jaccard near-duplicates, and respects maxContextChars
  const sameNoteChunks = [0, 1, 2].map((idx) => ({
    id: "note:n1",
    source_type: "note",
    source_id: "n1",
    chunk_index: idx,
    title: "Same Note",
    content: `Unique chunk ${idx} covering ${["btree", "hash", "gin"][idx]} index internals in Postgres.`,
    finalScore: 0.05 - idx * 0.001,
    matchType: "hybrid",
  }));
  const nearDuplicateOtherNote = {
    id: "note:n2",
    source_type: "note",
    source_id: "n2",
    chunk_index: 0,
    title: "Same Note",
    content: "Unique chunk 0 covering btree index internals in Postgres!",
    finalScore: 0.0495,
    matchType: "hybrid",
  };
  const distinctLesson = {
    id: "lesson:l1",
    source_type: "lesson",
    source_id: "l1",
    chunk_index: 0,
    title: "Query Plans",
    courseTitle: "SQL Course",
    content: "EXPLAIN ANALYZE reveals sequential vs index scans and actual row estimates.",
    finalScore: 0.045,
    matchType: "hybrid",
  };
  const oversizedTail = {
    id: "note:n3",
    source_type: "note",
    source_id: "n3",
    chunk_index: 0,
    title: "Huge Note",
    content: "Vacuuming dead tuples keeps index bloat bounded across heavy update workloads. ".repeat(10),
    finalScore: 0.04,
    matchType: "semantic",
  };

  const packed = packRagContext([...sameNoteChunks, nearDuplicateOtherNote, distinctLesson, oversizedTail], {
    limit: 8,
    maxPerSource: 2,
    maxContextChars: 240,
    queryAnalysis: qAnalysis,
  });

  // Chunk 0 & 1 from note:n1 kept (chunk 2 capped by maxPerSource=2), nearDuplicate note:n2 skipped (>85% Jaccard),
  // distinctLesson kept, oversizedTail skipped due to maxContextChars=240
  assert.deepEqual(
    packed.map((p) => `${p.id}#${p.chunkIndex}`),
    ["note:n1#0", "note:n1#1", "lesson:l1#0"]
  );
  const totalPackedChars = packed.reduce((sum, p) => sum + p.excerpt.length, 0);
  assert.ok(totalPackedChars <= 240, `expected totalPackedChars <= 240, got ${totalPackedChars}`);
  assert.equal(packed[2].courseTitle, "SQL Course");
});

test("persistence & MongoDB adapter handle rag_chunks SQL, incremental indexing, user isolation, status, and reindex without warnings", async (t) => {
  const userA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const userB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  const mockDb = createFakeMongoDb({
    courses: [
      { id: "c-a", user_id: userA, title: "SQL Mastery", status: "active", created_at: "2026-11-01T00:00:00Z" },
      { id: "c-b", user_id: userB, title: "Cooking Basics", status: "active", created_at: "2026-11-01T00:00:00Z" },
    ],
    lessons: [
      {
        id: "l-a1",
        course_id: "c-a",
        title: "B-Tree Indexes",
        objective: "Use composite indexes effectively.",
        content_markdown: "Composite indexes order keys from left to right.",
        worked_example: "CREATE INDEX idx_orders_user_created ON orders(user_id, created_at);",
        created_at: "2026-11-02T00:00:00Z",
      },
      {
        id: "l-b1",
        course_id: "c-b",
        title: "Knife Skills",
        objective: "Dice onions evenly.",
        content_markdown: "Keep fingertips tucked safely.",
        worked_example: "Slice horizontally then vertically.",
        created_at: "2026-11-02T00:00:00Z",
      },
    ],
    notes: [
      {
        id: "n-a1",
        user_id: userA,
        course_id: "c-a",
        lesson_id: "l-a1",
        title: "Index Notes",
        body: "Leftmost prefix rule governs composite index usage.",
        origin: "learner",
        updated_at: "2026-11-05T00:00:00Z",
      },
      {
        id: "n-b1",
        user_id: userB,
        course_id: "c-b",
        lesson_id: "l-b1",
        title: "Secret User B Note",
        body: "User B private sourdough notes.",
        origin: "learner",
        updated_at: "2026-11-05T00:00:00Z",
      },
    ],
    flashcards: [
      {
        id: "f-a1",
        user_id: userA,
        course_id: "c-a",
        lesson_id: "l-a1",
        front: "Leftmost prefix rule",
        back: "Queries must constrain leading index columns to use the B-tree efficiently.",
        due_at: "2026-11-06T00:00:00Z",
        repetitions: 2,
        created_at: "2026-11-03T00:00:00Z",
      },
    ],
    practice_attempts: [
      {
        id: "p-a1",
        user_id: userA,
        task_id: null,
        lesson_id: "l-a1",
        concept: "Composite Indexes",
        prompt: "Which column goes first in an equality + range index?",
        submitted_answer: "Range column first",
        result: { correct: false, explanation: "Put equality columns before range columns." },
        score: 0,
        created_at: "2026-11-06T00:00:00Z",
      },
    ],
  });

  const warnings = [];
  const prevLogger = globalThis.logger;
  globalThis.logger = {
    warn: (info) => warnings.push(info),
    error: (info) => warnings.push(info),
  };
  setDbProvider(async () => mockDb);

  t.after(() => {
    setDbProvider(null);
    if (prevLogger === undefined) delete globalThis.logger;
    else globalThis.logger = prevLogger;
  });

  await withEnvironment({ NODE_ENV: "test" }, async () => {
    // 1. Direct executeMongoQuery CRUD on rag_chunks (upsert, lookup, grouped status, delete)
    const vec = computeLocalSemanticVector("Composite index equality first");
    const insertRes = await executeMongoQuery(
      `INSERT INTO rag_chunks(user_id,source_type,source_id,course_id,lesson_id,title,chunk_index,content,content_hash,metadata,embedding,embedding_model,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT(user_id,source_type,source_id,chunk_index)
       DO UPDATE SET course_id=EXCLUDED.course_id,lesson_id=EXCLUDED.lesson_id,title=EXCLUDED.title,content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,metadata=EXCLUDED.metadata,embedding=EXCLUDED.embedding,embedding_model=EXCLUDED.embedding_model,updated_at=NOW()
       RETURNING id`,
      [userA, "note", "manual-1", "c-a", "l-a1", "Manual", 0, "v1 content", "hash-v1", "{}", JSON.stringify(vec), "local-hash-v1"]
    );
    assert.equal(insertRes.rows.length, 1);
    const createdId = insertRes.rows[0].id;

    // Conflict update preserves id and updates content_hash
    const updateRes = await executeMongoQuery(
      `INSERT INTO rag_chunks(user_id,source_type,source_id,course_id,lesson_id,title,chunk_index,content,content_hash,metadata,embedding,embedding_model,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
       ON CONFLICT(user_id,source_type,source_id,chunk_index)
       DO UPDATE SET course_id=EXCLUDED.course_id,lesson_id=EXCLUDED.lesson_id,title=EXCLUDED.title,content=EXCLUDED.content,content_hash=EXCLUDED.content_hash,metadata=EXCLUDED.metadata,embedding=EXCLUDED.embedding,embedding_model=EXCLUDED.embedding_model,updated_at=NOW()
       RETURNING id`,
      [userA, "note", "manual-1", "c-a", "l-a1", "Manual", 0, "v2 content", "hash-v2", "{}", JSON.stringify(vec), "local-hash-v1"]
    );
    assert.equal(updateRes.rows[0].id, createdId);

    const lookupRes = await executeMongoQuery(
      `SELECT chunk_index,content_hash,embedding_model FROM rag_chunks WHERE user_id=$1 AND source_type=$2 AND source_id=$3 ORDER BY chunk_index`,
      [userA, "note", "manual-1"]
    );
    assert.equal(lookupRes.rows.length, 1);
    assert.equal(lookupRes.rows[0].content_hash, "hash-v2");

    const groupedRes = await executeMongoQuery(
      `SELECT source_type,COUNT(*)::int count,MAX(updated_at) last_indexed_at,MAX(embedding_model) embedding_model FROM rag_chunks WHERE user_id=$1 GROUP BY source_type`,
      [userA]
    );
    assert.equal(groupedRes.rows.length, 1);
    assert.equal(groupedRes.rows[0].source_type, "note");
    assert.equal(groupedRes.rows[0].count, 1);

    await executeMongoQuery(
      `DELETE FROM rag_chunks WHERE user_id=$1 AND source_type=$2 AND source_id=$3`,
      [userA, "note", "manual-1"]
    );
    assert.equal(mockDb.store.rag_chunks.length, 0);

    // 2. indexUserSource: skips unchanged contentHash, updates changed chunks, deletes trailing chunks on shrink, isolates users
    const longBody = [
      "# Part 1",
      "Paragraph one explaining query execution plans. ".repeat(14),
      "## Part 2",
      "Paragraph two explaining hash join memory budgets. ".repeat(14),
    ].join("\n\n");

    const firstIndex = await indexUserSource(
      userA,
      { sourceType: "note", sourceId: "shrink-note", title: "Long Note", body: longBody },
      { queryFn: executeMongoQuery }
    );
    assert.ok(firstIndex.upserted >= 2);
    assert.equal(firstIndex.skipped, 0);

    // Identical call skips all chunks
    const unchangedIndex = await indexUserSource(
      userA,
      { sourceType: "note", sourceId: "shrink-note", title: "Long Note", body: longBody },
      { queryFn: executeMongoQuery }
    );
    assert.equal(unchangedIndex.upserted, 0);
    assert.equal(unchangedIndex.skipped, firstIndex.upserted);

    // Index another user's chunk with the same sourceId to verify strict user_id isolation
    await indexUserSource(
      userB,
      { sourceType: "note", sourceId: "shrink-note", title: "User B Note", body: "Private content for user B only." },
      { queryFn: executeMongoQuery }
    );

    // Shrink userA's note to 1 chunk -> trailing chunks (>= 1) for userA must be deleted, userB untouched
    const shrunkIndex = await indexUserSource(
      userA,
      { sourceType: "note", sourceId: "shrink-note", title: "Long Note", body: "Short updated summary." },
      { queryFn: executeMongoQuery }
    );
    assert.equal(shrunkIndex.upserted, 1);
    const userAShrinkChunks = mockDb.store.rag_chunks.filter((c) => c.user_id === userA && c.source_id === "shrink-note");
    const userBShrinkChunks = mockDb.store.rag_chunks.filter((c) => c.user_id === userB && c.source_id === "shrink-note");
    assert.equal(userAShrinkChunks.length, 1);
    assert.equal(userAShrinkChunks[0].chunk_index, 0);
    assert.equal(userBShrinkChunks.length, 1);

    await deleteUserSourceChunks(userA, "note", "shrink-note", { queryFn: executeMongoQuery });
    assert.equal(mockDb.store.rag_chunks.filter((c) => c.user_id === userA).length, 0);
    assert.equal(mockDb.store.rag_chunks.filter((c) => c.user_id === userB).length, 1, "delete for userA must not affect userB");

    // 3. Lazy live corpus fallback before reindex when userA has 0 persisted rag_chunks
    const lazyHits = await retrieveHybridContext(userA, "composite index leftmost prefix", {
      queryFn: executeMongoQuery,
      lessonId: "l-a1",
      courseId: "c-a",
    });
    assert.ok(lazyHits.length >= 2);
    assert.equal(
      lazyHits.some((h) => h.title.includes("Secret User B")),
      false,
      "retrieval must never leak another user's corpus"
    );

    // 4. reindexUserCorpus + getRagStatus return exact { byType: { note, lesson, flashcard, practice } } contract
    const reindexRes = await reindexUserCorpus(userA, { queryFn: executeMongoQuery });
    assert.equal(reindexRes.indexedDocuments, 4);
    assert.equal(reindexRes.chunksCreated, 4);
    assert.deepEqual(reindexRes.byType, { note: 1, lesson: 1, flashcard: 1, practice: 1 });
    assert.equal(reindexRes.embeddingMode, "hybrid-local+bm25");

    const statusRes = await getRagStatus(userA, { queryFn: executeMongoQuery });
    assert.equal(statusRes.chunksCount, 4);
    assert.deepEqual(statusRes.byType, { note: 1, lesson: 1, flashcard: 1, practice: 1 });
    assert.equal(statusRes.embeddingMode, "hybrid-local+bm25");
    assert.ok(statusRes.lastIndexedAt);

    // User B still only has their 1 existing chunk (reindex for userA didn't wipe userB!)
    const statusB = await getRagStatus(userB, { queryFn: executeMongoQuery });
    assert.equal(statusB.chunksCount, 1);
    assert.deepEqual(statusB.byType, { note: 1, lesson: 0, flashcard: 0, practice: 0 });

    // Persisted hybrid retrieval via retrieveLearnerContext(..., { deepRag: true })
    const deepHits = await retrieveLearnerContext(userA, "composite index leftmost prefix", {
      deepRag: true,
      courseId: "c-a",
      lessonId: "l-a1",
      queryFn: executeMongoQuery,
    });
    assert.ok(deepHits.length >= 3);
    assert.ok(deepHits.every((h) => typeof h.relevance === "number" && typeof h.matchType === "string"));

    // Assert zero unhandled MongoDB SQL warnings across all adapter queries
    const unhandled = warnings.filter((w) => String(w?.msg || "").includes("Unhandled MongoDB SQL query"));
    assert.deepEqual(unhandled, [], `unexpected unhandled Mongo queries: ${JSON.stringify(unhandled)}`);
  });
});

test("fetchRemoteEmbedding supports dense vector scoring and gracefully cools down on failure", async (t) => {
  await withEnvironment(
    {
      NODE_ENV: "test",
      GEMINI_API_KEY: "AIza-embed-test",
      RAG_ENABLE_REMOTE_EMBEDDINGS: "1",
    },
    async () => {
      // 1. Success path returns dense vector & model
      installFetch(t, async (url) => {
        assert.ok(url.includes("gemini-embedding-001:embedContent"));
        return new Response(JSON.stringify({ embedding: { values: [0.8, 0.6, 0] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

      const dense = await fetchRemoteEmbedding("database indexes");
      assert.deepEqual(dense, { vector: [0.8, 0.6, 0], model: "gemini-embedding-001" });

      const ranked = scoreAndRankCandidates(
        [
          {
            id: "note:dense-match",
            source_type: "note",
            source_id: "dense-match",
            title: "Semantic Match",
            content: "Completely paraphrased content.",
            embedding: [0.8, 0.6, 0],
            embedding_model: "gemini-embedding-001",
          },
          {
            id: "note:dense-miss",
            source_type: "note",
            source_id: "dense-miss",
            title: "Orthogonal",
            content: "Unrelated topic.",
            embedding: [0, 0, 1],
            embedding_model: "gemini-embedding-001",
          },
        ],
        analyzeQuery("database indexes"),
        dense
      );
      assert.equal(ranked.length, 1);
      assert.equal(ranked[0].id, "note:dense-match");
      assert.equal(ranked[0].matchType, "semantic-dense");

      // 2. Failure trips cooldown and returns null cleanly
      installFetch(t, async () => new Response("unavailable", { status: 503 }));
      const failed = await fetchRemoteEmbedding("database indexes");
      assert.equal(failed, null);

      // Subsequent call during cooldown skips fetch and returns null immediately
      let calledDuringCooldown = false;
      installFetch(t, async () => {
        calledDuringCooldown = true;
        return new Response("{}", { status: 200 });
      });
      assert.equal(await fetchRemoteEmbedding("database indexes"), null);
      assert.equal(calledDuringCooldown, false);
    }
  );
});

test("authenticated API endpoints (/api/ai/status, /api/rag/status, /api/rag/reindex, /api/tutor) enforce auth and return RAG-grounded responses", async (t) => {
  const testUser = {
    id: "11111111-1111-4111-8111-111111111111",
    email: "learner@example.com",
    full_name: "RAG Learner",
    timezone: "UTC",
    preferred_study_days: [1, 3, 5],
    session_minutes: 45,
    weekly_minutes: 180,
    notification_preferences: { study: true },
  };

  const mockDb = createFakeMongoDb({
    courses: [{ id: "course-1", user_id: testUser.id, title: "Machine Learning", status: "active", created_at: "2026-11-01T00:00:00Z" }],
    lessons: [
      {
        id: "lesson-1",
        course_id: "course-1",
        title: "Train/test split",
        objective: "Keep test examples outside the tuning loop.",
        content_markdown: "Always hold out test examples until final model evaluation.",
        worked_example: "Split 80/20 before fitting preprocessing scalers.",
        created_at: "2026-11-02T00:00:00Z",
      },
    ],
    notes: [
      {
        id: "note-rag-1",
        user_id: testUser.id,
        course_id: "course-1",
        lesson_id: "lesson-1",
        title: "Validation Holdout Rule",
        body: "Keep the final test set untouched to avoid data leakage during hyperparameter tuning.",
        origin: "learner",
        updated_at: "2026-11-05T00:00:00Z",
      },
    ],
    flashcards: [
      {
        id: "card-1",
        user_id: testUser.id,
        course_id: "course-1",
        lesson_id: "lesson-1",
        front: "Why hold out the test split?",
        back: "To get an unbiased estimate of generalization performance.",
        due_at: "2026-11-06T00:00:00Z",
        repetitions: 1,
        created_at: "2026-11-03T00:00:00Z",
      },
    ],
    practice_attempts: [
      {
        id: "attempt-1",
        user_id: testUser.id,
        task_id: null,
        lesson_id: "lesson-1",
        concept: "Train/test split",
        prompt: "Which split stays untouched until the end?",
        submitted_answer: "Validation set",
        result: { correct: false, explanation: "Validation is used for tuning; the test split stays held out." },
        score: 0,
        created_at: "2026-11-06T00:00:00Z",
      },
    ],
  });

  setDbProvider(async () => mockDb);

  const state = {
    user: null,
    query: (sql, values) => executeMongoQuery(sql, values),
  };
  globalThis.__drizzlearnRagApiTest = state;

  const mockPlugin = {
    name: "drizzlearn-rag-api-test",
    enforce: "pre",
    resolveId(sourceImport, importer) {
      if (importer?.includes("api/[...path].js")) {
        if (sourceImport === "../server/db.js") return "\0rag-api:db";
        if (sourceImport === "../server/auth.js") return "\0rag-api:auth";
        if (sourceImport === "../server/email.js") return "\0rag-api:email";
        if (sourceImport === "../server/plan-service.js") return "\0rag-api:plans";
        if (sourceImport === "../server/materials-generator.js") return "\0rag-api:materials";
      }
      if ((importer?.includes("server/rag-service.js") || importer?.includes("server/retrieval.js")) && sourceImport === "./db.js") {
        return "\0rag-api:db";
      }
      return null;
    },
    load(id) {
      if (!id.startsWith("\0rag-api:")) return null;
      const name = id.slice("\0rag-api:".length);
      if (name === "db") {
        return `
          export async function query(...args) { return globalThis.__drizzlearnRagApiTest.query(...args); }
          export async function withTransaction(work) { return work({ query: (...args) => globalThis.__drizzlearnRagApiTest.query(...args) }); }
        `;
      }
      if (name === "auth") {
        return `
          export async function requireUser(_req, res) {
            const u = globalThis.__drizzlearnRagApiTest.user;
            if (!u) {
              res.statusCode = 401;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }));
              return null;
            }
            return u;
          }
          export function sessionUserId() { return globalThis.__drizzlearnRagApiTest.user?.id || null; }
          export function createSessionCookie() { return "learnos_session=test; Path=/"; }
          export function clearSessionCookie() { return "learnos_session=; Max-Age=0"; }
        `;
      }
      if (name === "email") return `export async function sendEmail() { return { id: "email-test" }; }`;
      if (name === "plans") return `export async function generateCourseProposal() {} export async function improveCourseProposal() {} export async function approveCourse() {}`;
      if (name === "materials") return `export async function getCourseMaterialsStatus() { return { status: "ready" }; }`;
      return null;
    },
  };

  let vite;
  try {
    vite = await createServer({
      configFile: false,
      logLevel: "silent",
      plugins: [mockPlugin],
      server: { middlewareMode: true },
      appType: "custom",
    });
    const { default: handler } = await vite.ssrLoadModule("/api/[...path].js");

    const callApi = async ({ path, method = "GET", body }) => {
      const headers = new Map();
      const response = {
        statusCode: 200,
        setHeader(name, value) {
          headers.set(name.toLowerCase(), value);
        },
        end(value = "") {
          this.body = value;
        },
      };
      await handler({ url: `/api/${path}`, method, headers: {}, ...(body === undefined ? {} : { body }) }, response);
      return {
        status: response.statusCode,
        headers,
        raw: response.body,
        json: response.body ? JSON.parse(response.body) : null,
      };
    };

    await withEnvironment(
      {
        NODE_ENV: "test",
        NVIDIA_API_KEY: "nvapi-rag-secret-123",
        NVIDIA_MODEL: "nv-fast-1",
        NVIDIA_FALLBACK_MODELS: "nv-fast-2",
      },
      async () => {
        // 1. Unauthenticated access rejected with 401
        state.user = null;
        for (const [method, path] of [
          ["GET", "ai/status"],
          ["GET", "rag/status"],
          ["POST", "rag/reindex"],
          ["POST", "tutor"],
        ]) {
          const unauth = await callApi({ path, method, body: method === "POST" ? {} : undefined });
          assert.equal(unauth.status, 401, `${method} /api/${path} must require auth`);
          assert.equal(unauth.json.error.code, "UNAUTHENTICATED");
        }

        // 2. Authenticated telemetry & RAG status (initially 0 chunks)
        state.user = testUser;
        const aiStatus = await callApi({ path: "ai/status" });
        assert.equal(aiStatus.status, 200);
        assert.ok(aiStatus.json.summary);
        assert.ok(Array.isArray(aiStatus.json.models));
        assert.equal(aiStatus.raw.includes("nvapi-"), false);

        const initialRagStatus = await callApi({ path: "rag/status" });
        assert.equal(initialRagStatus.status, 200);
        assert.equal(initialRagStatus.json.chunksCount, 0);
        assert.deepEqual(initialRagStatus.json.byType, { note: 0, lesson: 0, flashcard: 0, practice: 0 });

        // 3. Reindex corpus and verify status reflects indexed chunks
        const reindex = await callApi({ path: "rag/reindex", method: "POST", body: {} });
        assert.equal(reindex.status, 200);
        assert.equal(reindex.json.indexedDocuments, 4);
        assert.equal(reindex.json.chunksCreated, 4);
        assert.deepEqual(reindex.json.byType, { note: 1, lesson: 1, flashcard: 1, practice: 1 });

        const postRagStatus = await callApi({ path: "rag/status" });
        assert.equal(postRagStatus.status, 200);
        assert.equal(postRagStatus.json.chunksCount, 4);
        assert.deepEqual(postRagStatus.json.byType, { note: 1, lesson: 1, flashcard: 1, practice: 1 });

        // 4. POST /api/tutor uses Hybrid RAG + Model Failover and enriches cited sources with RAG metadata
        installFetch(t, async (_url, options) => {
          const body = JSON.parse(options.body);
          if (body.model === "nv-fast-1") {
            return new Response("busy", { status: 429 });
          }
          // Verify grounded learnerMemory reached the model prompt
          const userPayload = JSON.parse(body.messages[1].content);
          assert.ok(
            userPayload.learnerMemory.some((m) => m.id === "note:note-rag-1"),
            "tutor prompt must include retrieved RAG note"
          );
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "Keep the test split held out to prevent data leakage [note:note-rag-1].",
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        });

        const tutorRes = await callApi({
          path: "tutor",
          method: "POST",
          body: {
            mode: "Hint",
            lessonId: "lesson-1",
            prompt: "Why should I keep the test split separate from tuning?",
          },
        });
        assert.equal(tutorRes.status, 200);
        assert.match(tutorRes.json.reply, /\[note:note-rag-1\]/);
        assert.equal(tutorRes.json.source, "nvidia");
        assert.equal(tutorRes.json.model, "nv-fast-2");
        assert.equal(tutorRes.json.failoverCount, 1);
        assert.equal(tutorRes.json.sources.length, 1);

        const cited = tutorRes.json.sources[0];
        assert.equal(cited.id, "note:note-rag-1");
        assert.equal(cited.type, "note");
        assert.equal(cited.title, "Validation Holdout Rule");
        assert.match(cited.excerpt, /data leakage/i);
        assert.equal(typeof cited.relevance, "number");
        assert.ok(cited.relevance > 0);
        assert.ok(["hybrid", "semantic", "lexical", "hybrid-dense", "semantic-dense"].includes(cited.matchType));
      }
    );
  } finally {
    setDbProvider(null);
    await vite?.close();
    delete globalThis.__drizzlearnRagApiTest;
  }
});
