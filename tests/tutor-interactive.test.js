import test, { describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  parseStructuredTutorReply,
  tutorReply,
  resetModelManager,
} from "../server/ai.js";
import {
  buildTutorThreadId,
  loadTutorThread,
  saveTutorThread,
  clearTutorThread,
  listTutorThreads,
} from "../src/tutor-db.js";

const AI_ENV_KEYS = [
  "NVIDIA_API_KEY",
  "AI_API_KEY",
  "NVIDIA_BASE_URL",
  "AI_BASE_URL",
  "NVIDIA_MODEL",
  "AI_MODEL",
  "NVIDIA_FALLBACK_MODELS",
  "NVIDIA_TIMEOUT_MS",
  "NVIDIA_REQUEST_BUDGET_MS",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODELS",
  "GEMINI_TIMEOUT_MS",
  "AI_TIMEOUT_MS",
  "AI_ATTEMPT_TIMEOUT_MS",
  "AI_REQUEST_BUDGET_MS",
  "AI_TTFT_TIMEOUT_MS",
  "AI_CHUNK_IDLE_TIMEOUT_MS",
  "AI_BATCH_MODULES",
  "AI_PROVIDER",
];

function withEnvironment(values, work) {
  const beforeEnv = Object.fromEntries(AI_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of AI_ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(work)
    .finally(() => {
      for (const key of AI_ENV_KEYS) {
        if (beforeEnv[key] === undefined) delete process.env[key];
        else process.env[key] = beforeEnv[key];
      }
    });
}

function providerJsonResponse(content, status = 200) {
  const body =
    typeof content === "string"
      ? content
      : JSON.stringify(content);
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: body } }],
    }),
    {
      status,
      headers: { "content-type": "application/json" },
    }
  );
}

function installFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = original;
  });
}

