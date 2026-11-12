import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { executeMongoQuery, setDbProvider } from "../server/mongo-adapter.js";
import { approveCourse } from "../server/plan-service.js";
import { getPool } from "../server/db.js";

const userId = "11111111-1111-4111-8111-111111111111";
const courseId = "22222222-2222-4222-8222-222222222222";
// Deliberately give Module 1 a lexicographically LARGER UUID than Module 2 and Module 3
const mod1Id = "ffff1111-1111-4111-8111-111111111111";
const mod2Id = "88882222-2222-4222-8222-222222222222";
const mod3Id = "00003333-3333-4333-8333-333333333333";

let vite;
let TodayPage;

function makeMockMongoDb(seed) {
  const data = Object.fromEntries(Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const matchesFilter = (doc, filter = {}) => {
    for (const [k, v] of Object.entries(filter)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        if ("$in" in v && !v.$in.includes(doc[k])) return false;
      } else if (doc[k] !== v) {
        return false;
      }
    }
    return true;
  };
  const collection = (name) => {
    const store = (data[name] ??= []);
    return {
      find(filter = {}) {
        let rows = store.filter((d) => matchesFilter(d, filter));
        return {
          sort(spec = {}) {
            const entries = Object.entries(spec);
            rows = [...rows].sort((a, b) => {
              for (const [field, dir] of entries) {
                if (a[field] === b[field]) continue;
                return (a[field] > b[field] ? 1 : -1) * (dir >= 0 ? 1 : -1);
              }
              return 0;
            });
            return this;
          },
          limit(n) { rows = rows.slice(0, n); return this; },
          async toArray() { return rows.map((r) => ({ ...r })); },
        };
      },
      async findOne(filter = {}) {
        const doc = store.find((d) => matchesFilter(d, filter));
        return doc ? { ...doc } : null;
      },
      async updateOne(filter = {}, update = {}) {
        for (const doc of store) {
          if (matchesFilter(doc, filter)) {
            if (update.$set) Object.assign(doc, update.$set);
            return { modifiedCount: 1 };
          }
        }
        return { modifiedCount: 0 };
      },
    };
  };
  return { data, db: { collection } };
}

before(async () => {
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  vite = await createServer({
    configFile: "./vite.config.js",
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
    plugins: [
      {
        name: "export-today-page",
        transform(code, id) {
          if (id.endsWith("/src/App.jsx") || id.endsWith("\\src\\App.jsx")) {
            return `${code}\nexport { TodayPage };\n`;
          }
          return null;
        },
      },
    ],
  });
  ({ TodayPage } = await vite.ssrLoadModule("/src/App.jsx"));
});

after(async () => {
  setDbProvider(null);
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  await vite?.close();
});

