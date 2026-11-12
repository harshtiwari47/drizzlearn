import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

const testUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "challenger@example.com",
  full_name: "Challenger Learner",
  timezone: "UTC",
  preferred_study_days: [1, 2, 3, 4, 5],
  session_minutes: 60,
  weekly_minutes: 300,
  notification_preferences: { study: true, review: true },
};

const validNoteId = "33333333-3333-4333-8333-333333333333";
const validFlashcardId = "44444444-4444-4444-8444-444444444444";

let vite;
let handler;
let state;

function mockPlugin() {
  const replacements = new Map([
    ["../server/db.js", "db"],
    ["../server/auth.js", "auth"],
    ["../server/email.js", "email"],
    ["../server/plan-service.js", "plans"],
    ["../server/ai.js", "ai"],
    ["../server/retrieval.js", "retrieval"],
  ]);
  return {
    name: "challenger-param-stress-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.includes("api/[...path].js")) return null;
      const replacement = replacements.get(source);
      return replacement ? `\0challenger-test:${replacement}` : null;
    },
    load(id) {
      if (!id.startsWith("\0challenger-test:")) return null;
      const mock = id.slice("\0challenger-test:".length);
      if (mock === "db") return `
        export async function query(...args) { return globalThis.__challengerApiTest.query(...args); }
        export async function withTransaction(work) { return work({ query: (...args) => globalThis.__challengerApiTest.query(...args) }); }
      `;
      if (mock === "auth") return `
        export async function requireUser() { return globalThis.__challengerApiTest.user; }
        export function sessionUserId() { return globalThis.__challengerApiTest.user.id; }
        export function createSessionCookie() { return "learnos_session=test; HttpOnly; Path=/; SameSite=Lax"; }
        export function clearSessionCookie() { return "learnos_session=; HttpOnly; Path=/; Max-Age=0"; }
      `;
      if (mock === "email") return `export async function sendEmail() { return { id: "email-test" }; }`;
      if (mock === "plans") return `
        export async function generateCourseProposal(...args) { return { id: "course-proposal" }; }
        export async function improveCourseProposal(...args) { return { id: "course-improved" }; }
        export async function approveCourse(...args) { return { course: { id: "course-1" } }; }
      `;
      if (mock === "ai") return `export async function tutorReply(...args) { return { text: "tutor", source: "test" }; }`;
      if (mock === "retrieval") return `export async function retrieveLearnerContext(...args) { return []; }`;
      return null;
    },
  };
}

function queryStub(sql, values = []) {
  state.queries.push({ sql, values });
  if (sql.includes("SELECT t.*,l.objective,c.title AS course_title FROM study_tasks")) {
    return Promise.resolve({
      rows: [
        { id: "task-1", user_id: testUser.id, title: "Task 1", scheduled_at: "2026-01-15T10:00:00Z" }
      ]
    });
  }
  if (sql.includes("UPDATE study_tasks SET status='overdue'")) {
    return Promise.resolve({ rows: [] });
  }
  if (sql.includes("SELECT n.*,c.title course_title,l.title lesson_title FROM notes n")) {
    return Promise.resolve({
      rows: state.noteFound ? [{ id: values[0], title: "Note 1", body: "Body 1" }] : []
    });
  }
  if (sql.includes("UPDATE notes SET")) {
    return Promise.resolve({
      rows: state.noteFound ? [{ id: values[2], title: values[0], body: values[1] }] : []
    });
  }
  if (sql.includes("DELETE FROM notes")) {
    return Promise.resolve({
      rows: state.noteFound ? [{ id: values[0] }] : []
    });
  }
  if (sql.includes("SELECT * FROM flashcards WHERE id=$1")) {
    return Promise.resolve({
      rows: state.cardFound ? [{ id: values[0], interval_days: 2, repetitions: 1, ease: 2.5 }] : []
    });
  }
  if (sql.includes("UPDATE flashcards SET due_at")) {
    return Promise.resolve({
      rows: state.cardFound ? [{ id: values[3], interval_days: values[1], due_at: values[0] }] : []
    });
  }
  if (sql.includes("DELETE FROM flashcards")) {
    return Promise.resolve({
      rows: state.cardFound ? [{ id: values[0] }] : []
    });
  }
  return Promise.resolve({ rows: [] });
}