function createMockIndexedDB({ failOnOpen = false } = {}) {
  const stores = new Map();

  function makeRequest() {
    return {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null,
      onblocked: null,
    };
  }

  return {
    _stores: stores,
    open(name) {
      const req = makeRequest();
      queueMicrotask(() => {
        if (failOnOpen) {
          req.error = new Error("Mock IndexedDB open failure");
          req.onerror?.({ target: req });
          return;
        }
        let storeMap = stores.get(name);
        const needsUpgrade = !storeMap;
        if (!storeMap) {
          storeMap = new Map();
          stores.set(name, storeMap);
        }
        const createdStores = new Set(storeMap.keys());
        const db = {
          objectStoreNames: {
            contains(storeName) {
              return createdStores.has(storeName);
            },
          },
          createObjectStore(storeName) {
            if (!storeMap.has(storeName)) storeMap.set(storeName, new Map());
            createdStores.add(storeName);
            return {};
          },
          close() {},
          transaction(storeName) {
            const records = storeMap.get(storeName) || new Map();
            const tx = {
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              objectStore() {
                return {
                  get(key) {
                    const opReq = makeRequest();
                    queueMicrotask(() => {
                      const val = records.get(key);
                      opReq.result = val ? structuredClone(val) : undefined;
                      opReq.onsuccess?.({ target: opReq });
                      queueMicrotask(() => tx.oncomplete?.({ target: tx }));
                    });
                    return opReq;
                  },
                  put(record) {
                    const opReq = makeRequest();
                    queueMicrotask(() => {
                      records.set(record.threadId, structuredClone(record));
                      opReq.result = record.threadId;
                      opReq.onsuccess?.({ target: opReq });
                      queueMicrotask(() => tx.oncomplete?.({ target: tx }));
                    });
                    return opReq;
                  },
                  delete(key) {
                    const opReq = makeRequest();
                    queueMicrotask(() => {
                      records.delete(key);
                      opReq.result = undefined;
                      opReq.onsuccess?.({ target: opReq });
                      queueMicrotask(() => tx.oncomplete?.({ target: tx }));
                    });
                    return opReq;
                  },
                  getAll() {
                    const opReq = makeRequest();
                    queueMicrotask(() => {
                      opReq.result = [...records.values()].map((item) => structuredClone(item));
                      opReq.onsuccess?.({ target: opReq });
                      queueMicrotask(() => tx.oncomplete?.({ target: tx }));
                    });
                    return opReq;
                  },
                };
              },
            };
            return tx;
          },
        };
        req.result = db;
        if (needsUpgrade) {
          req.onupgradeneeded?.({ target: req });
        }
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

function findElements(node, predicate, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, out);
    return out;
  }
  if (React.isValidElement(node)) {
    if (predicate(node)) out.push(node);
    if (node.props?.children !== undefined) {
      findElements(node.props.children, predicate, out);
    }
  }
  return out;
}

function textContent(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (React.isValidElement(node)) return textContent(node.props?.children);
  return "";
}

function findButtonByText(tree, pattern) {
  const buttons = findElements(tree, (el) => el.type === "button");
  return buttons.find((btn) =>
    typeof pattern === "string"
      ? textContent(btn).includes(pattern)
      : pattern.test(textContent(btn))
  );
}

// ---------------------------------------------------------------------------
// 1. Backend Structured Tutor Modes & Citation Sanitization
// ---------------------------------------------------------------------------
describe("Backend structured tutor modes and citation sanitization", () => {
  beforeEach(() => {
    resetModelManager();
  });

  test("parseStructuredTutorReply handles Explain mode without structured payload and sanitizes citations/URLs", () => {
    const allowed = new Set(["note:owned-1", "lesson:owned-2"]);
    const raw = "## Joins\n\nUse **INNER JOIN** [note:owned-1] instead of [note:invented-99] and avoid https://evil.example.com/leak.";
    const res = parseStructuredTutorReply("Explain", raw, allowed);

    assert.equal(res.structured, null);
    assert.match(res.text, /^## Joins/);
    assert.match(res.text, /\[note:owned-1\]/);
    assert.doesNotMatch(res.text, /\[note:invented-99\]/);
    assert.doesNotMatch(res.text, /https:\/\/evil\.example\.com/);
  });

  test("parseStructuredTutorReply parses Quiz me JSON, sanitizes every field, builds text fallback, and filters invalid items", () => {
    const allowed = new Set(["note:11111111-1111-4111-8111-111111111111"]);
    const payload = {
      intro: "Check [note:11111111-1111-4111-8111-111111111111] and ignore [note:fake-id] https://bad.test/a",
      quizTitle: "SQL Joins [note:fake-title] https://bad.test/t",
      questions: [
        {
          id: "q1",
          question: "Which join keeps unmatched **left** rows? [note:11111111-1111-4111-8111-111111111111] [lesson:fake]",
          options: [
            "INNER JOIN [note:fake]",
            "LEFT JOIN [note:11111111-1111-4111-8111-111111111111]",
            "CROSS JOIN https://bad.test/opt",
          ],
          answerIndex: 1,
          hint: "Think about preserving the left table [attempt:fake] https://bad.test/h",
          explanation: "`LEFT JOIN` retains all left rows [note:11111111-1111-4111-8111-111111111111].",
        },
        {
          // Invalid: out of bounds answerIndex
          id: "q-bad",
          question: "Invalid question",
          options: ["A", "B"],
          answerIndex: 5,
        },
        {
          // Invalid: fewer than 2 options
          id: "q-bad-2",
          question: "Too few options",
          options: ["Only one"],
          answerIndex: 0,
        },
      ],
    };

    const res = parseStructuredTutorReply("Quiz me", JSON.stringify(payload), allowed);
    assert.ok(res.structured);
    assert.equal(res.structured.kind, "quiz");
    assert.equal(res.structured.questions.length, 1);
    assert.equal(res.structured.quizTitle, "SQL Joins");
    assert.match(res.structured.intro, /\[note:11111111-1111-4111-8111-111111111111\]/);
    assert.doesNotMatch(res.structured.intro, /\[note:fake-id\]|https:\/\/bad\.test/);

    const q = res.structured.questions[0];
    assert.equal(q.id, "q1");
    assert.equal(q.answerIndex, 1);
    assert.match(q.question, /\[note:11111111-1111-4111-8111-111111111111\]/);
    assert.doesNotMatch(q.question, /\[lesson:fake\]/);
    assert.equal(q.options[0], "INNER JOIN");
    assert.equal(q.options[2], "CROSS JOIN");
    assert.doesNotMatch(q.hint, /\[attempt:fake\]|https:\/\/bad\.test/);
    assert.match(res.text, /^### SQL Joins/);
    assert.match(res.text, /1\. Which join keeps unmatched/);
    assert.match(res.text, /- B\. LEFT JOIN/);
  });

  test("parseStructuredTutorReply parses Hint JSON (including string hints and solution alias) and sanitizes citations", () => {
    const allowed = new Set(["lesson:owned-lesson"]);
    const payload = {
      intro: "Start from [lesson:owned-lesson] [note:bad]",
      hints: [
        { level: 1, label: "Nudge [note:bad]", content: "Check the **join key** [lesson:owned-lesson] https://bad.test/1" },
        "Second hint string [flashcard:bad]",
      ],
      solution: "Use `ON a.id = b.a_id` https://bad.test/sol",
    };

    const res = parseStructuredTutorReply("Hint", JSON.stringify(payload), allowed);
    assert.ok(res.structured);
    assert.equal(res.structured.kind, "hint");
    assert.equal(res.structured.hints.length, 2);
    assert.equal(res.structured.hints[0].label, "Nudge");
    assert.match(res.structured.hints[0].content, /\[lesson:owned-lesson\]/);
    assert.doesNotMatch(res.structured.hints[0].content, /https:\/\/bad\.test/);
    assert.equal(res.structured.hints[1].label, "Hint 2");
    assert.equal(res.structured.hints[1].content, "Second hint string");
    assert.equal(res.structured.fullSolution, "Use `ON a.id = b.a_id`");
    assert.match(res.text, /\*\*Nudge\*\*:/);
    assert.match(res.text, /\*\*Hint 2\*\*: Second hint string/);
  });

  test("parseStructuredTutorReply parses Review my work JSON, normalizes verdict, and strips unowned citations/URLs", () => {
    const allowed = new Set(["attempt:owned-attempt"]);
    const payload = {
      verdict: "mostly correct",
      summary: "Good start [attempt:owned-attempt] [note:unowned] https://bad.test/s",
      strengths: ["Clear filtering [attempt:owned-attempt]", "https://bad.test/only-url"],
      improvements: ["Handle NULLs [lesson:unowned]"],
      next_step: "Test with an empty row set https://bad.test/next",
      model_answer: "```sql\nSELECT * FROM orders;\n```",
    };

    const res = parseStructuredTutorReply("Review my work", JSON.stringify(payload), allowed);
    assert.ok(res.structured);
    assert.equal(res.structured.kind, "review");
    assert.equal(res.structured.verdict, "mostly_correct");
    assert.match(res.structured.summary, /\[attempt:owned-attempt\]/);
    assert.doesNotMatch(res.structured.summary, /\[note:unowned\]|https:\/\/bad\.test/);
    assert.deepEqual(res.structured.strengths, ["Clear filtering [attempt:owned-attempt]"]);
    assert.deepEqual(res.structured.improvements, ["Handle NULLs"]);
    assert.equal(res.structured.nextStep, "Test with an empty row set");
    assert.match(res.structured.modelAnswer, /SELECT \* FROM orders/);
    assert.match(res.text, /\*\*Verdict:\*\* Mostly correct/);
    assert.match(res.text, /### Strengths/);
    assert.match(res.text, /### Areas to improve/);
    assert.match(res.text, /### Next step/);

    // Unknown verdict falls back to "partial"
    const unknownVerdict = parseStructuredTutorReply(
      "Review my work",
      JSON.stringify({ verdict: "legendary", summary: "Solid effort." })
    );
    assert.equal(unknownVerdict.structured.verdict, "partial");
  });

  test("parseStructuredTutorReply degrades gracefully to { structured: null, text } on plain text or malformed JSON", () => {
    for (const mode of ["Quiz me", "Hint", "Review my work"]) {
      const plain = parseStructuredTutorReply(mode, "Just plain markdown **advice** https://bad.test", new Set());
      assert.equal(plain.structured, null);
      assert.equal(plain.text, "Just plain markdown **advice**");

      const arr = parseStructuredTutorReply(mode, "[1, 2, 3]", new Set());
      assert.equal(arr.structured, null);

      const empty = parseStructuredTutorReply(mode, "{}", new Set());
      assert.equal(empty.structured, null);
    }
  });

  test("tutorReply sends json:false for Explain and json:true single-call schemas for structured modes", async (t) => {
    const ownedNote = {
      id: "note:owned-1",
      type: "note",
      title: "SQL Joins",
      excerpt: "LEFT JOIN preserves unmatched left rows.",
    };

    await withEnvironment(
      { NVIDIA_API_KEY: "test-secret", NVIDIA_BASE_URL: "https://nvidia.test/v1", NVIDIA_MODEL: "test/model" },
      async () => {
        const calls = [];
        installFetch(t, async (_url, options) => {
          const body = JSON.parse(options.body);
          calls.push(body);
          const userPayload = JSON.parse(body.messages[1].content);
          if (userPayload.mode === "Explain") {
            return providerJsonResponse("## Overview\n\nUse `LEFT JOIN` [note:owned-1] [note:invented] https://bad.test");
          }
          if (userPayload.mode === "Quiz me") {
            return providerJsonResponse({
              intro: "Quick check [note:owned-1]",
              quizTitle: "Joins Check",
              questions: [
                {
                  id: "q1",
                  question: "What does LEFT JOIN keep?",
                  options: ["All left rows", "Only matches"],
                  answerIndex: 0,
                  hint: "Left side",
                  explanation: "Preserves unmatched left rows [note:owned-1].",
                },
              ],
            });
          }
          if (userPayload.mode === "Hint") {
            return providerJsonResponse({
              intro: "Step-by-step",
              hints: [
                { level: 1, label: "Hint 1", content: "Look at the join type [note:owned-1]." },
                { level: 2, label: "Hint 2", content: "Consider NULL columns." },
              ],
              fullSolution: "Use `LEFT JOIN`.",
            });
          }
          if (userPayload.mode === "Review my work") {
            return providerJsonResponse({
              verdict: "strong",
              summary: "Accurate query [note:owned-1].",
              strengths: ["Correct ON clause"],
              improvements: [],
              nextStep: "Try adding a WHERE filter.",
              modelAnswer: "SELECT * FROM a LEFT JOIN b ON a.id = b.a_id;",
            });
          }
          return providerJsonResponse("Unexpected");
        });

        const explainRes = await tutorReply({
          context: { title: "Joins" },
          mode: "Explain",
          prompt: "Explain LEFT JOIN",
          memory: [ownedNote],
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].response_format, undefined);
        assert.equal(explainRes.structured, null);
        assert.equal(explainRes.mode, "Explain");
        assert.match(explainRes.text, /^## Overview/);
        assert.deepEqual(explainRes.sources.map((s) => s.id), ["note:owned-1"]);

        for (const mode of ["Quiz me", "Hint", "Review my work"]) {
          const beforeCount = calls.length;
          const res = await tutorReply({
            context: { title: "Joins" },
            mode,
            prompt: `Run ${mode}`,
            attempt: "SELECT * FROM a JOIN b",
            memory: [ownedNote],
          });
          assert.equal(calls.length, beforeCount + 1, `${mode} should be a single provider call`);
          assert.deepEqual(calls[beforeCount].response_format, { type: "json_object" });
          assert.equal(res.mode, mode);
          assert.ok(res.structured, `${mode} should produce structured output`);
          assert.ok(res.text.length > 0, `${mode} should produce text fallback`);
          assert.deepEqual(res.sources.map((s) => s.id), ["note:owned-1"]);
        }
      }
    );
  });

  test("tutorReply degrades gracefully when provider returns plain text for a structured mode", async (t) => {
    await withEnvironment(
      { NVIDIA_API_KEY: "test-secret", NVIDIA_BASE_URL: "https://nvidia.test/v1", NVIDIA_MODEL: "test/model" },
      async () => {
        installFetch(t, async () => providerJsonResponse("Plain fallback explanation without JSON."));
        const res = await tutorReply({
          context: { title: "Joins" },
          mode: "Quiz me",
          prompt: "Quiz me",
          memory: [],
        });
        assert.equal(res.structured, null);
        assert.equal(res.text, "Plain fallback explanation without JSON.");
      }
    );
  });
});

// ---------------------------------------------------------------------------
// 1b. POST /api/tutor forwarding structured and mode (DB & Mongo mocked)
// ---------------------------------------------------------------------------
describe("POST /api/tutor forwards structured and mode without opening DB sockets", () => {
  let vite;
  let handler;
  let apiState;

  function mockApiPlugin() {
    const replacements = new Map([
      ["../server/db.js", "db"],
      ["../server/auth.js", "auth"],
      ["../server/email.js", "email"],
      ["../server/plan-service.js", "plans"],
      ["../server/ai.js", "ai"],
      ["../server/retrieval.js", "retrieval"],
    ]);
    return {
      name: "tutor-api-mock-plugin",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer?.includes("api/[...path].js")) return null;
        const key = replacements.get(source);
        return key ? `\0tutor-api-mock:${key}` : null;
      },
      load(id) {
        if (!id.startsWith("\0tutor-api-mock:")) return null;
        const mod = id.slice("\0tutor-api-mock:".length);
        if (mod === "db") {
          return `
            export async function query(...args) { return globalThis.__tutorApiMock.query(...args); }
            export async function withTransaction(work) { return work({ query: (...args) => globalThis.__tutorApiMock.query(...args) }); }
          `;
        }
        if (mod === "auth") {
          return `
            export async function requireUser() { return globalThis.__tutorApiMock.user; }
            export function sessionUserId() { return globalThis.__tutorApiMock.user.id; }
            export function createSessionCookie() { return "learnos_session=test; Path=/"; }
            export function clearSessionCookie() { return "learnos_session=; Path=/; Max-Age=0"; }
          `;
        }
        if (mod === "email") return `export async function sendEmail() { return { id: "mock" }; }`;
        if (mod === "plans") {
          return `
            export async function generateCourseProposal() { return {}; }
            export async function improveCourseProposal() { return {}; }
            export async function approveCourse() { return {}; }
          `;
        }
        if (mod === "ai") return `export async function tutorReply(...args) { return globalThis.__tutorApiMock.tutorReply(...args); }`;
        if (mod === "retrieval") return `export async function retrieveLearnerContext(...args) { return globalThis.__tutorApiMock.retrieveLearnerContext(...args); }`;
        return null;
      },
    };
  }

  async function callTutor(body) {
    const headers = new Map();
    const res = {
      statusCode: 200,
      setHeader(k, v) {
        headers.set(k.toLowerCase(), v);
      },
      end(payload = "") {
        this.body = payload;
      },
    };
    await handler({ url: "/api/tutor", method: "POST", headers: {}, body }, res);
    return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
  }

  before(async () => {
    vite = await createServer({
      configFile: "./vite.config.js",
      logLevel: "silent",
      plugins: [mockApiPlugin()],
      server: { middlewareMode: true },
      appType: "custom",
    });
    ({ default: handler } = await vite.ssrLoadModule("/api/[...path].js"));
  });

  beforeEach(() => {
    apiState = {
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "learner@example.com",
        full_name: "Learner",
      },
      query: async () => ({ rows: [] }),
      retrieveLearnerContext: async () => [
        {
          id: "note:owned-1",
          type: "note",
          title: "Join Notes",
          excerpt: "Keep unmatched left rows with LEFT JOIN.",
          relevance: 0.91,
          matchType: "semantic",
        },
      ],
      tutorReply: async ({ mode }) => ({
        text: "### Quick Check",
        structured:
          mode === "Quiz me"
            ? {
                kind: "quiz",
                quizTitle: "Quick Check",
                intro: "Test yourself",
                questions: [
                  {
                    id: "q1",
                    question: "Which join keeps left rows?",
                    options: ["INNER", "LEFT"],
                    answerIndex: 1,
                    hint: "Starts with L",
                    explanation: "LEFT JOIN preserves left rows.",
                  },
                ],
              }
            : null,
        mode,
        source: "nvidia",
        model: "test-model",
        failoverCount: 1,
        sources: [{ id: "note:owned-1", type: "note", title: "Join Notes" }],
      }),
    };
    globalThis.__tutorApiMock = apiState;
  });

  after(async () => {
    await vite?.close();
    delete globalThis.__tutorApiMock;
  });

  test("forwards structured, mode, reply, and enriched sources for Quiz me", async () => {
    const res = await callTutor({ mode: "Quiz me", prompt: "Quiz me on joins" });
    assert.equal(res.status, 200);
    assert.equal(res.json.mode, "Quiz me");
    assert.equal(res.json.reply, "### Quick Check");
    assert.equal(res.json.structured.kind, "quiz");
    assert.equal(res.json.structured.questions[0].id, "q1");
    assert.equal(res.json.model, "test-model");
    assert.equal(res.json.failoverCount, 1);
    assert.equal(res.json.sources.length, 1);
    assert.equal(res.json.sources[0].excerpt, "Keep unmatched left rows with LEFT JOIN.");
    assert.equal(res.json.sources[0].relevance, 0.91);
    assert.equal(res.json.sources[0].matchType, "semantic");
  });

  test("forwards structured: null for Explain mode and rejects invalid modes", async () => {
    const ok = await callTutor({ mode: "Explain", prompt: "Explain joins" });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.mode, "Explain");
    assert.equal(ok.json.structured, null);

    const bad = await callTutor({ mode: "InvalidMode", prompt: "Hi" });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, "INVALID_MODE");
  });
});

// ---------------------------------------------------------------------------
// 2. Safe Markdown Renderer & XSS Neutralization (TutorMarkdown)
// ---------------------------------------------------------------------------
describe("TutorMarkdown safe rendering and XSS neutralization", () => {
  let vite;
  let TutorMarkdown;

  before(async () => {
    vite = await createServer({
      configFile: "./vite.config.js",
      logLevel: "silent",
      server: { middlewareMode: true },
      appType: "custom",
    });
    ({ TutorMarkdown } = await vite.ssrLoadModule("/src/tutor-markdown.jsx"));
  });

  after(async () => {
    await vite?.close();
  });

  test("renders headings, paragraphs, lists, blockquotes, hr, code blocks, tables, inline styles, citations, and safe links", () => {
    const md = [
      "# Main Title",
      "### Subheading",
      "",
      "A paragraph with **bold**, *italic*, ~~old~~, `inline()`, [note:123e4567-e89b-12d3-a456-426614174000], [Docs](https://example.com/docs), and [Email](mailto:help@example.com).",
      "",
      "> Quoted insight with **emphasis**",
      "",
      "- First bullet",
      "- Second bullet",
      "",
      "1. Step one",
      "2. Step two",
      "",
      "---",
      "",
      "```sql",
      "SELECT * FROM users;",
      "```",
      "",
      "| Col A | Col B | Col C |",
      "| :--- | :---: | ---: |",
      "| left | center | 42 |",
    ].join("\n");

    const html = renderToStaticMarkup(React.createElement(TutorMarkdown, { content: md, className: "custom-md" }));

    assert.match(html, /class="tutor-markdown custom-md"/);
    assert.match(html, /<h1>Main Title<\/h1>/);
    assert.match(html, /<h3>Subheading<\/h3>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<del>old<\/del>/);
    assert.match(html, /<code class="tutor-inline-code">inline\(\)<\/code>/);
    assert.match(html, /<code class="tutor-citation-badge">\[note:123e4567-e89b-12d3-a456-426614174000\]<\/code>/);
    assert.match(html, /<a href="https:\/\/example\.com\/docs" target="_blank" rel="noopener noreferrer">Docs<\/a>/);
    assert.match(html, /<a href="mailto:help@example\.com" target="_blank" rel="noopener noreferrer">Email<\/a>/);
    assert.match(html, /<blockquote><p>Quoted insight with <strong>emphasis<\/strong><\/p><\/blockquote>/);
    assert.match(html, /<ul><li>First bullet<\/li><li>Second bullet<\/li><\/ul>/);
    assert.match(html, /<ol><li>Step one<\/li><li>Step two<\/li><\/ol>/);
    assert.match(html, /<hr\/>/);
    assert.match(html, /<div class="tutor-code-block">/);
    assert.match(html, /<div class="tutor-code-header"><span class="tutor-code-lang">sql<\/span><button type="button" class="tutor-code-copy"[^>]*>Copy<\/button><\/div>/);
    assert.match(html, /<pre><code>SELECT \* FROM users;<\/code><\/pre>/);
    assert.match(html, /<div class="tutor-table-wrap"><table>/);
    assert.match(html, /<th style="text-align:center">Col B<\/th>/);
    assert.match(html, /<td style="text-align:right">42<\/td>/);
  });

  test("blocks dangerous link protocols and escapes raw HTML/script payloads without dangerouslySetInnerHTML", async () => {
    const source = await readFile(new URL("../src/tutor-markdown.jsx", import.meta.url), "utf8");
    assert.doesNotMatch(source, /dangerouslySetInnerHTML\s*[:=]/);

    const xssMarkdown = [
      "Try [click me](javascript:alert(1)) or [data link](data:text/html,<script>alert(1)</script>) or [vb](vbscript:msgbox(1)).",
      "",
      "<script>alert('xss')</script>",
      "",
      "<img src=x onerror=alert(1)>",
    ].join("\n");

    const html = renderToStaticMarkup(React.createElement(TutorMarkdown, { content: xssMarkdown }));
    assert.doesNotMatch(html, /<a\s/i);
    assert.doesNotMatch(html, /javascript:/i);
    assert.doesNotMatch(html, /data:text\/html/i);
    assert.doesNotMatch(html, /vbscript:/i);
    assert.doesNotMatch(html, /<script>/i);
    assert.doesNotMatch(html, /<img\s/i);
    assert.match(html, /click me/);
    assert.match(html, /&lt;script&gt;alert\(&#x27;xss&#x27;\)&lt;\/script&gt;/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);

    assert.equal(renderToStaticMarkup(React.createElement(TutorMarkdown, { content: null })), "");
    assert.equal(renderToStaticMarkup(React.createElement(TutorMarkdown, { content: "   " })), "");
  });
});

// ---------------------------------------------------------------------------
// 3. Browser IndexedDB Persistence (src/tutor-db.js)
// ---------------------------------------------------------------------------
describe("Browser IndexedDB tutor persistence and fallback (src/tutor-db.js)", () => {
  test("buildTutorThreadId scopes keys by userId and lessonId with safe defaults", () => {
    assert.equal(buildTutorThreadId("user-1", "lesson-a"), "user-1::lesson-a");
    assert.equal(buildTutorThreadId(null, null), "anon::workspace");
    assert.equal(buildTutorThreadId("  u-2  ", ""), "u-2::workspace");
  });

  test("saves, reloads interactive state, isolates users, lists summaries, and clears threads in mock IndexedDB", async () => {
    const idb = createMockIndexedDB();
    const userAThread = buildTutorThreadId("user-a", "lesson-1");
    const userAWorkspace = buildTutorThreadId("user-a", null);
    const userBThread = buildTutorThreadId("user-b", "lesson-1");

    const interactiveMessages = [
      { id: "u-1", role: "user", text: "Quiz me", mode: "Quiz me", createdAt: 1000 },
      {
        id: "a-1",
        role: "assistant",
        text: "### Quiz",
        mode: "Quiz me",
        structured: {
          kind: "quiz",
          quizTitle: "Joins",
          questions: [{ id: "q1", question: "Q?", options: ["A", "B"], answerIndex: 1 }],
        },
        interaction: {
          selectedAnswers: { q1: 1 },
          revealedQuestions: { q1: true },
          revealedHints: { q1: true },
        },
        sources: [{ id: "note:1", title: "Notes" }],
        model: "test-model",
        failoverCount: 0,
        createdAt: 1001,
      },
      {
        id: "a-2",
        role: "assistant",
        text: "Hints",
        mode: "Hint",
        structured: { kind: "hint", hints: [{ level: 1, label: "Hint 1", content: "Nudge" }], fullSolution: "Ans" },
        interaction: { revealedHints: 2, showSolution: true },
        createdAt: 1002,
      },
      {
        id: "a-3",
        role: "assistant",
        text: "Review",
        mode: "Review my work",
        structured: { kind: "review", verdict: "strong", summary: "Nice", strengths: ["Clean"], improvements: [], nextStep: "Next", modelAnswer: "Code" },
        interaction: { showModelAnswer: true },
        createdAt: 1003,
      },
    ];

    const saveA = await saveTutorThread(userAThread, interactiveMessages, {
      indexedDBImpl: idb,
      lessonTitle: "Relational Joins",
    });
    assert.deepEqual(saveA, { saved: true, fallback: false });

    await saveTutorThread(
      userAWorkspace,
      [{ id: "u-w", role: "user", text: "General question", createdAt: 2000 }],
      { indexedDBImpl: idb, lessonTitle: "Workspace" }
    );
    await saveTutorThread(
      userBThread,
      [{ id: "u-b", role: "user", text: "User B secret message", createdAt: 3000 }],
      { indexedDBImpl: idb, lessonTitle: "Relational Joins" }
    );

    // Reload preserves quiz/hint/review interactive state
    const reloadedA = await loadTutorThread(userAThread, { indexedDBImpl: idb });
    assert.equal(reloadedA.length, 4);
    assert.deepEqual(reloadedA[1].interaction, {
      selectedAnswers: { q1: 1 },
      revealedQuestions: { q1: true },
      revealedHints: { q1: true },
    });
    assert.deepEqual(reloadedA[2].interaction, { revealedHints: 2, showSolution: true });
    assert.deepEqual(reloadedA[3].interaction, { showModelAnswer: true });

    // User isolation: user-a list never sees user-b thread
    const listA = await listTutorThreads("user-a", { indexedDBImpl: idb });
    assert.equal(listA.length, 2);
    assert.ok(listA.every((item) => item.userId === "user-a"));
    assert.equal(listA[0].threadId, userAWorkspace);
    assert.equal(listA[1].threadId, userAThread);
    assert.equal(listA[1].lessonTitle, "Relational Joins");
    assert.equal(listA[1].messageCount, 4);

    const listB = await listTutorThreads("user-b", { indexedDBImpl: idb });
    assert.equal(listB.length, 1);
    assert.equal(listB[0].threadId, userBThread);
    assert.equal(listB[0].preview, "User B secret message");

    // Clear removes only target thread
    const cleared = await clearTutorThread(userAThread, { indexedDBImpl: idb });
    assert.deepEqual(cleared, { cleared: true, fallback: false });
    assert.deepEqual(await loadTutorThread(userAThread, { indexedDBImpl: idb }), []);
    assert.equal((await listTutorThreads("user-a", { indexedDBImpl: idb })).length, 1);
    assert.equal((await loadTutorThread(userBThread, { indexedDBImpl: idb })).length, 1);
  });

  test("falls back cleanly to in-memory storage when indexedDBImpl is null or fails to open", async () => {
    const threadId = buildTutorThreadId("fallback-user", "lesson-x");
    try {
      const saveRes = await saveTutorThread(
        threadId,
        [{ id: "m1", role: "assistant", text: "Memory fallback message", createdAt: 500 }],
        { indexedDBImpl: null, lessonTitle: "Fallback Lesson" }
      );
      assert.deepEqual(saveRes, { saved: true, fallback: true });

      const loaded = await loadTutorThread(threadId, { indexedDBImpl: null });
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0].text, "Memory fallback message");

      const listed = await listTutorThreads("fallback-user", { indexedDBImpl: null });
      assert.equal(listed.length, 1);
      assert.equal(listed[0].threadId, threadId);

      // Broken IndexedDB open also falls back cleanly without throwing
      const brokenIdb = createMockIndexedDB({ failOnOpen: true });
      const loadedOnError = await loadTutorThread(threadId, { indexedDBImpl: brokenIdb });
      assert.equal(loadedOnError.length, 1);
      assert.equal(loadedOnError[0].text, "Memory fallback message");
    } finally {
      const cleared = await clearTutorThread(threadId, { indexedDBImpl: null });
      assert.deepEqual(cleared, { cleared: true, fallback: true });
      assert.deepEqual(await loadTutorThread(threadId, { indexedDBImpl: null }), []);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Interactive Quiz / Hint / Review Cards & TutorPage SSR (src/App.jsx)
// ---------------------------------------------------------------------------
describe("Interactive tutor cards and TutorPage SSR", () => {
  let vite;
  let TutorPage;
  let createDefaultTutorInteraction;
  let QuizMessageCard;
  let HintMessageCard;
  let ReviewMessageCard;
  const localStorageValues = new Map();
  const sessionStorageValues = new Map();

  function exposeTutorCardsPlugin() {
    return {
      name: "expose-tutor-cards-for-test",
      transform(code, id) {
        if (id.endsWith("/src/App.jsx") || id.endsWith("\\src\\App.jsx")) {
          return {
            code: `${code}\nexport { createDefaultTutorInteraction, QuizMessageCard, HintMessageCard, ReviewMessageCard };`,
            map: null,
          };
        }
        return null;
      },
    };
  }

  before(async () => {
    globalThis.localStorage = {
      getItem: (k) => localStorageValues.get(k) || null,
      setItem: (k, v) => localStorageValues.set(k, String(v)),
      removeItem: (k) => localStorageValues.delete(k),
    };
    globalThis.sessionStorage = {
      getItem: (k) => sessionStorageValues.get(k) || null,
      setItem: (k, v) => sessionStorageValues.set(k, String(v)),
      removeItem: (k) => sessionStorageValues.delete(k),
    };
    globalThis.window = {
      location: { hash: "#/tutor" },
      addEventListener() {},
      removeEventListener() {},
    };

    vite = await createServer({
      configFile: "./vite.config.js",
      logLevel: "silent",
      plugins: [exposeTutorCardsPlugin()],
      server: { middlewareMode: true },
      appType: "custom",
    });
    ({
      TutorPage,
      createDefaultTutorInteraction,
      QuizMessageCard,
      HintMessageCard,
      ReviewMessageCard,
    } = await vite.ssrLoadModule("/src/App.jsx"));
  });

  after(async () => {
    await vite?.close();
    delete globalThis.window;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  });

  test("createDefaultTutorInteraction initializes state shapes for quiz, hint, and review", () => {
    assert.deepEqual(createDefaultTutorInteraction({ kind: "quiz" }), {
      selectedAnswers: {},
      revealedQuestions: {},
      revealedHints: {},
    });
    assert.deepEqual(createDefaultTutorInteraction({ kind: "hint" }), {
      revealedHints: 1,
      showSolution: false,
    });
    assert.deepEqual(createDefaultTutorInteraction({ kind: "review" }), {
      showModelAnswer: false,
    });
    assert.equal(createDefaultTutorInteraction(null), null);
  });

  test("QuizMessageCard renders multi-question pack, .selected, .is-correct, .is-wrong, hints, score, and Reveal all answers", () => {
    const structured = {
      kind: "quiz",
      quizTitle: "SQL Joins Pack",
      intro: "Test **two** join behaviors.",
      questions: [
        {
          id: "q1",
          question: "Which join returns only matching rows?",
          options: ["INNER JOIN", "LEFT JOIN", "FULL JOIN"],
          answerIndex: 0,
          hint: "Think intersection.",
          explanation: "**INNER JOIN** keeps matching pairs.",
        },
        {
          id: "q2",
          question: "Which join keeps all left rows?",
          options: ["INNER JOIN", "LEFT JOIN"],
          answerIndex: 1,
          hint: "Focus on the left side.",
          explanation: "`LEFT JOIN` preserves unmatched left rows.",
        },
      ],
    };

    let interaction = createDefaultTutorInteraction(structured);
    const update = (updater) => {
      interaction = updater(interaction);
    };

    // Initial render
    const initialHtml = renderToStaticMarkup(
      React.createElement(QuizMessageCard, { structured, interaction, onUpdateInteraction: update })
    );
    assert.match(initialHtml, /class="tutor-quiz-card"/);
    assert.match(initialHtml, /SQL Joins Pack/);
    assert.match(initialHtml, /<strong>two<\/strong>/);
    assert.match(initialHtml, />2 questions</);
    assert.match(initialHtml, />Reveal all answers</);

    // Select correct option on Q1, wrong option on Q2, open Q1 hint, and check Q1 + Q2
    let tree = QuizMessageCard({ structured, interaction, onUpdateInteraction: update });
    const q1Options = findElements(
      tree,
      (el) => el.type === "button" && el.props?.className?.includes("tutor-quiz-option")
    );
    assert.equal(q1Options.length, 5);
    q1Options[0].props.onClick(); // Q1 -> INNER JOIN (correct)
    q1Options[3].props.onClick(); // Q2 -> INNER JOIN (wrong, answerIndex is 1)

    const selectedHtml = renderToStaticMarkup(
      React.createElement(QuizMessageCard, { structured, interaction, onUpdateInteraction: update })
    );
    assert.match(selectedHtml, /tutor-quiz-option selected/);
    assert.match(selectedHtml, /aria-pressed="true"/);
    assert.match(selectedHtml, />Check answer</);

    // Toggle Q1 hint and reveal Q1 + Q2
    tree = QuizMessageCard({ structured, interaction, onUpdateInteraction: update });
    findButtonByText(tree, "Hint").props.onClick();
    const checkButtons = findElements(tree, (el) => el.type === "button" && textContent(el) === "Check answer");
    assert.equal(checkButtons.length, 2);
    checkButtons[0].props.onClick();
    checkButtons[1].props.onClick();

    const checkedHtml = renderToStaticMarkup(
      React.createElement(QuizMessageCard, { structured, interaction, onUpdateInteraction: update })
    );
    assert.match(checkedHtml, /class="tutor-quiz-hint"/);
    assert.match(checkedHtml, /Think intersection\./);
    assert.match(checkedHtml, /tutor-quiz-option selected is-correct/);
    assert.match(checkedHtml, /tutor-quiz-option is-correct/);
    assert.match(checkedHtml, /tutor-quiz-option selected is-wrong/);
    assert.match(checkedHtml, /class="tutor-quiz-explanation correct"/);
    assert.match(checkedHtml, /class="tutor-quiz-explanation incorrect"/);
    assert.match(checkedHtml, /<strong>INNER JOIN<\/strong>/);
    assert.match(checkedHtml, />1\/2 correct</);
    assert.match(checkedHtml, />Hide all answers</);

    // Clicking "Hide all answers" hides all, then "Reveal all answers" reveals all
    tree = QuizMessageCard({ structured, interaction, onUpdateInteraction: update });
    findButtonByText(tree, "Hide all answers").props.onClick();
    assert.deepEqual(interaction.revealedQuestions, {});
    tree = QuizMessageCard({ structured, interaction, onUpdateInteraction: update });
    findButtonByText(tree, "Reveal all answers").props.onClick();
    assert.deepEqual(interaction.revealedQuestions, { q1: true, q2: true });
  });

  test("HintMessageCard progresses through hints via Show next hint and toggles fullSolution", () => {
    const structured = {
      kind: "hint",
      intro: "Follow these **steps**:",
      hints: [
        { level: 1, label: "Step 1", content: "Identify the *join* column." },
        { level: 2, label: "Step 2", content: "Choose `LEFT JOIN`." },
        { level: 3, label: "Step 3", content: "Filter NULLs in `WHERE`." },
      ],
      fullSolution: "```sql\nSELECT * FROM a LEFT JOIN b ON a.id = b.a_id;\n```",
    };

    let interaction = createDefaultTutorInteraction(structured);
    const update = (updater) => {
      interaction = updater(interaction);
    };

    const html1 = renderToStaticMarkup(
      React.createElement(HintMessageCard, { structured, interaction, onUpdateInteraction: update })
    );
    assert.match(html1, /class="tutor-hint-card"/);
    assert.match(html1, /<strong>steps<\/strong>/);
    assert.match(html1, /Step 1/);
    assert.doesNotMatch(html1, /Step 2/);
    assert.match(html1, /Show next hint \(2\/3\)/);
    assert.match(html1, /Reveal full solution/);
    assert.doesNotMatch(html1, /tutor-hint-solution/);

    // Advance to hint 2 and 3
    let tree = HintMessageCard({ structured, interaction, onUpdateInteraction: update });
    findButtonByText(tree, /Show next hint/).props.onClick();
    assert.equal(interaction.revealedHints, 2);
    tree = HintMessageCard({ structured, interaction, onUpdateInteraction: update });
    findButtonByText(tree, /Show next hint \(3\/3\)/).props.onClick();
    assert.equal(interaction.revealedHints, 3);

    // Reveal full solution
    tree = HintMessageCard({ structured, interaction, onUpdateInteraction: update });
    assert.equal(findButtonByText(tree, /Show next hint/), undefined);
    findButtonByText(tree, "Reveal full solution").props.onClick();

    const htmlAll = renderToStaticMarkup(
      React.createElement(HintMessageCard, { structured, interaction, onUpdateInteraction: update })
    );
    assert.match(htmlAll, /Step 1/);
    assert.match(htmlAll, /Step 2/);
    assert.match(htmlAll, /Step 3/);
    assert.match(htmlAll, /class="tutor-hint-solution"/);
    assert.match(htmlAll, /<div class="tutor-code-block">/);
    assert.match(htmlAll, /Hide full solution/);
  });

  test("ReviewMessageCard renders verdict badge, strengths & improvements columns, next step, and toggles modelAnswer", () => {
    const structured = {
      kind: "review",
      verdict: "mostly_correct",
      summary: "Your query joins **correctly**.",
      strengths: ["Good alias choice"],
      improvements: ["Handle `NULL` values"],
      nextStep: "Add a `WHERE` clause.",
      modelAnswer: "### Model SQL\n\n`SELECT id FROM orders;`",
    };

    let interaction = createDefaultTutorInteraction(structured);
    const update = (updater) => {
      interaction = updater(interaction);
    };

    const collapsedHtml = renderToStaticMarkup(
      React.createElement(ReviewMessageCard, { structured, interaction, onUpdateInteraction: update })
    );
    assert.match(collapsedHtml, /class="tutor-review-card"/);
    assert.match(collapsedHtml, /class="tutor-verdict-badge verdict-mostly_correct">Mostly correct<\/span>/);
    assert.match(collapsedHtml, /<strong>correctly<\/strong>/);
    assert.match(collapsedHtml, /<h4>Strengths<\/h4>/);
    assert.match(collapsedHtml, /Good alias choice/);
    assert.match(collapsedHtml, /<h4>Areas to improve<\/h4>/);
    assert.match(collapsedHtml, /<code class="tutor-inline-code">NULL<\/code>/);
    assert.match(collapsedHtml, /<strong>Next step<\/strong>/);
    assert.match(collapsedHtml, /View suggested solution/);
    assert.doesNotMatch(collapsedHtml, /tutor-review-solution"/);

    // Toggle model answer open
    const tree = ReviewMessageCard({ structured, interaction, onUpdateInteraction: update });
    findButtonByText(tree, "View suggested solution").props.onClick();
    const expandedHtml = renderToStaticMarkup(
      React.createElement(ReviewMessageCard, { structured, interaction, onUpdateInteraction: update })
    );
    assert.match(expandedHtml, /class="tutor-review-solution"/);
    assert.match(expandedHtml, /<h3>Model SQL<\/h3>/);
    assert.match(expandedHtml, /Hide suggested solution/);
  });

  test("TutorPage SSR renders workspace shell cleanly and tutor markdown renders structurally without raw # or ** in <p>", async () => {
    const remoteHtml = renderToStaticMarkup(
      React.createElement(TutorPage, {
        remote: true,
        user: { id: "u1", fullName: "Ada Lovelace" },
        activeLesson: { id: "l1", title: "SQL Joins", objective: "Combine tables cleanly." },
        lessons: [{ id: "l1", title: "SQL Joins" }],
        data: { courses: [] },
        go() {},
        openLesson() {},
        openAccount() {},
        setActiveLessonId() {},
        sendTutor: async () => ({ text: "" }),
      })
    );
    assert.match(remoteHtml, /class="tutor-layout/);
    assert.match(remoteHtml, /Tutor connected/);
    assert.match(remoteHtml, /Explain/);
    assert.match(remoteHtml, /Hint/);
    assert.match(remoteHtml, /Quiz me/);
    assert.match(remoteHtml, /Review my work/);
    assert.match(remoteHtml, /SQL Joins/);

    const signedOutHtml = renderToStaticMarkup(
      React.createElement(TutorPage, {
        remote: false,
        user: null,
        go() {},
        openAccount() {},
      })
    );
    assert.match(signedOutHtml, /Connect an account to use AI Tutor/);

    // Verify TutorPage delegates assistant/error message text to TutorMarkdown (not raw <p>{m.text}</p>)
    const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
    assert.match(
      appSource,
      /m\.role==="user"\?\s*\(\s*<p>\{m\.text\}<\/p>\s*\):m\.isError\?\s*\(\s*<TutorMarkdown content=\{m\.text\}\/>\s*\)/
    );
    assert.match(appSource, /:\(\s*<TutorMarkdown content=\{m\.text\}\/>\s*\)/);
  });
});
