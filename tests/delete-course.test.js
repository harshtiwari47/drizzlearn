import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { executeMongoQuery, setDbProvider } from "../server/mongo-adapter.js";

const testUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "learner@example.com",
  full_name: "Sample Learner",
  timezone: "UTC",
  preferred_study_days: [1, 3, 5],
  session_minutes: 45,
  weekly_minutes: 360,
  notification_preferences: { study: false, review: false },
};
const otherUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const courseId = "33333333-3333-4333-8333-333333333333";
const proposalId = "44444444-4444-4444-8444-444444444444";

let vite;
let apiHandler;
let apiState;
let Modal;
let CoursesPage;
let CoursePage;
let ProposalPage;

function apiMockPlugin() {
  const replacements = new Map([
    ["../server/db.js", "db"],
    ["../server/auth.js", "auth"],
    ["../server/email.js", "email"],
    ["../server/plan-service.js", "plans"],
    ["../server/ai.js", "ai"],
    ["../server/retrieval.js", "retrieval"],
  ]);
  return {
    name: "drizzlearn-delete-course-test-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.includes("api/[...path].js")) return null;
      const replacement = replacements.get(source);
      return replacement ? `\0delete-test:${replacement}` : null;
    },
    load(id) {
      if (!id.startsWith("\0delete-test:")) return null;
      const mock = id.slice("\0delete-test:".length);
      if (mock === "db") return `
        export async function query(...args) { return globalThis.__drizzlearnDeleteTest.query(...args); }
        export async function withTransaction(work) { return work({ query: (...args) => globalThis.__drizzlearnDeleteTest.query(...args) }); }
      `;
      if (mock === "auth") return `
        export async function requireUser() { return globalThis.__drizzlearnDeleteTest.user; }
        export function sessionUserId() { return globalThis.__drizzlearnDeleteTest.user.id; }
        export function createSessionCookie() { return "learnos_session=test; HttpOnly; Path=/"; }
        export function clearSessionCookie() { return "learnos_session=; HttpOnly; Path=/; Max-Age=0"; }
      `;
      if (mock === "email") return `export async function sendEmail() { return { id: "email-test" }; }`;
      if (mock === "plans") return `
        export async function generateCourseProposal() { return null; }
        export async function improveCourseProposal() { return null; }
        export async function approveCourse() { return null; }
      `;
      if (mock === "ai") return `export async function tutorReply() { return { text: "", source: "nvidia", sources: [] }; }`;
      if (mock === "retrieval") return `export async function retrieveLearnerContext() { return []; }`;
      return null;
    },
    transform(code, id) {
      if (id.endsWith("/src/App.jsx") || id.endsWith("\\src\\App.jsx")) {
        return `${code}\nexport { CoursesPage, CoursePage, ProposalPage };\n`;
      }
      return null;
    },
  };
}

async function callApi({ path, method = "DELETE" }) {
  const headers = { host: "drizzlearn.test", origin: "http://drizzlearn.test" };
  let body = "";
  const req = {
    method,
    url: `/api/${path}`,
    headers,
    async *[Symbol.asyncIterator]() {},
  };
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(code, outHeaders = {}) {
      this.statusCode = code;
      for (const [k, v] of Object.entries(outHeaders)) this.headers[k.toLowerCase()] = v;
    },
    end(chunk = "") { body += String(chunk); },
  };
  await apiHandler(req, res);
  return { status: res.statusCode, json: body ? JSON.parse(body) : null };
}

