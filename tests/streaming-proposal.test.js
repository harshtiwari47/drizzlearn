import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const testUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "learner@example.com",
  full_name: "Sample Learner",
  timezone: "UTC",
  preferred_study_days: [1, 3, 5],
  session_minutes: 45,
  weekly_minutes: 360,
  notification_preferences: { study: true, review: true },
};

const sampleGoalId = "22222222-2222-4222-8222-222222222222";
const sampleCourseId = "33333333-3333-4333-8333-333333333333";

let apiVite;
let handler;
let apiState;

let uiVite;
let mergeStreamProgress;
let processNdjsonLine;
let requestStream;
let GenerationProgressCard;
let GoalPage;
let ProposalPage;

const localStorageValues = new Map();
const sessionStorageValues = new Map();

function apiMockPlugin() {
  const replacements = new Map([
    ["../server/db.js", "db"],
    ["../server/auth.js", "auth"],
    ["../server/email.js", "email"],
    ["../server/plan-service.js", "plans"],
    ["../server/materials-generator.js", "materials"],
    ["../server/ai.js", "ai"],
    ["../server/retrieval.js", "retrieval"],
    ["../server/rag-service.js", "rag"],
  ]);
  return {
    name: "drizzlearn-streaming-api-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.includes("api/[...path].js")) return null;
      const replacement = replacements.get(source);
      return replacement ? `\0stream-api-test:${replacement}` : null;
    },
    load(id) {
      if (!id.startsWith("\0stream-api-test:")) return null;
      const mock = id.slice("\0stream-api-test:".length);
      if (mock === "db") {
        return `
          export async function query(...args) { return globalThis.__drizzlearnStreamApiTest.query(...args); }
          export async function withTransaction(work) { return work({ query: (...args) => globalThis.__drizzlearnStreamApiTest.query(...args) }); }
          export function getPoolMockState() { return { connectMocked: true, queryMocked: true, pinnedQuery: globalThis.__drizzlearnStreamApiTest.query }; }
        `;
      }
      if (mock === "auth") {
        return `
          export async function requireUser() { return globalThis.__drizzlearnStreamApiTest.user; }
          export function sessionUserId() { return globalThis.__drizzlearnStreamApiTest.user?.id || null; }
          export function createSessionCookie() { return "learnos_session=test; HttpOnly; Path=/"; }
          export function clearSessionCookie() { return "learnos_session=; Max-Age=0"; }
        `;
      }
      if (mock === "email") return `export async function sendEmail() { return { id: "e1" }; }`;
      if (mock === "plans") {
        return `
          export async function generateCourseProposal(...args) { return globalThis.__drizzlearnStreamApiTest.generateCourseProposal(...args); }
          export async function improveCourseProposal(...args) { return globalThis.__drizzlearnStreamApiTest.improveCourseProposal(...args); }
          export async function approveCourse(...args) { return globalThis.__drizzlearnStreamApiTest.approveCourse(...args); }
        `;
      }
      if (mock === "materials") {
        return `export async function getCourseMaterialsStatus() { return { status: "ready" }; }`;
      }
      if (mock === "ai") {
        return `export async function tutorReply() { return { text: "ok", source: "nvidia" }; }`;
      }
      if (mock === "retrieval") {
        return `export async function retrieveLearnerContext() { return []; }`;
      }
      if (mock === "rag") {
        return `
          export async function indexUserSource() {}
          export async function deleteUserSourceChunks() {}
          export async function reindexUserCorpus() { return { indexed: 0 }; }
          export async function getRagStatus() { return { ready: true }; }
        `;
      }
      return null;
    },
  };
}

function uiExportPlugin() {
  return {
    name: "drizzlearn-expose-app-stream-helpers",
    enforce: "pre",
    transform(code, id) {
      if (id.replace(/\\/g, "/").endsWith("/src/App.jsx")) {
        return {
          code: `${code}\nexport { mergeStreamProgress, processNdjsonLine, requestStream, GenerationProgressCard, GoalPage, ProposalPage };`,
          map: null,
        };
      }
      return null;
    },
  };
}

