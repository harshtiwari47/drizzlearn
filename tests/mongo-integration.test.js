import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isMongoConfigured, getMongoUri } from "../server/mongo.js";
import { isMongoDatabase } from "../server/db.js";
import { executeMongoQuery, normalizeSql, setDbProvider } from "../server/mongo-adapter.js";

test("MongoDB configuration and URI detection works as expected", () => {
  assert.equal(typeof isMongoConfigured, "function");
  assert.equal(typeof isMongoDatabase, "function");
  assert.equal(typeof executeMongoQuery, "function");
  assert.equal(typeof normalizeSql, "function");

  const uri = getMongoUri();
  assert.ok(uri.startsWith("mongodb+srv://") || uri.startsWith("mongodb://"), "URI should start with mongodb");
  assert.ok(uri.includes("hrsrix_db_user"), "URI should contain the configured username");
  assert.ok(uri.includes("cluster0.v3zhmlg.mongodb.net"), "URI should point to cluster0.v3zhmlg.mongodb.net");
});

test("package.json and environment files specify MongoDB configurations", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.dependencies.mongodb, "package.json should have mongodb installed");
  assert.match(pkg.scripts["db:migrate"], /migrate-mongo\.js/);
  assert.match(pkg.scripts["db:migrate:mongo"], /migrate-mongo\.js/);

  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(envExample, /MONGODB_URI=/);
  assert.match(envExample, /cluster0\.v3zhmlg\.mongodb\.net/);
});

test("normalizeSql normalizes whitespace around operators, commas, and parentheticals", () => {
  const q1 = "SELECT id, email, full_name, timezone, preferred_study_days, session_minutes, weekly_minutes, notification_preferences FROM users WHERE id = $1";
  const norm1 = normalizeSql(q1);
  assert.ok(norm1.includes("FROM users WHERE id=$1"), "Should collapse spaces around =");
  assert.ok(norm1.includes("id,email,full_name"), "Should collapse spaces around ,");

  const q2 = "UPDATE courses SET title = $1 , summary = $2 WHERE id = $3 AND status = 'proposal'";
  const norm2 = normalizeSql(q2);
  assert.ok(norm2.includes("SET title=$1,summary=$2"), "Should collapse spaces in SET");
  assert.ok(norm2.includes("status='proposal'"), "Should collapse spaces in equality condition");

  const q3 = "SELECT * FROM notes WHERE ( title ILIKE $1 OR body ILIKE $1 )";
  const norm3 = normalizeSql(q3);
  assert.ok(norm3.includes("(title ILIKE $1 OR body ILIKE $1)"), "Should collapse spaces in parens");
});