test("approveCourse schedules study_tasks strictly in module.position -> lesson.position order regardless of module UUIDs", async () => {
  const insertedTasks = [];
  // Simulate a DB returning modules sorted by position, and lessons sorted by lesson.position (or UUID)
  const moduleRows = [
    { id: mod1Id, position: 1, estimated_minutes: 60 },
    { id: mod2Id, position: 2, estimated_minutes: 60 },
    { id: mod3Id, position: 3, estimated_minutes: 60 },
  ];
  const shuffledByUuidLessons = [
    { id: "l-m3-1", title: "Async/Await", estimated_minutes: 30, module_id: mod3Id, position: 1 },
    { id: "l-m2-1", title: "Conditionals and Logic", estimated_minutes: 30, module_id: mod2Id, position: 1 },
    { id: "l-m1-2", title: "Basic Operators", estimated_minutes: 30, module_id: mod1Id, position: 2 },
    { id: "l-m1-1", title: "Variables & Types", estimated_minutes: 30, module_id: mod1Id, position: 1 },
  ];

  const client = {
    async query(sql, values = []) {
      if (sql.includes("FROM courses c JOIN learning_goals")) {
        return { rows: [{ id: courseId, user_id: userId, goal_id: "g1", status: "proposal", weekly_minutes: 360, target_weeks: 4, estimated_minutes: 120 }] };
      }
      if (sql.includes("FROM course_modules WHERE course_id=$1")) return { rows: moduleRows };
      if (sql.includes("FROM lessons WHERE course_id=$1")) return { rows: shuffledByUuidLessons };
      if (sql.includes("INSERT INTO study_tasks")) {
        insertedTasks.push({ lessonId: values[2], title: values[3], scheduledAt: values[4] });
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };

  const prevDbUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/drizzlearn";
  const pool = getPool();
  const prevConnect = pool.connect;
  pool.connect = async () => client;
  let res;
  try {
    res = await approveCourse(userId, courseId, false, { session_minutes: 60 }, { skipBackgroundMaterials: true });
  } finally {
    pool.connect = prevConnect;
    if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDbUrl;
  }

  assert.equal(res.approved, true);
  assert.deepEqual(
    insertedTasks.map((t) => t.title),
    ["Variables & Types", "Basic Operators", "Conditionals and Logic", "Async/Await"]
  );
  for (let i = 1; i < insertedTasks.length; i++) {
    assert.ok(
      new Date(insertedTasks[i].scheduledAt).getTime() > new Date(insertedTasks[i - 1].scheduledAt).getTime(),
      "each scheduled lesson timestamp must strictly advance in roadmap order"
    );
  }
});

test("MongoDB adapter sorts lessons by roadmap position and auto-heals pre-existing inverted study_task schedules", async () => {
  const nov13 = "2026-11-13T18:00:00.000Z";
  const nov16 = "2026-11-16T18:00:00.000Z";
  const nov18 = "2026-11-18T18:00:00.000Z";

  const { data, db } = makeMockMongoDb({
    courses: [{ id: courseId, user_id: userId, title: "JS Fundamentals" }],
    course_modules: [
      { id: mod1Id, course_id: courseId, position: 1, title: "Foundations" },
      { id: mod2Id, course_id: courseId, position: 2, title: "Async" },
    ],
    lessons: [
      { id: "l-m2-1", course_id: courseId, module_id: mod2Id, position: 1, title: "Callbacks & Promises", estimated_minutes: 30, objective: "Master promises" },
      { id: "l-m1-2", course_id: courseId, module_id: mod1Id, position: 2, title: "Conditionals & Logic", estimated_minutes: 30, objective: "Branch control flow" },
      { id: "l-m1-1", course_id: courseId, module_id: mod1Id, position: 1, title: "Operators", estimated_minutes: 30, objective: "Expressions" },
    ],
    // Inverted dates caused by previous UUID-ordered approval + one manually rescheduled task that must stay put
    study_tasks: [
      { id: "t-async", user_id: userId, course_id: courseId, lesson_id: "l-m2-1", task_type: "lesson", title: "Callbacks & Promises", scheduled_at: nov13, status: "upcoming", created_at: "2026-11-12T01:00:00Z" },
      { id: "t-op", user_id: userId, course_id: courseId, lesson_id: "l-m1-1", task_type: "lesson", title: "Operators", scheduled_at: nov16, status: "upcoming", created_at: "2026-11-12T01:00:01Z" },
      { id: "t-cond", user_id: userId, course_id: courseId, lesson_id: "l-m1-2", task_type: "lesson", title: "Conditionals & Logic", scheduled_at: nov18, status: "upcoming", created_at: "2026-11-12T01:00:02Z" },
      { id: "t-practice", user_id: userId, course_id: courseId, lesson_id: "l-m1-1", task_type: "practice", title: "Practice: Operators", scheduled_at: nov16, status: "upcoming", created_at: "2026-11-12T01:05:00Z" },
      { id: "t-manual", user_id: userId, course_id: courseId, lesson_id: "l-m2-1", task_type: "review", title: "Manual Review", scheduled_at: nov13, status: "rescheduled", created_at: "2026-11-12T01:06:00Z" },
    ],
  });
  setDbProvider(async () => db);

  // 1. Direct lessons query must sort by (module.position, lesson.position)
  const lessonsRes = await executeMongoQuery(
    "SELECT * FROM lessons WHERE course_id=$1 ORDER BY module_id, position",
    [courseId]
  );
  assert.deepEqual(
    lessonsRes.rows.map((l) => l.title),
    ["Operators", "Conditionals & Logic", "Callbacks & Promises"]
  );

  // 2. Tasks query auto-heals inverted upcoming dates and persists them
  const tasksRes = await executeMongoQuery(
    `SELECT t.*,l.objective,c.title AS course_title FROM study_tasks t LEFT JOIN lessons l ON l.id=t.lesson_id JOIN courses c ON c.id=t.course_id WHERE t.user_id=$1 AND ($2::timestamptz IS NULL OR t.scheduled_at >= $2) AND ($3::timestamptz IS NULL OR t.scheduled_at < $3) ORDER BY t.scheduled_at NULLS LAST LIMIT 200`,
    [userId, null, null]
  );
  const lessonRows = tasksRes.rows.filter((t) => t.task_type === "lesson");
  assert.deepEqual(
    lessonRows.map((t) => t.title),
    ["Operators", "Conditionals & Logic", "Callbacks & Promises"]
  );
  assert.equal(lessonRows[0].scheduled_at.slice(0, 10), "2026-11-13");
  assert.equal(lessonRows[1].scheduled_at.slice(0, 10), "2026-11-16");
  assert.equal(lessonRows[2].scheduled_at.slice(0, 10), "2026-11-18");

  // Practice follows its healed parent lesson & manual rescheduled task stays untouched
  const storedPractice = data.study_tasks.find((t) => t.id === "t-practice");
  assert.equal(storedPractice.scheduled_at.slice(0, 10), "2026-11-13");
  const storedManual = data.study_tasks.find((t) => t.id === "t-manual");
  assert.equal(storedManual.scheduled_at, nov13);
});

test("TodayPage renders same-day sessions in curriculum roadmap order instead of array insertion order", () => {
  const day = "2026-11-13T18:00:00.000Z";
  const course = {
    id: courseId,
    title: "JS Fundamentals",
    modules: [
      { id: mod1Id, position: 1, title: "Module 1", lessons: [{ id: "l1", position: 1, title: "Operators" }, { id: "l2", position: 2, title: "Conditionals" }] },
      { id: mod2Id, position: 2, title: "Module 2", lessons: [{ id: "l3", position: 1, title: "Callbacks & Promises" }] },
    ],
  };
  // Deliberately supply scrambled array order on the same day
  const scrambledTasks = [
    { id: "t3", course_id: courseId, lesson_id: "l3", task_type: "lesson", title: "Callbacks & Promises", scheduled_at: day, status: "upcoming", estimated_minutes: 30 },
    { id: "t2", course_id: courseId, lesson_id: "l2", task_type: "lesson", title: "Conditionals", scheduled_at: day, status: "upcoming", estimated_minutes: 30 },
    { id: "t1", course_id: courseId, lesson_id: "l1", task_type: "lesson", title: "Operators", scheduled_at: day, status: "upcoming", estimated_minutes: 30 },
  ];

  const html = renderToStaticMarkup(
    React.createElement(TodayPage, {
      data: { courses: [course], tasks: scrambledTasks, flashcards: [], settings: { preferredStudyDays: [1, 3, 5], sessionMinutes: 120 } },
      dueCards: [],
      activeCourse: course,
      go() {},
      updateData() {},
      openLesson() {},
      request: async () => ({}),
      remote: false,
      refreshRemote: async () => {},
      flashToast() {},
    })
  );

  // Hero NEXT STEP must pick first lesson in roadmap
  assert.ok(html.includes('<h2>Operators</h2>'));
  // Day list order must be Operators -> Conditionals -> Callbacks & Promises
  const opIdx = html.indexOf("<strong>Operators</strong>");
  const condIdx = html.indexOf("<strong>Conditionals</strong>");
  const cbIdx = html.indexOf("<strong>Callbacks &amp; Promises</strong>");
  assert.ok(opIdx > -1 && condIdx > opIdx && cbIdx > condIdx, "same-day tasks must follow curriculum roadmap order");
});