function createStreamingResponseMock() {
  const headers = new Map();
  const listeners = new Map();
  const chunks = [];
  const res = {
    statusCode: 200,
    writableEnded: false,
    destroyed: false,
    flushedHeaders: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
    },
    flushHeaders() {
      res.flushedHeaders = true;
    },
    on(event, fn) {
      const list = listeners.get(event) || [];
      list.push(fn);
      listeners.set(event, list);
    },
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    end(chunk = "") {
      if (chunk) chunks.push(String(chunk));
      res.writableEnded = true;
      for (const fn of listeners.get("close") || []) fn();
    },
  };
  return {
    res,
    headers,
    chunks,
    rawBody() {
      return chunks.join("");
    },
    frames() {
      return chunks
        .join("")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    },
  };
}

before(async () => {
  globalThis.localStorage = {
    getItem: (key) => localStorageValues.get(key) || null,
    setItem: (key, value) => localStorageValues.set(key, String(value)),
    removeItem: (key) => localStorageValues.delete(key),
  };
  globalThis.sessionStorage = {
    getItem: (key) => sessionStorageValues.get(key) || null,
    setItem: (key, value) => sessionStorageValues.set(key, String(value)),
    removeItem: (key) => sessionStorageValues.delete(key),
  };

  apiVite = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [apiMockPlugin()],
    server: { middlewareMode: true },
    appType: "custom",
  });
  ({ default: handler } = await apiVite.ssrLoadModule("/api/[...path].js"));

  uiVite = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [react(), uiExportPlugin()],
    server: { middlewareMode: true },
    appType: "custom",
  });
  ({
    mergeStreamProgress,
    processNdjsonLine,
    requestStream,
    GenerationProgressCard,
    GoalPage,
    ProposalPage,
  } = await uiVite.ssrLoadModule("/src/App.jsx"));
});

beforeEach(() => {
  localStorageValues.clear();
  sessionStorageValues.clear();
  apiState = {
    user: testUser,
    query: async () => ({ rows: [] }),
    generateCourseProposal: async (_userId, goalId, opts) => {
      opts?.onProgress?.({ stage: "outline_ready", percent: 25, message: "Outline ready.", model: "gemini-3.5-flash", provider: "gemini" });
      opts?.onProgress?.({ stage: "module_done", percent: 60, completedModules: 1, totalModules: 2, message: "Drafted module 1/2." });
      opts?.onProgress?.({ stage: "finalizing", percent: 96, message: "Course structure validated." });
      return { id: sampleCourseId, goalId, title: "Streamed Course", status: "proposal" };
    },
    improveCourseProposal: async (_userId, courseId, feedback, opts) => {
      opts?.onProgress?.({ stage: "outline_ready", percent: 25, message: "Revising outline.", model: "nvidia/nemotron-3.5-lightning-30b-a3b", provider: "nvidia" });
      opts?.onProgress?.({ stage: "finalizing", percent: 96, message: "Revision validated." });
      return { id: courseId, title: "Improved Streamed Course", feedback, status: "proposal" };
    },
    approveCourse: async () => ({ approved: true }),
  };
  globalThis.__drizzlearnStreamApiTest = apiState;
});