test("executeMongoQuery matches and executes user, getHome, progress, search, export, ai_jobs, and retrieval queries against mock db", async () => {
  // Setup in-memory mock mongo db
  const fakeStore = {
    users: [
      {
        id: "u1",
        email: "learner@example.com",
        full_name: "Test Learner",
        timezone: "UTC",
        preferred_study_days: [1, 3, 5],
        session_minutes: 45,
        weekly_minutes: 180,
        notification_preferences: { study: true },
      },
    ],
    notes: [
      { id: "n1", user_id: "u1", title: "JavaScript Closures", body: "A closure is a function with lexical scope.", updated_at: "2026-11-10T00:00:00Z" },
    ],
    flashcards: [
      { id: "f1", user_id: "u1", front: "Closure", back: "Function + lexical environment", due_at: "2026-11-01T00:00:00Z", ease: 2.5, repetitions: 1 },
    ],
    practice_attempts: [
      { id: "a1", user_id: "u1", concept: "Closures", score: 85, prompt: "Explain closure", submitted_answer: "Function + scope", created_at: "2026-11-10T12:00:00Z" },
    ],
    study_tasks: [
      { id: "t1", user_id: "u1", course_id: "c1", status: "completed", scheduled_at: "2026-11-10T10:00:00Z", created_at: "2026-11-10T10:00:00Z" },
      { id: "t2", user_id: "u1", course_id: "c1", status: "upcoming", scheduled_at: "2026-11-12T10:00:00Z", created_at: "2026-11-10T10:00:00Z" },
    ],
    courses: [
      { id: "c1", user_id: "u1", goal_id: "g1", title: "Modern JavaScript", status: "active", created_at: "2026-11-09T00:00:00Z" },
    ],
    course_modules: [
      { id: "m1", course_id: "c1", position: 1, title: "Basics" },
    ],
    lessons: [
      { id: "l1", course_id: "c1", module_id: "m1", position: 1, title: "Scope & Closures", objective: "Understand scope", content_markdown: "Closures are...", worked_example: "function outer() { ... }" },
    ],
    learning_goals: [
      { id: "g1", user_id: "u1", topic: "JavaScript", desired_outcome: "Build apps", status: "active", created_at: "2026-11-09T00:00:00Z" },
    ],
    ai_jobs: [],
  };

  const createFakeCollection = (name) => ({
    async findOne(filter) {
      const items = fakeStore[name] || [];
      return items.find((item) => Object.entries(filter).every(([k, v]) => item[k] === v)) || null;
    },
    find(filter = {}) {
      let items = [...(fakeStore[name] || [])];
      if (filter.user_id) items = items.filter((i) => i.user_id === filter.user_id);
      if (filter.course_id && filter.course_id.$in) items = items.filter((i) => filter.course_id.$in.includes(i.course_id));
      if (filter.course_id && typeof filter.course_id === "string") items = items.filter((i) => i.course_id === filter.course_id);
      return {
        sort() { return this; },
        limit(n) { items = items.slice(0, n); return this; },
        async toArray() { return items; },
      };
    },
    async countDocuments(filter = {}) {
      let items = fakeStore[name] || [];
      if (filter.user_id) items = items.filter((i) => i.user_id === filter.user_id);
      if (filter.status) items = items.filter((i) => i.status === filter.status);
      return items.length;
    },
    async distinct(field) {
      const items = fakeStore[name] || [];
      return [...new Set(items.map((i) => i[field]).filter(Boolean))];
    },
    aggregate() {
      return {
        async toArray() {
          return [{ _id: "upcoming", count: 1 }, { _id: "completed", count: 1 }];
        },
      };
    },
    async insertOne(doc) {
      if (!fakeStore[name]) fakeStore[name] = [];
      fakeStore[name].push(doc);
      return { insertedId: doc.id };
    },
    async updateOne(filter, update) {
      const item = await this.findOne(filter);
      if (item && update.$set) Object.assign(item, update.$set);
      return { modifiedCount: 1 };
    },
    async updateMany(filter, update) {
      return { modifiedCount: 1 };
    },
    async findOneAndUpdate(filter, update) {
      const item = await this.findOne(filter);
      if (item && update.$set) Object.assign(item, update.$set);
      return item;
    },
    async deleteOne(filter) {
      if (fakeStore[name]) {
        fakeStore[name] = fakeStore[name].filter((i) => !Object.entries(filter).every(([k, v]) => i[k] === v));
      }
      return { deletedCount: 1 };
    },
    async deleteMany(filter) {
      if (fakeStore[name]) {
        fakeStore[name] = fakeStore[name].filter((i) => !Object.entries(filter).every(([k, v]) => i[k] === v));
      }
      return { deletedCount: 1 };
    },
  });

  const mockDb = {
    collection: (name) => createFakeCollection(name),
  };

  setDbProvider(async () => mockDb);

  try {
    // 1. User lookup with spaces around =
    const userSql = "SELECT id, email, full_name, timezone, preferred_study_days, session_minutes, weekly_minutes, notification_preferences FROM users WHERE id = $1";
    const userRes = await executeMongoQuery(userSql, ["u1"]);
    assert.equal(userRes.rows.length, 1, "User query with spaces should return 1 row");
    assert.equal(userRes.rows[0].email, "learner@example.com");
    assert.equal(userRes.rows[0].session_minutes, 45);

    // 2. getHome aggregate counts
    const homeCountsSql = `SELECT (SELECT COUNT(*)::int FROM notes WHERE user_id=$1) notes,
      (SELECT COUNT(*)::int FROM flashcards WHERE user_id=$1) flashcards,
      (SELECT COUNT(*)::int FROM practice_attempts WHERE user_id=$1) attempts,
      (SELECT COUNT(*)::int FROM study_tasks WHERE user_id=$1 AND status='completed') completed,
      (SELECT COUNT(*)::int FROM study_tasks WHERE user_id=$1) total`;
    const homeCountsRes = await executeMongoQuery(homeCountsSql, ["u1"]);
    assert.equal(homeCountsRes.rows.length, 1);
    assert.equal(homeCountsRes.rows[0].notes, 1);
    assert.equal(homeCountsRes.rows[0].flashcards, 1);
    assert.equal(homeCountsRes.rows[0].completed, 1);

    // 3. Progress page queries
    const progTasksSql = "SELECT status,COUNT(*)::int count FROM study_tasks WHERE user_id=$1 GROUP BY status";
    const progTasksRes = await executeMongoQuery(progTasksSql, ["u1"]);
    assert.ok(progTasksRes.rows.length > 0);

    const progAttemptsSql = "SELECT id,lesson_id,concept,score,result,created_at FROM practice_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50";
    const progAttemptsRes = await executeMongoQuery(progAttemptsSql, ["u1"]);
    assert.equal(progAttemptsRes.rows.length, 1);
    assert.equal(progAttemptsRes.rows[0].concept, "Closures");

    // 4. Search query (ILIKE)
    const searchNotesSql = "SELECT id,title,body FROM notes WHERE user_id=$1 AND (title ILIKE $2 OR body ILIKE $2) LIMIT 8";
    const searchNotesRes = await executeMongoQuery(searchNotesSql, ["u1", "%Closures%"]);
    assert.equal(searchNotesRes.rows.length, 1);
    assert.equal(searchNotesRes.rows[0].title, "JavaScript Closures");

    // 5. Export queries
    const exportGoalsSql = "SELECT * FROM learning_goals WHERE user_id=$1";
    const exportGoalsRes = await executeMongoQuery(exportGoalsSql, ["u1"]);
    assert.equal(exportGoalsRes.rows.length, 1);
    assert.equal(exportGoalsRes.rows[0].topic, "JavaScript");

    const exportNotesSql = "SELECT * FROM notes WHERE user_id=$1";
    const exportNotesRes = await executeMongoQuery(exportNotesSql, ["u1"]);
    assert.equal(exportNotesRes.rows.length, 1);

    // 6. ai_jobs insert
    const aiJobSql = "INSERT INTO ai_jobs(user_id,job_type,status,input_ref,output_ref,finished_at) VALUES($1,'course_plan','succeeded',$2,$3,NOW())";
    const aiJobRes = await executeMongoQuery(aiJobSql, ["u1", JSON.stringify({ goalId: "g1" }), JSON.stringify({ title: "Plan" })]);
    assert.equal(aiJobRes.rows.length, 1);
    assert.equal(aiJobRes.rows[0].job_type, "course_plan");

    // 7. Course proposal revision deletions
    const delModulesSql = "DELETE FROM course_modules WHERE course_id=$1";
    const delModulesRes = await executeMongoQuery(delModulesSql, ["c_rev"]);
    assert.deepEqual(delModulesRes.rows, []);

    const delLessonsSql = "DELETE FROM lessons WHERE course_id=$1";
    const delLessonsRes = await executeMongoQuery(delLessonsSql, ["c_rev"]);
    assert.deepEqual(delLessonsRes.rows, []);

    // 8. Retrieval queries (to_tsvector)
    const retrievalNotesSql = "SELECT id,title,left(body,1800) excerpt,ts_rank(to_tsvector('simple',coalesce(title,'')||' '||coalesce(body,'')),to_tsquery('simple',$2)) rank FROM notes WHERE user_id=$1 AND to_tsvector('simple',coalesce(title,'')||' '||coalesce(body,'')) @@ to_tsquery('simple',$2) ORDER BY rank DESC,updated_at DESC LIMIT 5";
    const retrievalRes = await executeMongoQuery(retrievalNotesSql, ["u1", "closure:* | lexical:*"]);
    assert.equal(retrievalRes.rows.length, 1);
    assert.equal(retrievalRes.rows[0].title, "JavaScript Closures");

    // 9. INSERT INTO study_tasks with 6 parameters
    const insertTaskSql = "INSERT INTO study_tasks(user_id,course_id,lesson_id,task_type,title,scheduled_at,status,estimated_minutes) VALUES($1,$2,$3,'lesson',$4,$5,'upcoming',$6)";
    const insertTaskRes = await executeMongoQuery(insertTaskSql, ["u1", "c1", "l1", "Scope & Closures", "2026-11-15T18:00:00Z", 25]);
    assert.equal(insertTaskRes.rows.length, 1);
    assert.equal(insertTaskRes.rows[0].title, "Scope & Closures");
    assert.equal(insertTaskRes.rows[0].user_id, "u1");

    // 10. INSERT INTO auth_tokens with 2 parameters
    const insertTokenSql = "INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'reset_password',$2,NOW()+INTERVAL '1 hour')";
    const insertTokenRes = await executeMongoQuery(insertTokenSql, ["u1", "hash123"]);
    assert.equal(insertTokenRes.rows.length, 1);
    assert.equal(insertTokenRes.rows[0].purpose, "reset_password");
    assert.equal(insertTokenRes.rows[0].token_hash, "hash123");

    // 11. Courses with learning_goals join (GET /api/courses)
    const coursesListSql = `SELECT c.*,g.topic,g.current_level,g.weekly_minutes,g.target_weeks,
      (SELECT COUNT(*)::int FROM course_modules m WHERE m.course_id=c.id) module_count,
      (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id=c.id) lesson_count,
      (SELECT COUNT(*)::int FROM study_tasks t WHERE t.course_id=c.id AND t.status='completed') completed_tasks
      FROM courses c JOIN learning_goals g ON g.id=c.goal_id WHERE c.user_id=$1 ORDER BY c.created_at DESC`;
    const coursesListRes = await executeMongoQuery(coursesListSql, ["u1"]);
    assert.equal(coursesListRes.rows.length, 1);
    assert.equal(coursesListRes.rows[0].topic, "JavaScript");
    assert.equal(coursesListRes.rows[0].module_count, 1);

    // 12. 2-way join lessons & courses without course_modules
    const lessonTwoWaySql = "SELECT l.id,l.course_id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2";
    const lessonTwoWayRes = await executeMongoQuery(lessonTwoWaySql, ["l1", "u1"]);
    assert.equal(lessonTwoWayRes.rows.length, 1);
    assert.equal(lessonTwoWayRes.rows[0].id, "l1");

    // 13. UPDATE flashcards with 4 parameters
    const updateFlashcardSql = "UPDATE flashcards SET due_at=$1,interval_days=$2,repetitions=repetitions+1,ease=GREATEST(1.3,ease+$3) WHERE id=$4 RETURNING *";
    const updateFlashcardRes = await executeMongoQuery(updateFlashcardSql, ["2026-11-20T00:00:00Z", 5, 0.1, "f1"]);
    assert.equal(updateFlashcardRes.rows.length, 1);
    assert.equal(updateFlashcardRes.rows[0].repetitions, 2);

    // 14. UPDATE learning_goals with 2 parameters (status='active')
    const updateGoalActiveSql = "UPDATE learning_goals SET status='active',updated_at=NOW() WHERE id=$1 AND user_id=$2";
    const updateGoalActiveRes = await executeMongoQuery(updateGoalActiveSql, ["g1", "u1"]);
    assert.deepEqual(updateGoalActiveRes.rows, []);

    // 15. UPDATE courses with 6 parameters (plan service proposal improvement)
    const updateCoursePlanSql = "UPDATE courses SET title=$1,summary=$2,estimated_minutes=$3,assumptions=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 AND status='proposal'";
    const updateCoursePlanRes = await executeMongoQuery(updateCoursePlanSql, ["Updated JS", "Updated summary", 240, JSON.stringify(["assume ES6"]), "c1", "u1"]);
    assert.equal(updateCoursePlanRes.rows.length, 1);
    assert.equal(updateCoursePlanRes.rows[0].title, "Updated JS");

    // 16. INSERT INTO study_room_members with boolean condition
    const insertMemberSql = "INSERT INTO study_room_members(room_id,user_id,role) VALUES($1,$2,CASE WHEN $3 THEN 'owner' ELSE 'member' END) ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen_at=NOW()";
    const insertMemberRes = await executeMongoQuery(insertMemberSql, ["r1", "u1", true]);
    assert.deepEqual(insertMemberRes.rows, []);

    // 17. UPDATE study_tasks SET status='overdue'
    const updateOverdueSql = "UPDATE study_tasks SET status='overdue' WHERE user_id=$1 AND status IN ('upcoming','due','rescheduled') AND scheduled_at<NOW()-INTERVAL '1 day'";
    const updateOverdueRes = await executeMongoQuery(updateOverdueSql, ["u1"]);
    assert.deepEqual(updateOverdueRes.rows, []);

    // 18. Structured logger verification on unhandled query
    const logs = [];
    globalThis.logger = {
      warn: (info) => logs.push(info),
    };
    const unhandledRes = await executeMongoQuery("SELECT non_existent FROM dummy_table WHERE 1=1");
    assert.deepEqual(unhandledRes.rows, []);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].msg.includes("Unhandled MongoDB SQL query"));
    delete globalThis.logger;
  } finally {
    setDbProvider(null);
  }
});