async function callApi({ path, method = "GET", body, query = "" }) {
  const headers = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = "") { this.body = value; },
  };
  await handler({ url: `/api/${path}${query}`, method, headers: {}, body }, response);
  return { status: response.statusCode, headers, json: response.body ? JSON.parse(response.body) : null };
}

before(async () => {
  vite = await createServer({
    configFile: "./vite.config.js",
    logLevel: "silent",
    plugins: [mockPlugin()],
    server: { middlewareMode: true },
    appType: "custom",
  });
  ({ default: handler } = await vite.ssrLoadModule("/api/[...path].js"));
});

beforeEach(() => {
  state = {
    user: testUser,
    queries: [],
    noteFound: true,
    cardFound: true,
    query: queryStub,
  };
  globalThis.__challengerApiTest = state;
});

after(async () => {
  await vite?.close();
  delete globalThis.__challengerApiTest;
});

test("GET /api/tasks date filtering parameter adversarial stress tests", async (t) => {
  const malformedInputs = [
    { name: "not-a-date string", param: "from=not-a-date" },
    { name: "malformed to date", param: "to=definitely-not-a-date" },
    { name: "both dates malformed", param: "from=bad1&to=bad2" },
    { name: "empty from string", param: "from=" },
    { name: "empty to string", param: "to=" },
    { name: "empty both strings", param: "from=&to=" },
    { name: "whitespace only from", param: "from=%20%20%20" },
    { name: "whitespace only to", param: "to=%20" },
    { name: "literal null string in from", param: "from=null" },
    { name: "literal null string in to", param: "to=null" },
    { name: "literal undefined string", param: "from=undefined" },
    { name: "literal NaN string in from", param: "from=NaN" },
    { name: "literal NaN string in to", param: "to=NaN" },
    { name: "null byte in from", param: "from=%00" },
    { name: "null byte in to", param: "to=%00" },
    { name: "invalid month 13", param: "from=2026-13-10" },
    { name: "invalid day 32", param: "from=2026-01-32" },
    { name: "invalid hour 25", param: "from=2026-01-01T25:00:00Z" },
    { name: "invalid minute 60", param: "from=2026-01-01T12:60:00Z" },
    { name: "SQL injection quote in from", param: "from=%27%20OR%201=1;%20--" },
    { name: "SQL injection drop table in to", param: "to=%27;%20DROP%20TABLE%20study_tasks;%20--" },
    { name: "overflow numeric string", param: "from=1000000000000000000000000000" },
    { name: "boolean true string", param: "from=true" },
    { name: "boolean false string", param: "to=false" },
    { name: "script injection", param: "from=%3Cscript%3Ealert(1)%3C/script%3E" },
  ];

  for (const { name, param } of malformedInputs) {
    await t.test(`rejects malformed query: ${name} (${param})`, async () => {
      const res = await callApi({ path: "tasks", query: `?${param}` });
      assert.equal(res.status, 400, `Expected 400 for ${name}, got ${res.status}`);
      assert.equal(res.json?.error?.code, "INVALID_DATE");
      assert.equal(res.json?.error?.message, "Choose a valid date and time.");
      // Ensure database was NOT queried for tasks when validation fails
      assert.equal(state.queries.some(q => q.sql.includes("SELECT t.*,l.objective")), false, `Database query should not have run for ${name}`);
    });
  }

  const validInputs = [
    { name: "no query params", query: "" },
    { name: "standard ISO UTC range", query: "?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z" },
    { name: "epoch 0 (1970-01-01)", query: "?from=1970-01-01T00:00:00Z" },
    { name: "future date (9999-12-31)", query: "?to=9999-12-31T23:59:59Z" },
    { name: "leap year valid date (2024-02-29)", query: "?from=2024-02-29T00:00:00Z" },
    { name: "positive timezone offset (+05:30)", query: "?from=2026-06-01T00:00:00%2B05:30" },
    { name: "negative timezone offset (-08:00)", query: "?to=2026-06-01T00:00:00-08:00" },
    { name: "date-only format (2026-06-15)", query: "?from=2026-06-15" },
    { name: "only from parameter", query: "?from=2026-03-01T00:00:00Z" },
    { name: "only to parameter", query: "?to=2026-04-01T00:00:00Z" },
  ];

  for (const { name, query: q } of validInputs) {
    await t.test(`accepts valid query: ${name} (${q})`, async () => {
      const res = await callApi({ path: "tasks", query: q });
      assert.equal(res.status, 200, `Expected 200 for ${name}, got ${res.status}`);
      assert.ok(Array.isArray(res.json?.tasks), `Expected tasks array for ${name}`);
      assert.equal(state.queries.some(q => q.sql.includes("SELECT t.*,l.objective")), true);
    });
  }
});