after(async () => {
  await apiVite?.close();
  await uiVite?.close();
  delete globalThis.__drizzlearnStreamApiTest;
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

test("POST /api/goals/:id/proposal?stream=1 and Accept: application/x-ndjson stream progress and complete NDJSON frames", async () => {
  for (const requestConfig of [
    { url: `/api/goals/${sampleGoalId}/proposal?stream=1`, headers: {} },
    { url: `/api/goals/${sampleGoalId}/proposal`, headers: { accept: "application/x-ndjson" } },
  ]) {
    const mock = createStreamingResponseMock();
    await handler(
      {
        url: requestConfig.url,
        method: "POST",
        headers: requestConfig.headers,
        body: {},
      },
      mock.res
    );

    assert.equal(mock.res.statusCode, 200);
    assert.equal(mock.res.flushedHeaders, true);
    assert.equal(mock.res.writableEnded, true);
    assert.equal(mock.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    assert.equal(mock.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(mock.headers.get("connection"), "keep-alive");

    const frames = mock.frames();
    assert.equal(frames.length, 5);
    assert.deepEqual(
      frames.map((f) => f.type),
      ["progress", "progress", "progress", "progress", "complete"]
    );
    assert.equal(frames[0].stage, "initializing");
    assert.equal(frames[0].percent, 5);
    assert.equal(frames[1].stage, "outline_ready");
    assert.equal(frames[1].model, "gemini-3.5-flash");
    assert.equal(frames[1].provider, "gemini");
    assert.equal(frames[2].stage, "module_done");
    assert.equal(frames[3].stage, "finalizing");
    assert.equal(frames[4].course.id, sampleCourseId);
    assert.equal(frames[4].course.title, "Streamed Course");
  }
});

test("POST /api/courses/:id/improve?stream=1 and Accept header stream revision progress while still validating short feedback", async () => {
  // 1. Short feedback returns 400 JSON before opening stream
  const badMock = createStreamingResponseMock();
  await handler(
    {
      url: `/api/courses/${sampleCourseId}/improve?stream=1`,
      method: "POST",
      headers: { accept: "application/x-ndjson" },
      body: { feedback: "short" },
    },
    badMock.res
  );
  assert.equal(badMock.res.statusCode, 400);
  assert.equal(JSON.parse(badMock.rawBody()).error.code, "IMPROVEMENT_FEEDBACK_REQUIRED");

  // 2. Valid feedback streams NDJSON progress and complete frames
  const okMock = createStreamingResponseMock();
  await handler(
    {
      url: `/api/courses/${sampleCourseId}/improve?stream=1`,
      method: "POST",
      headers: {},
      body: { feedback: "Add worked examples to every module." },
    },
    okMock.res
  );

  assert.equal(okMock.res.statusCode, 200);
  assert.equal(okMock.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
  const frames = okMock.frames();
  assert.deepEqual(
    frames.map((f) => f.type),
    ["progress", "progress", "progress", "complete"]
  );
  assert.equal(frames[0].stage, "initializing");
  assert.equal(frames[1].provider, "nvidia");
  assert.equal(frames[3].course.title, "Improved Streamed Course");
  assert.equal(frames[3].course.feedback, "Add worked examples to every module.");
});

test("NDJSON stream emits heartbeat frames every 2.5s while waiting and clears interval after completion", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "Date"] });
  t.after(() => {
    t.mock.timers.reset();
  });

  let releaseGeneration;
  apiState.generateCourseProposal = () =>
    new Promise((resolve) => {
      releaseGeneration = resolve;
    });

  const mock = createStreamingResponseMock();
  const pending = handler(
    {
      url: `/api/goals/${sampleGoalId}/proposal?stream=1`,
      method: "POST",
      headers: {},
      body: {},
    },
    mock.res
  );

  // Flush async microtasks until handleProposalStreamOrJson enters await work(onProgress)
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(mock.frames().length, 1, "initial progress frame should already be written");

  t.mock.timers.tick(2_500);
  t.mock.timers.tick(2_500);
  const midFrames = mock.frames();
  assert.equal(midFrames.length, 3);
  assert.equal(midFrames[1].type, "heartbeat");
  assert.equal(typeof midFrames[1].ts, "number");
  assert.equal(midFrames[2].type, "heartbeat");

  releaseGeneration({ id: sampleCourseId, title: "Finished After Heartbeat" });
  await pending;

  const finalFrames = mock.frames();
  assert.equal(finalFrames.length, 4);
  assert.equal(finalFrames[3].type, "complete");
  assert.equal(mock.res.writableEnded, true);

  // Advancing timer further must not emit extra heartbeats after cleanup
  t.mock.timers.tick(10_000);
  assert.equal(mock.frames().length, 4);
});

test("NDJSON stream emits sanitized error frames for 404, AI_TIMEOUT, 409, and unexpected errors without leaking details", async () => {
  // 1. Missing goal -> 404 NOT_FOUND frame
  apiState.generateCourseProposal = async () => null;
  const notFoundMock = createStreamingResponseMock();
  await handler(
    { url: `/api/goals/${sampleGoalId}/proposal?stream=1`, method: "POST", headers: {}, body: {} },
    notFoundMock.res
  );
  const notFoundFrames = notFoundMock.frames();
  assert.equal(notFoundFrames[notFoundFrames.length - 1].type, "error");
  assert.equal(notFoundFrames[notFoundFrames.length - 1].status, 404);
  assert.equal(notFoundFrames[notFoundFrames.length - 1].error.code, "NOT_FOUND");
  assert.equal(notFoundFrames[notFoundFrames.length - 1].error.message, "Goal was not found.");

  // 2. AI_TIMEOUT -> 504 error frame with retryable: false
  apiState.generateCourseProposal = async () => {
    const err = new Error("Gemini exceeded the request time budget. Retry in a moment; no partial course was saved and any existing proposal is unchanged.");
    err.code = "AI_TIMEOUT";
    err.retryable = false;
    throw err;
  };
  const timeoutMock = createStreamingResponseMock();
  await handler(
    { url: `/api/goals/${sampleGoalId}/proposal?stream=1`, method: "POST", headers: {}, body: {} },
    timeoutMock.res
  );
  const timeoutErr = timeoutMock.frames().at(-1);
  assert.equal(timeoutErr.type, "error");
  assert.equal(timeoutErr.status, 504);
  assert.equal(timeoutErr.error.code, "AI_TIMEOUT");
  assert.equal(timeoutErr.error.details.retryable, false);

  // 3. COURSE_NOT_PROPOSAL -> 409 error frame on improve
  apiState.improveCourseProposal = async () => {
    const err = new Error("This proposal was already approved or is no longer available.");
    err.code = "COURSE_NOT_PROPOSAL";
    throw err;
  };
  const conflictMock = createStreamingResponseMock();
  await handler(
    {
      url: `/api/courses/${sampleCourseId}/improve?stream=1`,
      method: "POST",
      headers: {},
      body: { feedback: "Make checkpoints harder and add examples." },
    },
    conflictMock.res
  );
  const conflictErr = conflictMock.frames().at(-1);
  assert.equal(conflictErr.type, "error");
  assert.equal(conflictErr.status, 409);
  assert.equal(conflictErr.error.code, "COURSE_NOT_PROPOSAL");

  // 4. Unexpected non-typed error -> sanitized 500 INTERNAL_ERROR without leaking internal string
  apiState.generateCourseProposal = async () => {
    throw new Error("internal postgres password=super-secret-value");
  };
  const internalMock = createStreamingResponseMock();
  await handler(
    { url: `/api/goals/${sampleGoalId}/proposal?stream=1`, method: "POST", headers: {}, body: {} },
    internalMock.res
  );
  const raw = internalMock.rawBody();
  assert.equal(raw.includes("super-secret-value"), false);
  const internalErr = internalMock.frames().at(-1);
  assert.equal(internalErr.type, "error");
  assert.equal(internalErr.status, 500);
  assert.equal(internalErr.error.code, "INTERNAL_ERROR");
  assert.equal(internalErr.error.message, "The request could not be completed.");
});

test("default non-stream proposal and improve endpoints continue returning standard JSON", async () => {
  let receivedProposalOpts = "sentinel";
  apiState.generateCourseProposal = async (_userId, goalId, opts) => {
    receivedProposalOpts = opts;
    return { id: sampleCourseId, goalId, title: "Standard JSON Course" };
  };
  const propMock = createStreamingResponseMock();
  await handler(
    { url: `/api/goals/${sampleGoalId}/proposal`, method: "POST", headers: {}, body: {} },
    propMock.res
  );
  assert.equal(propMock.res.statusCode, 201);
  assert.equal(receivedProposalOpts, undefined);
  assert.match(propMock.headers.get("content-type"), /application\/json/);
  assert.equal(JSON.parse(propMock.rawBody()).course.title, "Standard JSON Course");

  let receivedImproveOpts = "sentinel";
  apiState.improveCourseProposal = async (_userId, courseId, feedback, opts) => {
    receivedImproveOpts = opts;
    return { id: courseId, title: "Standard Improved JSON", feedback };
  };
  const impMock = createStreamingResponseMock();
  await handler(
    {
      url: `/api/courses/${sampleCourseId}/improve`,
      method: "POST",
      headers: {},
      body: { feedback: "Add more practical exercises." },
    },
    impMock.res
  );
  assert.equal(impMock.res.statusCode, 200);
  assert.equal(receivedImproveOpts, undefined);
  assert.match(impMock.headers.get("content-type"), /application\/json/);
  assert.equal(JSON.parse(impMock.rawBody()).course.title, "Standard Improved JSON");
});

test("plan-service forwards onProgress to generatePlan in generateCourseProposal and improveCourseProposal without opening MongoClient", async () => {
  const seenCalls = [];
  const planServiceVite = await createServer({
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        name: "drizzlearn-plan-service-progress-mock",
        enforce: "pre",
        resolveId(source, importer) {
          if (!importer?.includes("server/plan-service.js")) return null;
          if (source === "./db.js") return "\0ps-test:db";
          if (source === "./ai.js") return "\0ps-test:ai";
          if (source === "./retrieval.js") return "\0ps-test:retrieval";
          if (source === "./materials-generator.js") return "\0ps-test:materials";
          return null;
        },
        load(id) {
          if (!id.startsWith("\0ps-test:")) return null;
          const name = id.slice("\0ps-test:".length);
          if (name === "db") {
            return `
              export async function query(...args) { return globalThis.__psProgressTest.query(...args); }
              export async function withTransaction(work) { return work({ query: (...args) => globalThis.__psProgressTest.query(...args) }); }
              export function getPoolMockState() { return { connectMocked: true, queryMocked: true, pinnedQuery: globalThis.__psProgressTest.query }; }
            `;
          }
          if (name === "ai") {
            return `
              export async function generatePlan(goal, opts) {
                globalThis.__psProgressTest.calls.push({ goalId: goal.id, hasOnProgress: typeof opts?.onProgress === "function" });
                opts?.onProgress?.({ stage: "outline_ready", percent: 25, message: "Outline ready" });
                return {
                  title: "Mock Plan",
                  summary: "Summary",
                  durationWeeks: 6,
                  estimatedMinutes: 60,
                  assumptions: [],
                  generationMode: "multi-agent",
                  modules: [{ title: "M1", objective: "Obj", rationale: "", prerequisites: [], estimatedMinutes: 60, sourceRefs: [], lessons: [{ title: "L1", objective: "Obj", prerequisites: [], content: "x".repeat(50), workedExample: "y".repeat(30), checkpoint: { question: "Q?", options: ["A", "B"], answerIndex: 0, explanation: "E" }, estimatedMinutes: 60, sourceRefs: [] }] }],
                };
              }
            `;
          }
          if (name === "retrieval") return `export async function retrieveLearnerContext() { return []; }`;
          if (name === "materials") return `export async function generateCourseMaterials() {}`;
          return null;
        },
      },
    ],
    server: { middlewareMode: true },
    appType: "custom",
  });

  globalThis.__psProgressTest = {
    calls: seenCalls,
    query: async (sql) => {
      if (sql.includes("SELECT * FROM learning_goals")) {
        return { rows: [{ id: sampleGoalId, topic: "SQL", desired_outcome: "Write SQL", weekly_minutes: 180, target_weeks: 6 }] };
      }
      if (sql.includes("SELECT c.*,g.topic")) {
        return { rows: [{ id: sampleCourseId, goal_id: sampleGoalId, title: "Draft", summary: "S", target_weeks: 6, assumptions: [], topic: "SQL", desired_outcome: "Write SQL", weekly_minutes: 180 }] };
      }
      if (sql.includes("SELECT m.*,COALESCE")) return { rows: [] };
      if (sql.includes("SELECT id,status FROM courses")) return { rows: [{ id: sampleCourseId, status: "proposal" }] };
      return { rows: [] };
    },
  };

  try {
    const { generateCourseProposal, improveCourseProposal } = await planServiceVite.ssrLoadModule("/server/plan-service.js");
    const events1 = [];
    await generateCourseProposal(testUser.id, sampleGoalId, { onProgress: (e) => events1.push(e) });
    assert.equal(seenCalls[0].hasOnProgress, true);
    assert.equal(events1.length, 1);

    const events2 = [];
    await improveCourseProposal(testUser.id, sampleCourseId, "Make it deeper", { onProgress: (e) => events2.push(e) });
    assert.equal(seenCalls[1].hasOnProgress, true);
    assert.equal(events2.length, 1);
  } finally {
    await planServiceVite.close();
    delete globalThis.__psProgressTest;
  }
});