function matchesFilter(doc, filter = {}) {
  for (const [key, cond] of Object.entries(filter)) {
    if (key === "$or") {
      if (!Array.isArray(cond) || !cond.some((sub) => matchesFilter(doc, sub))) return false;
      continue;
    }
    const val = doc[key];
    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      if ("$in" in cond) {
        if (!cond.$in.includes(val)) return false;
      } else if ("$gte" in cond) {
        if (!(Number(val) >= Number(cond.$gte))) return false;
      }
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}

function makeMockMongoDb(seed) {
  const data = Object.fromEntries(Object.entries(seed).map(([k, rows]) => [k, rows.map((r) => ({ ...r }))]));
  const collection = (name) => {
    const store = (data[name] ??= []);
    return {
      find(filter = {}) {
        let matched = store.filter((doc) => matchesFilter(doc, filter));
        return {
          project() { return this; },
          sort() { return this; },
          limit(n) { matched = matched.slice(0, n); return this; },
          async toArray() { return matched.map((doc) => ({ ...doc })); },
        };
      },
      async findOne(filter = {}) {
        const found = store.find((doc) => matchesFilter(doc, filter));
        return found ? { ...found } : null;
      },
      async findOneAndDelete(filter = {}) {
        const idx = store.findIndex((doc) => matchesFilter(doc, filter));
        if (idx === -1) return null;
        const [removed] = store.splice(idx, 1);
        return { ...removed };
      },
      async deleteMany(filter = {}) {
        let deletedCount = 0;
        for (let i = store.length - 1; i >= 0; i--) {
          if (matchesFilter(store[i], filter)) {
            store.splice(i, 1);
            deletedCount += 1;
          }
        }
        return { deletedCount };
      },
      async updateMany(filter = {}, update = {}) {
        let modifiedCount = 0;
        for (const doc of store) {
          if (matchesFilter(doc, filter)) {
            if (update.$set) Object.assign(doc, update.$set);
            modifiedCount += 1;
          }
        }
        return { modifiedCount };
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
    plugins: [apiMockPlugin()],
  });
  ({ default: apiHandler } = await vite.ssrLoadModule("/api/[...path].js"));
  ({ Modal, CoursesPage, CoursePage, ProposalPage } = await vite.ssrLoadModule("/src/App.jsx"));
});

beforeEach(() => {
  apiState = {
    user: testUser,
    ownedCourses: new Set([courseId]),
    queries: [],
    query(sql, values = []) {
      apiState.queries.push({ sql, values });
      if (sql.includes("DELETE FROM courses WHERE id=$1 AND user_id=$2")) {
        const [id, uid] = values;
        if (uid === testUser.id && apiState.ownedCourses.has(id)) {
          apiState.ownedCourses.delete(id);
          return Promise.resolve({ rows: [{ id, goal_id: "goal-1", title: "Distributed Systems" }] });
        }
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes("DELETE FROM rag_chunks")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
  globalThis.__drizzlearnDeleteTest = apiState;
});

after(async () => {
  setDbProvider(null);
  delete globalThis.__drizzlearnDeleteTest;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
  await vite?.close();
});

test("DELETE /api/courses/:id validates UUID, enforces ownership, and cleans lesson RAG chunks", async () => {
  const badUuid = await callApi({ path: "courses/not-a-uuid", method: "DELETE" });
  assert.equal(badUuid.status, 404);
  assert.equal(badUuid.json.error.code, "NOT_FOUND");
  assert.equal(apiState.queries.length, 0);

  const missingCourse = await callApi({ path: `courses/${proposalId}`, method: "DELETE" });
  assert.equal(missingCourse.status, 404);
  assert.equal(missingCourse.json.error.code, "NOT_FOUND");
  assert.equal(
    apiState.queries.some((q) => q.sql.includes("DELETE FROM rag_chunks")),
    false,
    "must not delete RAG chunks when course does not exist or is not owned"
  );

  const deleted = await callApi({ path: `courses/${courseId}`, method: "DELETE" });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, { deleted: true, id: courseId });
  assert.equal(apiState.ownedCourses.has(courseId), false);
  const ragDelete = apiState.queries.find((q) => q.sql.includes("DELETE FROM rag_chunks"));
  assert.ok(ragDelete);
  assert.deepEqual(ragDelete.values, [testUser.id, "lesson", courseId]);
});

test("MongoDB adapter enforces ownership on DELETE FROM courses and preserves unlinked notes/flashcards", async () => {
  const seed = {
    courses: [{ id: courseId, user_id: testUser.id, goal_id: "goal-1", title: "Distributed Systems", status: "active" }],
    course_modules: [{ id: "mod-1", course_id: courseId, position: 1, title: "Replication" }],
    lessons: [
      { id: "lesson-1", course_id: courseId, module_id: "mod-1", title: "Leader election" },
      { id: "lesson-2", course_id: courseId, module_id: "mod-1", title: "Quorums" },
    ],
    study_tasks: [{ id: "task-1", user_id: testUser.id, course_id: courseId, lesson_id: "lesson-1", status: "upcoming" }],
    notes: [
      { id: "note-1", user_id: testUser.id, course_id: courseId, lesson_id: "lesson-1", title: "Raft notes" },
      { id: "note-other", user_id: otherUserId, course_id: "other-c", lesson_id: "other-l", title: "Private note" },
    ],
    flashcards: [{ id: "card-1", user_id: testUser.id, course_id: courseId, lesson_id: "lesson-2", front: "Quorum?", back: "N/2 + 1" }],
    rag_chunks: [
      { id: "chunk-lesson", user_id: testUser.id, source_type: "lesson", source_id: "lesson-1", course_id: courseId, lesson_id: "lesson-1" },
      { id: "chunk-note", user_id: testUser.id, source_type: "note", source_id: "note-1", course_id: courseId, lesson_id: "lesson-1" },
    ],
  };
  const { data, db } = makeMockMongoDb(seed);
  setDbProvider(async () => db);

  // Wrong owner cannot delete course or wipe any child collections
  const blocked = await executeMongoQuery(
    "DELETE FROM courses WHERE id=$1 AND user_id=$2 RETURNING id,goal_id,title",
    [courseId, otherUserId]
  );
  assert.deepEqual(blocked.rows, []);
  assert.equal(data.courses.length, 1);
  assert.equal(data.course_modules.length, 1);
  assert.equal(data.lessons.length, 2);
  assert.equal(data.study_tasks.length, 1);
  assert.equal(data.rag_chunks.length, 2);

  // Owner deletion removes course/modules/lessons/tasks and lesson RAG chunks while unlinking notes/cards
  const removed = await executeMongoQuery(
    "DELETE FROM courses WHERE id=$1 AND user_id=$2 RETURNING id,goal_id,title",
    [courseId, testUser.id]
  );
  assert.equal(removed.rows.length, 1);
  assert.equal(removed.rows[0].id, courseId);
  assert.equal(data.courses.length, 0);
  assert.equal(data.course_modules.length, 0);
  assert.equal(data.lessons.length, 0);
  assert.equal(data.study_tasks.length, 0);

  assert.equal(data.notes.length, 2);
  assert.equal(data.notes[0].course_id, null);
  assert.equal(data.notes[0].lesson_id, null);
  assert.equal(data.notes[1].course_id, "other-c");

  assert.equal(data.flashcards.length, 1);
  assert.equal(data.flashcards[0].course_id, null);
  assert.equal(data.flashcards[0].lesson_id, null);

  assert.equal(data.rag_chunks.length, 1);
  assert.equal(data.rag_chunks[0].id, "chunk-note");
  assert.equal(data.rag_chunks[0].course_id, null);
  assert.equal(data.rag_chunks[0].lesson_id, null);
});

test("CoursesPage, CoursePage, ProposalPage, and delete-course confirmation modal render accessible delete controls and error states", () => {
  const activeCourse = {
    id: courseId,
    title: "Distributed Systems",
    summary: "Master consensus and fault tolerance.",
    status: "active",
    target_weeks: 6,
    estimated_minutes: 360,
    modules: [{ id: "m1", title: "Consensus", objective: "Understand Raft", lessons: [{ id: "l1", title: "Log replication", objective: "Trace leader append" }] }],
  };
  const draftCourse = {
    id: proposalId,
    title: "Compiler Design Draft",
    summary: "Build a bytecode VM.",
    status: "proposal",
    durationWeeks: 4,
    estimated_minutes: 240,
    modules: [{ id: "m2", title: "Lexing", objective: "Tokenize source", lessons: [{ id: "l2", title: "Scanner", objective: "Build lexer" }] }],
  };
  const baseData = { courses: [activeCourse, draftCourse], tasks: [], settings: { weeklyMinutes: 360 } };

  const libraryHtml = renderToStaticMarkup(
    React.createElement(CoursesPage, {
      data: baseData,
      courseFilter: "all",
      setCourseFilter() {},
      go() {},
      updateData() {},
      setProposal() {},
      confirmDeleteCourse() {},
      deletingCourseId: null,
    })
  );
  assert.ok(libraryHtml.includes('aria-label="Delete Distributed Systems"'));
  assert.ok(libraryHtml.includes('aria-label="Delete Compiler Design Draft"'));

  const detailHtml = renderToStaticMarkup(
    React.createElement(CoursePage, {
      activeCourse,
      data: baseData,
      progressPercent: 0,
      go() {},
      updateData() {},
      request: async () => ({}),
      refreshRemote: async () => {},
      flashToast() {},
      openLesson() {},
      setActiveLessonId() {},
      confirmDeleteCourse() {},
      deletingCourseId: null,
    })
  );
  assert.ok(detailHtml.includes("course-hero-actions"));
  assert.ok(detailHtml.includes("Delete course"));

  const proposalHtml = renderToStaticMarkup(
    React.createElement(ProposalPage, {
      proposal: draftCourse,
      activeCourse: draftCourse,
      data: baseData,
      busy: false,
      remote: true,
      go() {},
      updateData() {},
      setProposal() {},
      approveProposal() {},
      confirmDeleteCourse() {},
      deletingCourseId: null,
    })
  );
  assert.ok(proposalHtml.includes("Delete proposal"));

  const modalHtml = renderToStaticMarkup(
    React.createElement(Modal, {
      modal: { type: "delete-course", course: activeCourse, redirectTo: "courses" },
      onClose() {},
      onDeleteCourse() {},
      deletingCourse: false,
      deleteCourseError: "Database temporarily unavailable.",
    })
  );
  assert.ok(modalHtml.includes("Delete course?"));
  assert.ok(modalHtml.includes("Distributed Systems"));
  assert.ok(modalHtml.includes("Any notes or flashcards you saved stay in your workspace."));
  assert.ok(modalHtml.includes('role="alert">Database temporarily unavailable.</p>'));
  assert.ok(modalHtml.includes("Cancel"));
  assert.ok(modalHtml.includes("danger-btn"));

  const busyModalHtml = renderToStaticMarkup(
    React.createElement(Modal, {
      modal: { type: "delete-course", course: draftCourse, redirectTo: "courses" },
      onClose() {},
      onDeleteCourse() {},
      deletingCourse: true,
      deleteCourseError: "",
    })
  );
  assert.ok(busyModalHtml.includes("Delete course proposal?"));
  assert.ok(busyModalHtml.includes("Deleting…"));
});