test("/api/notes/:id adversarial UUID stress tests", async (t) => {
  const invalidIds = [
    { name: "short string", id: "not-a-uuid" },
    { name: "numeric only short", id: "12345" },
    { name: "partial uuid (24 chars)", id: "11111111-1111-4111-8111" },
    { name: "extended uuid (42 chars)", id: "11111111-1111-4111-8111-111111111111-extra" },
    { name: "invalid hex character 'g'", id: "11111111-1111-4111-8111-11111111111g" },
    { name: "invalid hex character 'z'", id: "11111111-1111-4111-8111-11111111111z" },
    { name: "sql injection quote", id: "%27%20OR%20%271%27=%271" },
    { name: "sql injection drop table", id: "%27;%20DROP%20TABLE%20notes;%20--" },
    { name: "sql injection union select", id: "%27%20UNION%20SELECT%20*%20FROM%20users%20--" },
    { name: "oversized string (1000 chars)", id: "a".repeat(1000) },
    { name: "null string", id: "null" },
    { name: "undefined string", id: "undefined" },
    { name: "path traversal dots", id: "..%2F..%2Fetc%2Fpasswd" },
    { name: "script tag without slash", id: "%3Cscript%3Ealert(1)%3E" },
    { name: "script tag with slash", id: "%3Cscript%3Ealert(1)%3C%2Fscript%3E" },
    { name: "null byte", id: "%00" },
  ];

  for (const method of ["GET", "PUT", "DELETE"]) {
    for (const { name, id } of invalidIds) {
      await t.test(`${method} /api/notes/:id rejects ${name} with 404 NOT_FOUND`, async () => {
        const body = method === "PUT" ? { title: "Title", body: "Body" } : undefined;
        const res = await callApi({ path: `notes/${id}`, method, body });
        assert.equal(res.status, 404, `Expected 404 for ${method} ${name}, got ${res.status}`);
        assert.equal(res.json?.error?.code, "NOT_FOUND");
        assert.ok(
          res.json?.error?.message === "Note was not found." || res.json?.error?.message === "API route was not found.",
          `Expected 404 message, got: ${res.json?.error?.message}`
        );
        // Ensure no query with this invalid ID reached the database
        assert.equal(state.queries.some(q => q.values.includes(id)), false, `Invalid ID ${id} leaked into DB query!`);
      });
    }
  }

  await t.test("GET /api/notes/:id accepts valid lowercase UUID and retrieves note", async () => {
    state.noteFound = true;
    const res = await callApi({ path: `notes/${validNoteId}`, method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json?.note?.id, validNoteId);
    assert.ok(state.queries.some(q => q.sql.includes("FROM notes n") && q.values.includes(validNoteId)));
  });

  await t.test("GET /api/notes/:id accepts valid uppercase UUID", async () => {
    state.noteFound = true;
    const upper = validNoteId.toUpperCase();
    const res = await callApi({ path: `notes/${upper}`, method: "GET" });
    assert.equal(res.status, 200);
    assert.ok(state.queries.some(q => q.sql.includes("FROM notes n") && q.values.includes(upper)));
  });

  await t.test("PUT /api/notes/:id accepts valid UUID and updates note", async () => {
    state.noteFound = true;
    const res = await callApi({ path: `notes/${validNoteId}`, method: "PUT", body: { title: "Updated", body: "New text" } });
    assert.equal(res.status, 200);
    assert.equal(res.json?.note?.title, "Updated");
    assert.ok(state.queries.some(q => q.sql.includes("UPDATE notes SET") && q.values.includes(validNoteId)));
  });

  await t.test("DELETE /api/notes/:id accepts valid UUID and removes note", async () => {
    state.noteFound = true;
    const res = await callApi({ path: `notes/${validNoteId}`, method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(res.json?.deleted, true);
    assert.ok(state.queries.some(q => q.sql.includes("DELETE FROM notes") && q.values.includes(validNoteId)));
  });
});

test("/api/flashcards/:id adversarial UUID stress tests", async (t) => {
  const invalidIds = [
    { name: "short string", id: "not-a-uuid" },
    { name: "numeric only short", id: "9876" },
    { name: "partial uuid (20 chars)", id: "44444444-4444-4444-8" },
    { name: "extended uuid (45 chars)", id: "44444444-4444-4444-8444-444444444444-overflow" },
    { name: "invalid hex character 'k'", id: "44444444-4444-4444-8444-44444444444k" },
    { name: "sql injection quote", id: "%27%20OR%201=1;%20--" },
    { name: "sql injection drop table", id: "%27;%20DROP%20TABLE%20flashcards;%20--" },
    { name: "oversized string (500 chars)", id: "f".repeat(500) },
    { name: "null string", id: "null" },
    { name: "undefined string", id: "undefined" },
    { name: "path traversal", id: "..%2F..%2Fflashcards" },
  ];

  for (const { name, id } of invalidIds) {
    await t.test(`DELETE /api/flashcards/:id rejects ${name} with 404 NOT_FOUND`, async () => {
      const res = await callApi({ path: `flashcards/${id}`, method: "DELETE" });
      assert.equal(res.status, 404, `Expected 404 for DELETE ${name}, got ${res.status}`);
      assert.equal(res.json?.error?.code, "NOT_FOUND");
      assert.equal(res.json?.error?.message, "Flashcard was not found.");
      assert.equal(state.queries.some(q => q.values.includes(id)), false);
    });

    await t.test(`POST /api/flashcards/:id/review rejects ${name} with 404 NOT_FOUND (before rating check)`, async () => {
      // Even with an invalid rating, the UUID check must fire first and return 404
      const res = await callApi({ path: `flashcards/${id}/review`, method: "POST", body: { rating: "InvalidRating" } });
      assert.equal(res.status, 404, `Expected 404 for POST review ${name}, got ${res.status}`);
      assert.equal(res.json?.error?.code, "NOT_FOUND");
      assert.equal(res.json?.error?.message, "Flashcard was not found.");
      assert.equal(state.queries.some(q => q.values.includes(id)), false);
    });
  }

  await t.test("DELETE /api/flashcards/:id accepts valid UUID", async () => {
    state.cardFound = true;
    const res = await callApi({ path: `flashcards/${validFlashcardId}`, method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(res.json?.deleted, true);
    assert.ok(state.queries.some(q => q.sql.includes("DELETE FROM flashcards") && q.values.includes(validFlashcardId)));
  });

  await t.test("POST /api/flashcards/:id/review accepts valid UUID with valid rating", async () => {
    state.cardFound = true;
    const res = await callApi({ path: `flashcards/${validFlashcardId}/review`, method: "POST", body: { rating: "Good" } });
    assert.equal(res.status, 200);
    assert.equal(res.json?.flashcard?.id, validFlashcardId);
  });

  await t.test("POST /api/flashcards/:id/review with valid UUID but invalid rating returns 400 INVALID_RATING", async () => {
    state.cardFound = true;
    const res = await callApi({ path: `flashcards/${validFlashcardId}/review`, method: "POST", body: { rating: "SuperGood" } });
    assert.equal(res.status, 400);
    assert.equal(res.json?.error?.code, "INVALID_RATING");
  });
});