test("client NDJSON helpers (mergeStreamProgress, processNdjsonLine, requestStream) handle chunked streams, heartbeats, errors, and JSON fallback", async (t) => {
  // 1. mergeStreamProgress monotonic clamping and field retention
  const s1 = mergeStreamProgress(null, { stage: "outline_ready", percent: 25.4, message: "Outline ready", model: "gemini-3.5-flash", provider: "gemini" });
  assert.deepEqual(s1, {
    stage: "outline_ready",
    percent: 25,
    message: "Outline ready",
    model: "gemini-3.5-flash",
    provider: "gemini",
  });

  // Never regresses percent and preserves model/provider when omitted
  const s2 = mergeStreamProgress(s1, { stage: "module_done", percent: 10, message: "Module 1 done" });
  assert.equal(s2.percent, 25);
  assert.equal(s2.model, "gemini-3.5-flash");
  assert.equal(s2.provider, "gemini");
  assert.equal(s2.message, "Module 1 done");

  // Clamps > 100
  const s3 = mergeStreamProgress(s2, { percent: 130 });
  assert.equal(s3.percent, 100);

  // 2. processNdjsonLine frame handling
  const progressCalls = [];
  assert.equal(processNdjsonLine("   ", (f) => progressCalls.push(f)), null);
  assert.equal(processNdjsonLine("not-valid-json", (f) => progressCalls.push(f)), null);
  assert.equal(processNdjsonLine(JSON.stringify({ type: "heartbeat", ts: 1234 }), (f) => progressCalls.push(f)), null);
  assert.equal(progressCalls.length, 0);

  assert.equal(
    processNdjsonLine(JSON.stringify({ type: "progress", stage: "module_done", percent: 55, message: "Module 2" }), (f) =>
      progressCalls.push(f)
    ),
    null
  );
  assert.equal(progressCalls.length, 1);
  assert.equal(progressCalls[0].percent, 55);

  const completed = processNdjsonLine(JSON.stringify({ type: "complete", course: { id: "c1", title: "SQL" } }));
  assert.deepEqual(completed, { course: { id: "c1", title: "SQL" } });

  assert.throws(
    () =>
      processNdjsonLine(
        JSON.stringify({
          type: "error",
          status: 504,
          error: { code: "AI_TIMEOUT", message: "Provider timed out.", details: { retryable: false } },
        })
      ),
    (err) => err.code === "AI_TIMEOUT" && err.details.retryable === false && /timed out/.test(err.message)
  );

  assert.throws(() => processNdjsonLine("<!doctype html><html></html>"), /npm run dev:vercel/);

  // 3. requestStream parses split chunked NDJSON, skips heartbeats, sends Accept header, and surfaces stream errors
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  // 3a. Split NDJSON stream across chunks
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/goals/g1/proposal?stream=1");
    assert.equal(init.headers.Accept, "application/x-ndjson");
    const line1 = `${JSON.stringify({ type: "progress", stage: "initializing", percent: 5, message: "Init" })}\n`;
    const line2 = `${JSON.stringify({ type: "heartbeat", ts: 10 })}\n`;
    const line3 = `${JSON.stringify({ type: "progress", stage: "outline_ready", percent: 25, message: "Outline ready", model: "gemini-3.5-flash" })}\n`;
    const line4 = `${JSON.stringify({ type: "complete", course: { id: "c-stream", title: "Streamed SQL" } })}\n`;
    const combined = line1 + line2 + line3 + line4;
    const mid = Math.floor(combined.length / 2);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(combined.slice(0, mid)));
        controller.enqueue(encoder.encode(combined.slice(mid)));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
    });
  };

  const streamedFrames = [];
  const resObj = await requestStream("goals/g1/proposal?stream=1", { method: "POST", body: "{}" }, (frame) => {
    streamedFrames.push(frame);
  });
  assert.equal(resObj.course.id, "c-stream");
  assert.deepEqual(
    streamedFrames.map((f) => f.stage),
    ["initializing", "outline_ready"]
  );

  // 3b. NDJSON error frame mid-stream throws typed error
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body =
      `${JSON.stringify({ type: "progress", stage: "initializing", percent: 5, message: "Init" })}\n` +
      `${JSON.stringify({ type: "error", status: 504, error: { code: "AI_TIMEOUT", message: "Timed out", details: { retryable: false } } })}\n`;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } }
    );
  };
  await assert.rejects(
    requestStream("goals/g1/proposal?stream=1", { method: "POST", body: "{}" }),
    (err) => err.code === "AI_TIMEOUT" && err.details.retryable === false
  );

  // 3c. Truncated stream without complete frame throws STREAM_INCOMPLETE
  globalThis.fetch = async () => {
    const encoder = new TextEncoder();
    const body = `${JSON.stringify({ type: "progress", stage: "initializing", percent: 5, message: "Init" })}\n`;
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } }
    );
  };
  await assert.rejects(
    requestStream("goals/g1/proposal?stream=1", { method: "POST", body: "{}" }),
    (err) => err.code === "STREAM_INCOMPLETE"
  );

  // 3d. Standard application/json fallback works cleanly
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ course: { id: "c-json", title: "JSON fallback" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const jsonFallback = await requestStream("goals/g1/proposal?stream=1", { method: "POST", body: "{}" });
  assert.equal(jsonFallback.course.id, "c-json");

  // 3e. Non-OK JSON error surfaces typed API error
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { code: "INVALID_GOAL", message: "Topic is required." } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  await assert.rejects(
    requestStream("goals/g1/proposal?stream=1", { method: "POST", body: "{}" }),
    (err) => err.code === "INVALID_GOAL" && /Topic is required/.test(err.message)
  );
});

