import { query } from "./db.js";
import { retrieveHybridContext, rankStandardRetrievalRows } from "./rag-service.js";

function makeTsQuery(input) {
  const words = String(input || "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return [...new Set(words)].slice(0, 18).map((word) => `${word}:*`).join(" | ");
}

/**
 * Retrieve only the signed-in learner's own notes, lessons, flashcards, and practice history.
 * Uses full Hybrid RAG (chunked persistent store + vector + BM25 + RRF) when options.deepRag is enabled,
 * and enhances standard full-text queries with in-memory RRF re-ranking & smart excerpt windowing.
 */
export async function retrieveLearnerContext(userId, question, options = {}) {
  const { limit = 10, deepRag = false } = options;
  const tsQuery = makeTsQuery(question);
  if (!tsQuery && !(deepRag && options.lessonId)) return [];

  if (deepRag) {
    return retrieveHybridContext(userId, question, options);
  }

  const queryFn = options.queryFn || query;
  const count = Math.max(1, Math.min(Number(limit) || 10, 15));
  const [notes, lessons, attempts] = await Promise.all([
    queryFn(
      `SELECT id,course_id,title,left(body,1800) excerpt,ts_rank(to_tsvector('simple',coalesce(title,'')||' '||coalesce(body,'')),to_tsquery('simple',$2)) rank
      FROM notes WHERE user_id=$1 AND to_tsvector('simple',coalesce(title,'')||' '||coalesce(body,'')) @@ to_tsquery('simple',$2)
      ORDER BY rank DESC,updated_at DESC LIMIT 5`,
      [userId, tsQuery]
    ),
    queryFn(
      `SELECT l.id,l.course_id,l.title,left(coalesce(l.objective,'')||E'\n'||coalesce(l.content_markdown,'')||E'\n'||coalesce(l.worked_example,''),1800) excerpt,c.title course_title,
        ts_rank(to_tsvector('simple',coalesce(l.title,'')||' '||coalesce(l.objective,'')||' '||coalesce(l.content_markdown,'')),to_tsquery('simple',$2)) rank
      FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.user_id=$1
        AND to_tsvector('simple',coalesce(l.title,'')||' '||coalesce(l.objective,'')||' '||coalesce(l.content_markdown,'')) @@ to_tsquery('simple',$2)
      ORDER BY rank DESC LIMIT 5`,
      [userId, tsQuery]
    ),
    queryFn(
      `SELECT a.id,a.course_id,a.concept title,left(coalesce(a.prompt,'')||E'\n'||coalesce(a.submitted_answer,''),1200) excerpt,a.score,
        ts_rank(to_tsvector('simple',coalesce(a.concept,'')||' '||coalesce(a.prompt,'')||' '||coalesce(a.submitted_answer,'')),to_tsquery('simple',$2)) rank
      FROM practice_attempts a WHERE a.user_id=$1
        AND to_tsvector('simple',coalesce(a.concept,'')||' '||coalesce(a.prompt,'')||' '||coalesce(a.submitted_answer,'')) @@ to_tsquery('simple',$2)
      ORDER BY rank DESC,a.created_at DESC LIMIT 4`,
      [userId, tsQuery]
    ),
  ]);

  const targetCourseId = options.courseId || null;
  const combined = [
    ...(notes.rows || []).map((row) => ({
      id: `note:${row.id}`,
      type: "note",
      title: row.title,
      excerpt: row.excerpt,
      course_id: row.course_id || null,
    })),
    ...(lessons.rows || []).map((row) => ({
      id: `lesson:${row.id}`,
      type: "lesson",
      title: row.title,
      courseTitle: row.course_title,
      excerpt: row.excerpt,
      course_id: row.course_id || null,
    })),
    ...(attempts.rows || []).map((row) => ({
      id: `attempt:${row.id}`,
      type: "practice",
      title: row.title || "Practice attempt",
      score: row.score,
      excerpt: row.excerpt,
      course_id: row.course_id || null,
    })),
  ];

  const filteredCombined = targetCourseId
    ? combined.filter((item) => !item.course_id || item.course_id === targetCourseId)
    : combined;

  return rankStandardRetrievalRows(filteredCombined, question, {
    limit: count,
    courseId: targetCourseId,
    lessonId: options.lessonId || null,
  });
}