test("GenerationProgressCard, GoalPage, and ProposalPage render accessible streaming progress and recoverable error states", (t) => {
  globalThis.window = { location: { hash: "#/goal" }, addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    delete globalThis.window;
  });

  // 1. GenerationProgressCard with active model badge and percentage
  const cardHtml = renderToStaticMarkup(
    React.createElement(GenerationProgressCard, {
      progress: {
        stage: "module_done",
        percent: 62,
        message: "Drafted module 2/4: Relational joins",
        model: "gemini-3.5-flash",
        provider: "gemini",
      },
      ariaLabel: "Course generation progress",
      note: "Adaptive multi-model routing active.",
    })
  );
  assert.match(cardHtml, /role="status"/);
  assert.match(cardHtml, /aria-live="polite"/);
  assert.match(cardHtml, /role="progressbar"/);
  assert.match(cardHtml, /aria-label="Course generation progress"/);
  assert.match(cardHtml, /aria-valuenow="62"/);
  assert.match(cardHtml, /aria-valuemin="0"/);
  assert.match(cardHtml, /aria-valuemax="100"/);
  assert.match(cardHtml, /Drafted module 2\/4: Relational joins/);
  assert.match(cardHtml, /62%/);
  assert.match(cardHtml, /aria-label="Active model: gemini-3\.5-flash"/);
  assert.match(cardHtml, /title="gemini · gemini-3\.5-flash"/);
  assert.match(cardHtml, /width:62%/);
  assert.match(cardHtml, /Adaptive multi-model routing active\./);

  const noModelHtml = renderToStaticMarkup(
    React.createElement(GenerationProgressCard, {
      progress: { stage: "initializing", percent: 5, message: "Starting...", model: "", provider: "" },
    })
  );
  assert.doesNotMatch(noModelHtml, /generation-model-badge/);
  assert.match(noModelHtml, /5%/);

  // 2. GoalPage renders live progress card while busy=true
  const goalBusyHtml = renderToStaticMarkup(
    React.createElement(GoalPage, {
      data: { settings: { weeklyMinutes: 360 } },
      remote: true,
      busy: true,
      generationProgress: {
        stage: "outline_ready",
        percent: 25,
        message: "Curriculum outline ready (4 modules, 8 lessons).",
        model: "gemini-3.5-flash",
        provider: "gemini",
      },
      generationError: "",
      setGenerationError() {},
      submitGoal() {},
    })
  );
  assert.match(goalBusyHtml, /Curriculum outline ready \(4 modules, 8 lessons\)\./);
  assert.match(goalBusyHtml, /25%/);
  assert.match(goalBusyHtml, /Building your plan…/);
  assert.doesNotMatch(goalBusyHtml, /Course generation paused:/);

  // 3. GoalPage renders recoverable error alert with retry and dismiss when busy=false
  const goalErrorHtml = renderToStaticMarkup(
    React.createElement(GoalPage, {
      data: { settings: { weeklyMinutes: 360 } },
      remote: true,
      busy: false,
      generationProgress: null,
      generationError: "Gemini exceeded the request time budget.",
      setGenerationError() {},
      submitGoal() {},
    })
  );
  assert.match(goalErrorHtml, /role="alert"/);
  assert.match(goalErrorHtml, /Course generation paused:/);
  assert.match(goalErrorHtml, /Gemini exceeded the request time budget\./);
  assert.match(goalErrorHtml, /Try generating again ↻/);
  assert.match(goalErrorHtml, /Dismiss/);

  // 4. ProposalPage preserves existing proposal draft and exposes improvement streaming panel
  const proposalHtml = renderToStaticMarkup(
    React.createElement(ProposalPage, {
      proposal: {
        id: sampleCourseId,
        title: "SQL Analytics",
        summary: "Write analytical SQL queries.",
        durationWeeks: 6,
        estimated_minutes: 180,
        generationMode: "multi-agent",
        modules: [{ id: "m1", title: "Foundations", objective: "Filter rows", estimatedMinutes: 60, lessons: [] }],
      },
      data: { settings: { weeklyMinutes: 360 } },
      remote: true,
      busy: false,
      go() {},
      setProposal() {},
      approveProposal() {},
      request() {},
      requestStream() {},
      refreshRemote() {},
      updateData() {},
      flashToast() {},
      openAccount() {},
    })
  );
  assert.match(proposalHtml, /Improve this draft/);
  assert.match(proposalHtml, /id="proposal-improvement"/);
  assert.match(proposalHtml, /Improve with AI ↗/);
  assert.match(proposalHtml, /SQL Analytics/);
});
