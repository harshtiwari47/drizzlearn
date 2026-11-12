import test, { describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import {
  normalizePracticeExercises,
  generatePracticeExercises,
  resetModelManager,
} from "../server/ai.js";
import {
  buildPracticeSetKey,
  loadPracticeSet,
  savePracticeSet,
  clearPracticeSet,
  listLessonPracticeModes,
} from "../src/practice-db.js";

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
  const body = typeof content === "string" ? content : JSON.stringify(content);
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
            if (!storeMap.has(storeName)) {
              storeMap.set(storeName, new Map());
            }
            createdStores.add(storeName);
            return {};
          },
          transaction(storeName) {
            const dataMap = storeMap.get(storeName) || new Map();
            storeMap.set(storeName, dataMap);
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
                      opReq.result = dataMap.has(key)
                        ? structuredClone(dataMap.get(key))
                        : undefined;
                      opReq.onsuccess?.({ target: opReq });
                      tx.oncomplete?.();
                    });
                    return opReq;
                  },
                  put(value) {
                    const opReq = makeRequest();
                    queueMicrotask(() => {
                      dataMap.set(value.key, structuredClone(value));
                      opReq.result = value.key;
                      opReq.onsuccess?.({ target: opReq });
                      tx.oncomplete?.();
                    });
                    return opReq;
                  },
                  delete(key) {
                    const opReq = makeRequest();
                    queueMicrotask(() => {
                      dataMap.delete(key);
                      opReq.result = undefined;
                      opReq.onsuccess?.({ target: opReq });
                      tx.oncomplete?.();
                    });
                    return opReq;
                  },
                  getAll() {
                    const opReq = makeRequest();
                    queueMicrotask(() => {
                      opReq.result = [...dataMap.values()].map((v) => structuredClone(v));
                      opReq.onsuccess?.({ target: opReq });
                      tx.oncomplete?.();
                    });
                    return opReq;
                  },
                };
              },
            };
            return tx;
          },
          close() {},
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

function createMiniDom() {
  class MiniNode {
    constructor(nodeType, ownerDocument) {
      this.nodeType = nodeType;
      this.ownerDocument = ownerDocument;
      this.parentNode = null;
      this.childNodes = [];
      this.listeners = new Map();
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.childNodes.indexOf(this);
      return i >= 0 ? this.parentNode.childNodes[i + 1] || null : null;
    }
    get previousSibling() {
      if (!this.parentNode) return null;
      const i = this.parentNode.childNodes.indexOf(this);
      return i > 0 ? this.parentNode.childNodes[i - 1] || null : null;
    }
    appendChild(child) {
      return this.insertBefore(child, null);
    }
    insertBefore(child, ref) {
      if (child.nodeType === 11) {
        for (const c of [...child.childNodes]) this.insertBefore(c, ref);
        return child;
      }
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      const idx = ref ? this.childNodes.indexOf(ref) : -1;
      if (idx >= 0) this.childNodes.splice(idx, 0, child);
      else this.childNodes.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) {
        this.childNodes.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    }
    contains(node) {
      if (node === this) return true;
      return this.childNodes.some((c) => c.contains(node));
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }
    dispatchEvent(event) {
      event.target = event.target || this;
      let cur = this;
      while (cur) {
        event.currentTarget = cur;
        const set = cur.listeners.get(event.type);
        if (set) {
          for (const fn of [...set]) fn.call(cur, event);
        }
        if (event._stopped) break;
        cur = event.bubbles === false ? null : cur.parentNode;
      }
      return !event.defaultPrevented;
    }
  }

  class MiniText extends MiniNode {
    constructor(text, doc) {
      super(3, doc);
      this._data = String(text ?? "");
    }
    get nodeValue() {
      return this._data;
    }
    set nodeValue(v) {
      this._data = String(v ?? "");
    }
    get textContent() {
      return this._data;
    }
    set textContent(v) {
      this._data = String(v ?? "");
    }
  }

  class MiniElement extends MiniNode {
    constructor(tagName, doc) {
      super(1, doc);
      this.tagName = tagName.toUpperCase();
      this.nodeName = this.tagName;
      this.attributes = new Map();
      this.style = {};
      this.disabled = false;
      this.value = "";
    }
    setAttribute(k, v) {
      const s = String(v);
      this.attributes.set(k, s);
      if (k === "class") this.className = s;
      if (k === "disabled") this.disabled = true;
      if (k === "value") this.value = s;
    }
    removeAttribute(k) {
      this.attributes.delete(k);
      if (k === "class") this.className = "";
      if (k === "disabled") this.disabled = false;
    }
    getAttribute(k) {
      if (k === "class" && this.className !== undefined) return this.className;
      return this.attributes.has(k) ? this.attributes.get(k) : null;
    }
    hasAttribute(k) {
      return this.attributes.has(k) || (k === "disabled" && this.disabled);
    }
    get classList() {
      const el = this;
      return {
        contains(cls) {
          return String(el.className || "").split(/\s+/).includes(cls);
        },
      };
    }
    get textContent() {
      return this.childNodes.map((c) => c.textContent).join("");
    }
    set textContent(v) {
      for (const c of [...this.childNodes]) this.removeChild(c);
      if (v !== "" && v != null) this.appendChild(new MiniText(v, this.ownerDocument));
    }
    get options() {
      return this.childNodes.filter((c) => c.tagName === "OPTION");
    }
    click() {
      if (this.disabled) return;
      this.dispatchEvent({
        type: "click",
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this._stopped = true;
        },
      });
    }
    keydown(key, extras = {}) {
      const evt = {
        type: "keydown",
        key,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        stopPropagation() {
          this._stopped = true;
        },
        ...extras,
      };
      this.dispatchEvent(evt);
      return evt;
    }
  }

  class MiniIFrame extends MiniElement {}

  class MiniDocument extends MiniNode {
    constructor() {
      super(9, null);
      this.ownerDocument = this;
      this.defaultView = null;
      this.body = new MiniElement("body", this);
      this.documentElement = new MiniElement("html", this);
      this.documentElement.appendChild(this.body);
      this.appendChild(this.documentElement);
      this.activeElement = this.body;
    }
    createElement(tag) {
      return new MiniElement(tag, this);
    }
    createElementNS(_ns, tag) {
      return new MiniElement(tag, this);
    }
    createTextNode(text) {
      return new MiniText(text, this);
    }
    createComment(text) {
      const n = new MiniText(text, this);
      n.nodeType = 8;
      return n;
    }
    createDocumentFragment() {
      return new MiniNode(11, this);
    }
    createEvent() {
      return {
        initEvent(t, b) {
          this.type = t;
          this.bubbles = b;
        },
      };
    }
  }

  const doc = new MiniDocument();
  const win = {
    document: doc,
    location: { hash: "#/practice" },
    navigator: { userAgent: "node" },
    addEventListener: doc.addEventListener.bind(doc),
    removeEventListener: doc.removeEventListener.bind(doc),
    Node: MiniNode,
    Element: MiniElement,
    HTMLElement: MiniElement,
    HTMLIFrameElement: MiniIFrame,
  };
  doc.defaultView = win;
  return { doc, win };
}

function findAll(root, predicate) {
  const out = [];
  const visit = (node) => {
    if (!node) return;
    if (node.nodeType === 1 && predicate(node)) out.push(node);
    if (Array.isArray(node.childNodes)) {
      for (const child of node.childNodes) visit(child);
    }
  };
  visit(root);
  return out;
}

function findOne(root, predicate) {
  return findAll(root, predicate)[0] || null;
}

function findButton(root, textMatch) {
  return findOne(
    root,
    (el) =>
      el.tagName === "BUTTON" &&
      (typeof textMatch === "string"
        ? el.textContent.trim() === textMatch
        : textMatch.test(el.textContent.trim()))
  );
}

function mountWithMiniDom(element) {
  const container = globalThis.document.createElement("div");
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => {
    root.render(element);
  });
  return {
    container,
    rerender(nextElement) {
      flushSync(() => {
        root.render(nextElement);
      });
    },
    unmount() {
      flushSync(() => {
        root.unmount();
      });
      container.parentNode?.removeChild(container);
    },
  };
}

// ============================================================================
// 1. Backend Exercise Normalization & Single-Lesson Generation (server/ai.js)
// ============================================================================
describe("Practice Studio backend normalization & single-lesson generation", () => {
  beforeEach(() => {
    resetModelManager();
  });

  test("normalizePracticeExercises rejects invalid modes and invalid payloads", () => {
    assert.throws(
      () => normalizePracticeExercises({ exercises: [] }, "bogus_mode"),
      (err) => err.code === "INVALID_PRACTICE_MODE" && err.retryable === false
    );
    assert.throws(
      () => normalizePracticeExercises(null, "mixed"),
      (err) => err.code === "AI_INVALID_PRACTICE" && err.retryable === true
    );
    assert.throws(
      () => normalizePracticeExercises({ exercises: [] }, "quiz"),
      (err) => err.code === "AI_INVALID_PRACTICE"
    );
    assert.throws(
      () => normalizePracticeExercises("not json at all", "quiz"),
      (err) => err.code === "AI_INVALID_JSON"
    );
    assert.throws(
      () =>
        normalizePracticeExercises(
          {
            exercises: [
              { type: "quiz", prompt: "Only 2 options", options: ["A", "B"], answerIndex: 0 },
              { type: "order", prompt: "Too short", correctSteps: ["One", "Two"] },
              { type: "word_scramble", prompt: "Bad chars", word: "SQL 101" },
            ],
          },
          "mixed"
        ),
      (err) => err.code === "AI_INVALID_PRACTICE"
    );
  });

  test("normalizePracticeExercises normalizes fill_blank, ensures wordBank includes answers + distractors, and avoids answer-prefix order", () => {
    const raw = {
      exercises: [
        // Invalid: 0 placeholders
        {
          id: "fb-bad-0",
          type: "fill_blank",
          template: "No blank here.",
          blanks: [{ index: 0, answer: "SELECT" }],
          wordBank: ["SELECT", "FROM", "WHERE", "JOIN"],
        },
        // Invalid: fewer than 4 unique wordBank items
        {
          id: "fb-bad-bank",
          type: "fill_blank",
          template: "Use ___ to filter rows.",
          blanks: [{ index: 0, answer: "WHERE" }],
          wordBank: ["WHERE", "where", "FROM", "SELECT"],
        },
        // Invalid: >3 blanks
        {
          id: "fb-bad-4",
          type: "fill_blank",
          template: "___ ___ ___ ___",
          blanks: ["A", "B", "C", "D"],
          wordBank: ["A", "B", "C", "D", "E"],
        },
        // Valid: ____ collapses to ___, answers merged into wordBank + shuffled off prefix
        {
          id: "fb-good",
          type: "fill_blank",
          prompt: "Complete the SQL filter",
          template: "Use ____ to choose columns and ___ to filter rows.",
          blanks: [{ index: 0, answer: "SELECT" }, { index: 1, answer: "WHERE" }],
          wordBank: ["SELECT", "WHERE", "GROUP BY", "ORDER BY", "where"],
          explanation: "SELECT picks columns and WHERE filters rows.",
        },
      ],
    };

    const result = normalizePracticeExercises(raw, "fill_blank");
    assert.equal(result.length, 1);
    const fb = result[0];
    assert.equal(fb.type, "fill_blank");
    assert.equal(fb.template, "Use ___ to choose columns and ___ to filter rows.");
    assert.deepEqual(fb.blanks, [
      { index: 0, answer: "SELECT" },
      { index: 1, answer: "WHERE" },
    ]);
    assert.ok(fb.wordBank.length >= 4);
    assert.ok(fb.wordBank.includes("SELECT"));
    assert.ok(fb.wordBank.includes("WHERE"));
    assert.ok(fb.wordBank.includes("GROUP BY"));
    assert.ok(fb.wordBank.includes("ORDER BY"));
    assert.equal(
      fb.wordBank[0] === "SELECT" && fb.wordBank[1] === "WHERE",
      false,
      "wordBank should not keep answers in exact prefix order"
    );
  });

  test("normalizePracticeExercises normalizes quiz and enforces 3-4 distinct options and valid answerIndex", () => {
    const result = normalizePracticeExercises(
      {
        exercises: [
          {
            id: "q-bad-idx",
            type: "quiz",
            prompt: "Out of range",
            options: ["A", "B", "C"],
            answerIndex: 3,
          },
          {
            id: "q-bad-float",
            type: "quiz",
            prompt: "Float index",
            options: ["A", "B", "C"],
            answerIndex: 1.5,
          },
          {
            id: "q-good",
            type: "quiz",
            prompt: "Which clause runs before SELECT?",
            codeSnippet: "SELECT name FROM users WHERE active = 1;",
            options: ["WHERE", "ORDER BY", "LIMIT", "where"],
            answerIndex: 0,
            hint: "Think row filtering.",
            explanation: "WHERE filters rows before projection.",
          },
        ],
      },
      "quiz"
    );

    assert.equal(result.length, 1);
    assert.deepEqual(result[0].options, ["WHERE", "ORDER BY", "LIMIT"]);
    assert.equal(result[0].answerIndex, 0);
    assert.equal(result[0].codeSnippet, "SELECT name FROM users WHERE active = 1;");
    assert.equal(result[0].hint, "Think row filtering.");
  });

  test("normalizePracticeExercises normalizes order and guarantees shuffledSteps differs from correctSteps", () => {
    const result = normalizePracticeExercises(
      {
        exercises: [
          {
            id: "ord-too-many",
            type: "order",
            prompt: "Too many steps",
            correctSteps: ["1", "2", "3", "4", "5", "6", "7"],
          },
          {
            id: "ord-good",
            type: "order",
            prompt: "Order SQL execution phases",
            correctSteps: ["FROM", "WHERE", "GROUP BY", "SELECT"],
            explanation: "SQL logically evaluates FROM -> WHERE -> GROUP BY -> SELECT.",
          },
        ],
      },
      "order"
    );

    assert.equal(result.length, 1);
    const ord = result[0];
    assert.deepEqual(ord.correctSteps, ["FROM", "WHERE", "GROUP BY", "SELECT"]);
    assert.notDeepEqual(ord.shuffledSteps, ord.correctSteps);
    assert.deepEqual([...ord.shuffledSteps].sort(), [...ord.correctSteps].sort());
  });

  test("normalizePracticeExercises normalizes word_scramble and guarantees scrambledLetters differs from word", () => {
    const result = normalizePracticeExercises(
      {
        exercises: [
          { id: "ws-short", type: "word_scramble", prompt: "Too short", word: "ID" },
          { id: "ws-repeat", type: "word_scramble", prompt: "Same letters", word: "AAAA" },
          { id: "ws-digits", type: "word_scramble", prompt: "Has digit", word: "SQL2" },
          {
            id: "ws-good",
            type: "word_scramble",
            prompt: "Structure that speeds up lookups",
            word: "index",
            hint: "B-tree uses this",
            explanation: "An INDEX accelerates queries.",
          },
        ],
      },
      "word_scramble"
    );

    assert.equal(result.length, 1);
    const ws = result[0];
    assert.equal(ws.word, "INDEX");
    assert.notDeepEqual(ws.scrambledLetters, ["I", "N", "D", "E", "X"]);
    assert.deepEqual([...ws.scrambledLetters].sort(), ["D", "E", "I", "N", "X"]);
  });

  test("normalizePracticeExercises in mixed mode picks 1 of each type and deduplicates colliding IDs", () => {
    const result = normalizePracticeExercises(
      JSON.stringify({
        exercises: [
          {
            id: "dup",
            type: "fill_blank",
            prompt: "Fill it",
            template: "Use ___ to sort.",
            blanks: [{ index: 0, answer: "ORDER BY" }],
            wordBank: ["ORDER BY", "WHERE", "JOIN", "LIMIT"],
            explanation: "ORDER BY sorts.",
          },
          {
            id: "dup",
            type: "fill_blank",
            prompt: "Second fill",
            template: "Use ___ to limit.",
            blanks: [{ index: 0, answer: "LIMIT" }],
            wordBank: ["LIMIT", "WHERE", "JOIN", "GROUP BY"],
          },
          {
            id: "dup",
            type: "quiz",
            prompt: "Pick one",
            options: ["A", "B", "C"],
            answerIndex: 1,
          },
          {
            id: "dup",
            type: "order",
            prompt: "Order these",
            correctSteps: ["Step 1", "Step 2", "Step 3"],
          },
          {
            id: "dup",
            type: "word_scramble",
            prompt: "Clue",
            word: "SCHEMA",
          },
        ],
      }),
      "mixed"
    );

    assert.deepEqual(
      result.map((e) => e.type),
      ["fill_blank", "quiz", "order", "word_scramble"]
    );
    assert.equal(new Set(result.map((e) => e.id)).size, 4);
  });

  test("generatePracticeExercises forwards checkpoint.question and excludeQuestions, sets json:true, and returns metadata", async (t) => {
    await withEnvironment({}, async () => {
      await assert.rejects(
        generatePracticeExercises({ lesson: { title: "Joins" }, mode: "mixed" }),
        (err) => err.code === "AI_NOT_CONFIGURED"
      );
    });

    await withEnvironment(
      {
        NVIDIA_API_KEY: "test-secret",
        NVIDIA_BASE_URL: "https://nvidia.test/v1",
        NVIDIA_MODEL: "test/practice-model",
      },
      async () => {
        let capturedBody = null;
        installFetch(t, async (_url, options) => {
          capturedBody = JSON.parse(options.body);
          return providerJsonResponse({
            exercises: [
              {
                id: "q1",
                type: "quiz",
                prompt: "Which join returns all rows from the left table?",
                options: ["INNER JOIN", "LEFT JOIN", "CROSS JOIN"],
                answerIndex: 1,
                hint: "Left side preserved.",
                explanation: "LEFT JOIN preserves unmatched left rows.",
              },
            ],
          });
        });

        const output = await generatePracticeExercises({
          lesson: {
            title: "SQL Joins",
            objective: "Combine related tables cleanly.",
            content_markdown: "Use INNER and LEFT joins.",
            checkpoint: { question: "What does INNER JOIN return?" },
          },
          courseTitle: "SQL Analytics",
          mode: "quiz",
          excludeQuestions: ["Already asked question?"],
          memory: [{ id: "note:1", type: "note", title: "My note", excerpt: "LEFT JOIN keeps nulls." }],
        });

        assert.equal(capturedBody.response_format?.type, "json_object");
        const userPayload = JSON.parse(capturedBody.messages[1].content);
        assert.equal(userPayload.mode, "quiz");
        assert.equal(userPayload.lesson.checkpointQuestion, "What does INNER JOIN return?");
        assert.deepEqual(userPayload.excludeQuestions, [
          "What does INNER JOIN return?",
          "Already asked question?",
        ]);
        assert.equal(userPayload.learnerMemory.length, 1);

        assert.equal(output.mode, "quiz");
        assert.equal(output.source, "nvidia");
        assert.equal(output.model, "test/practice-model");
        assert.equal(output.failoverCount, 0);
        assert.equal(output.exercises.length, 1);
        assert.equal(output.exercises[0].type, "quiz");
      }
    );
  });
});

// ============================================================================
// 2. API Endpoints (api/[...path].js) — DB & Mongo mocked cleanly
// ============================================================================
describe("Practice Studio API routes (POST /api/practice/generate & POST /api/practice)", () => {
  let vite;
  let handler;
  let apiState;

  const userId = "11111111-1111-4111-8111-111111111111";
  const lessonId = "33333333-3333-4333-8333-333333333333";
  const otherLessonId = "99999999-9999-4999-8999-999999999999";
  const taskId = "22222222-2222-4222-8222-222222222222";

  function mockApiPlugin() {
    const replacements = new Map([
      ["../server/db.js", "db"],
      ["../server/auth.js", "auth"],
      ["../server/email.js", "email"],
      ["../server/plan-service.js", "plans"],
      ["../server/materials-generator.js", "materials"],
      ["../server/model-manager.js", "models"],
      ["../server/ai.js", "ai"],
      ["../server/retrieval.js", "retrieval"],
      ["../server/rag-service.js", "rag"],
    ]);
    return {
      name: "practice-api-test-mocks",
      enforce: "pre",
      resolveId(source, importer) {
        if (!importer?.includes("api/[...path].js")) return null;
        const key = replacements.get(source);
        return key ? `\0practice-api-mock:${key}` : null;
      },
      load(id) {
        if (!id.startsWith("\0practice-api-mock:")) return null;
        const mod = id.slice("\0practice-api-mock:".length);
        if (mod === "db") {
          return `
            export async function query(...args) { return globalThis.__practiceApiTest.query(...args); }
            export async function withTransaction(work) { return work({ query: (...args) => globalThis.__practiceApiTest.query(...args) }); }
          `;
        }
        if (mod === "auth") {
          return `
            export async function requireUser() { return globalThis.__practiceApiTest.user; }
            export function sessionUserId() { return globalThis.__practiceApiTest.user.id; }
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
        if (mod === "materials") return `export async function getCourseMaterialsStatus() { return {}; }`;
        if (mod === "models") return `export function getModelPoolStatus() { return {}; }`;
        if (mod === "ai") {
          return `
            export async function tutorReply(...args) { return globalThis.__practiceApiTest.tutorReply(...args); }
            export async function generatePracticeExercises(...args) { return globalThis.__practiceApiTest.generatePracticeExercises(...args); }
          `;
        }
        if (mod === "retrieval") {
          return `export async function retrieveLearnerContext(...args) { return globalThis.__practiceApiTest.retrieveLearnerContext(...args); }`;
        }
        if (mod === "rag") {
          return `
            export async function indexUserSource(...args) { return globalThis.__practiceApiTest.indexUserSource(...args); }
            export async function deleteUserSourceChunks() {}
            export async function reindexUserCorpus() { return {}; }
            export async function getRagStatus() { return {}; }
          `;
        }
        return null;
      },
    };
  }

  async function callApi(url, body, method = "POST") {
    const res = {
      statusCode: 200,
      headers: new Map(),
      setHeader(k, v) {
        this.headers.set(k.toLowerCase(), v);
      },
      end(payload = "") {
        this.body = payload;
      },
    };
    await handler({ url, method, headers: {}, body }, res);
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
    const ownedLesson = {
      id: lessonId,
      course_id: "55555555-5555-4555-8555-555555555555",
      course_title: "SQL Analytics",
      title: "SQL Joins",
      objective: "Combine related rows with joins.",
      checkpoint: {
        question: "Which join keeps unmatched left rows?",
        options: ["INNER JOIN", "LEFT JOIN"],
        answerIndex: 1,
        explanation: "LEFT JOIN preserves unmatched left rows.",
      },
    };

    apiState = {
      user: { id: userId, email: "learner@example.com", full_name: "Ada" },
      ownedLesson,
      queries: [],
      indexed: [],
      generateCalls: [],
      retrieveLearnerContext: async () => [{ id: "note:1", type: "note", title: "Join notes", excerpt: "Use ON." }],
      indexUserSource: async (_uid, doc) => {
        apiState.indexed.push(doc);
      },
      tutorReply: async () => ({ text: "" }),
      generatePracticeExercises: async (args) => {
        apiState.generateCalls.push(args);
        return {
          exercises: [
            {
              id: "ex-1",
              type: "quiz",
              prompt: "Which clause defines join keys?",
              options: ["ON", "WHERE", "GROUP BY"],
              answerIndex: 0,
              hint: "Follows JOIN table",
              explanation: "ON specifies join predicates.",
            },
          ],
          mode: args.mode,
          source: "nvidia",
          model: "test-model",
          failoverCount: 0,
        };
      },
      query: async (sql, values = []) => {
        apiState.queries.push({ sql, values });
        if (sql.includes("SELECT l.*, c.title AS course_title FROM lessons l JOIN courses c")) {
          return { rows: values[0] === lessonId && values[1] === userId ? [ownedLesson] : [] };
        }
        if (sql.includes("SELECT l.id,l.course_id,l.title,l.objective,l.checkpoint FROM lessons")) {
          return { rows: values[0] === lessonId && values[1] === userId ? [ownedLesson] : [] };
        }
        if (sql.includes("SELECT id,lesson_id FROM study_tasks")) {
          return { rows: values[0] === taskId && values[1] === userId ? [{ id: taskId, lesson_id: lessonId }] : [] };
        }
        if (sql.includes("INSERT INTO practice_attempts")) {
          return {
            rows: [
              {
                id: "attempt-1",
                user_id: values[0],
                task_id: values[1],
                lesson_id: values[2],
                concept: values[3],
                prompt: values[4],
                submitted_answer: values[5],
                result: JSON.parse(values[6]),
                score: values[7],
              },
            ],
          };
        }
        return { rows: [] };
      },
    };
    globalThis.__practiceApiTest = apiState;
  });

  after(async () => {
    await vite?.close();
    delete globalThis.__practiceApiTest;
  });

  test("POST /api/practice/generate validates lessonId UUID, practice mode, and lesson ownership", async () => {
    const nonUuid = await callApi("/api/practice/generate", { lessonId: "not-a-uuid", mode: "mixed" });
    assert.equal(nonUuid.status, 404);
    assert.equal(nonUuid.json.error.code, "NOT_FOUND");

    const invalidMode = await callApi("/api/practice/generate", { lessonId, mode: "essay_mode" });
    assert.equal(invalidMode.status, 400);
    assert.equal(invalidMode.json.error.code, "INVALID_PRACTICE_MODE");

    const unowned = await callApi("/api/practice/generate", { lessonId: otherLessonId, mode: "quiz" });
    assert.equal(unowned.status, 404);
    assert.equal(unowned.json.error.code, "NOT_FOUND");
    assert.equal(apiState.generateCalls.length, 0);
  });

  test("POST /api/practice/generate generates exercises for owned lesson and tolerates retrieval failure", async () => {
    const ok = await callApi("/api/practice/generate", {
      lessonId,
      mode: "quiz",
      excludeQuestions: ["Old question?"],
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.mode, "quiz");
    assert.equal(ok.json.exercises.length, 1);
    assert.equal(apiState.generateCalls.length, 1);
    assert.equal(apiState.generateCalls[0].courseTitle, "SQL Analytics");
    assert.deepEqual(apiState.generateCalls[0].excludeQuestions, ["Old question?"]);
    assert.equal(apiState.generateCalls[0].memory.length, 1);

    apiState.retrieveLearnerContext = async () => {
      throw new Error("RAG unavailable");
    };
    const fallbackOk = await callApi("/api/practice/generate", { lessonId, mode: "mixed" });
    assert.equal(fallbackOk.status, 200);
    assert.deepEqual(apiState.generateCalls[1].memory, []);
  });

  test("POST /api/practice preserves legacy checkpoint grading when exerciseType is omitted or 'checkpoint'", async () => {
    const legacyPass = await callApi("/api/practice", {
      lessonId,
      answer: "LEFT JOIN",
      selectedIndex: 1,
    });
    assert.equal(legacyPass.status, 201);
    assert.equal(legacyPass.json.result.correct, true);
    assert.equal(legacyPass.json.result.explanation, "LEFT JOIN preserves unmatched left rows.");
    assert.equal(legacyPass.json.attempt.score, 100);

    const checkpointModeFail = await callApi("/api/practice", {
      lessonId,
      exerciseType: "checkpoint",
      answer: "INNER JOIN",
      selectedIndex: 0,
    });
    assert.equal(checkpointModeFail.status, 201);
    assert.equal(checkpointModeFail.json.result.correct, false);
    assert.equal(checkpointModeFail.json.attempt.score, 0);
  });

  test("POST /api/practice records custom Practice Studio exerciseType with clamped/derived score and explanation without checkpoint overwrite", async () => {
    for (const exerciseType of ["fill_blank", "quiz", "order", "word_scramble"]) {
      const custom = await callApi("/api/practice", {
        lessonId,
        exerciseType,
        prompt: `Custom ${exerciseType} prompt`,
        answer: "custom answer",
        correct: false,
        explanation: `Explanation for ${exerciseType}`,
      });
      assert.equal(custom.status, 201);
      assert.deepEqual(custom.json.result, {
        exerciseType,
        correct: false,
        explanation: `Explanation for ${exerciseType}`,
      });
      assert.equal(custom.json.attempt.score, 0);
    }

    const clampedHigh = await callApi("/api/practice", {
      lessonId,
      exerciseType: "quiz",
      answer: "Option A",
      correct: true,
      score: 142.7,
      explanation: "Clamped to 100",
    });
    assert.equal(clampedHigh.status, 201);
    assert.equal(clampedHigh.json.attempt.score, 100);

    const clampedLow = await callApi("/api/practice", {
      lessonId,
      exerciseType: "order",
      answer: "A -> B",
      correct: false,
      score: -15,
      explanation: "Clamped to 0",
    });
    assert.equal(clampedLow.status, 201);
    assert.equal(clampedLow.json.attempt.score, 0);

    const derivedTrue = await callApi("/api/practice", {
      lessonId,
      exerciseType: "word_scramble",
      answer: "INDEX",
      correct: true,
      explanation: "Derived 100 without score",
    });
    assert.equal(derivedTrue.status, 201);
    assert.equal(derivedTrue.json.attempt.score, 100);
    assert.equal(derivedTrue.json.result.explanation, "Derived 100 without score");
  });

  test("POST /api/practice enforces empty answer, lesson ownership, and task/lesson match", async () => {
    const empty = await callApi("/api/practice", { lessonId, answer: "   " });
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error.code, "ANSWER_REQUIRED");

    const unowned = await callApi("/api/practice", { lessonId: otherLessonId, answer: "ok" });
    assert.equal(unowned.status, 404);

    const mismatch = await callApi("/api/practice", {
      taskId,
      lessonId: otherLessonId,
      answer: "ok",
    });
    assert.equal(mismatch.status, 400);
    assert.equal(mismatch.json.error.code, "TASK_LESSON_MISMATCH");
  });
});

// ============================================================================
// 3. Browser IndexedDB Cache & Fallback (src/practice-db.js)
// ============================================================================
describe("Browser IndexedDB practice cache & Map fallback (src/practice-db.js)", () => {
  test("buildPracticeSetKey builds user/lesson/mode-scoped keys with clean defaults", () => {
    assert.equal(buildPracticeSetKey("u1", "l1", "quiz"), "u1::l1::quiz");
    assert.equal(buildPracticeSetKey("", "", ""), "anon::none::mixed");
    assert.equal(buildPracticeSetKey(null, undefined, "order"), "anon::none::order");
  });

  test("savePracticeSet, loadPracticeSet, listLessonPracticeModes, and clearPracticeSet scope by user/lesson/mode in IndexedDB", async () => {
    const idb = createMockIndexedDB();
    const keyQuiz = buildPracticeSetKey("user-1", "lesson-A", "quiz");
    const keyOrder = buildPracticeSetKey("user-1", "lesson-A", "order");
    const keyOtherLesson = buildPracticeSetKey("user-1", "lesson-B", "quiz");
    const keyOtherUser = buildPracticeSetKey("user-2", "lesson-A", "quiz");

    const saveRes = await savePracticeSet(
      keyQuiz,
      {
        lessonTitle: "SQL Joins",
        exercises: [{ id: "q1", type: "quiz" }, { id: "q2", type: "quiz" }],
        progress: {
          activeIndex: 1,
          resultsById: { q1: { correct: true, score: 100 } },
          statesById: { q1: { selectedIndex: 0, checked: true } },
          savedAttemptIds: { q1: true },
        },
        source: "nvidia",
        model: "model-x",
      },
      { indexedDBImpl: idb }
    );
    assert.deepEqual(saveRes, { saved: true, fallback: false });

    await savePracticeSet(
      keyOrder,
      {
        lessonTitle: "SQL Joins",
        exercises: [{ id: "o1", type: "order" }],
        progress: { activeIndex: 0, resultsById: {}, statesById: {}, savedAttemptIds: {} },
      },
      { indexedDBImpl: idb }
    );
    await savePracticeSet(keyOtherLesson, { exercises: [{ id: "ol", type: "quiz" }] }, { indexedDBImpl: idb });
    await savePracticeSet(keyOtherUser, { exercises: [{ id: "ou", type: "quiz" }] }, { indexedDBImpl: idb });

    const loaded = await loadPracticeSet(keyQuiz, { indexedDBImpl: idb });
    assert.equal(loaded.key, keyQuiz);
    assert.equal(loaded.userId, "user-1");
    assert.equal(loaded.lessonId, "lesson-A");
    assert.equal(loaded.mode, "quiz");
    assert.equal(loaded.exercises.length, 2);
    assert.equal(loaded.progress.activeIndex, 1);
    assert.deepEqual(loaded.progress.savedAttemptIds, { q1: true });

    const modes = await listLessonPracticeModes("user-1", "lesson-A", { indexedDBImpl: idb });
    assert.equal(modes.length, 2);
    assert.ok(modes.every((m) => m.userId === "user-1" && m.lessonId === "lesson-A"));
    const quizSummary = modes.find((m) => m.mode === "quiz");
    assert.equal(quizSummary.exerciseCount, 2);
    assert.equal(quizSummary.completedCount, 1);
    assert.equal(quizSummary.correctCount, 1);

    const cleared = await clearPracticeSet(keyOrder, { indexedDBImpl: idb });
    assert.deepEqual(cleared, { cleared: true, fallback: false });
    assert.equal(await loadPracticeSet(keyOrder, { indexedDBImpl: idb }), null);
    assert.equal((await listLessonPracticeModes("user-1", "lesson-A", { indexedDBImpl: idb })).length, 1);

    // Cleanup remaining keys
    await clearPracticeSet(keyQuiz, { indexedDBImpl: idb });
    await clearPracticeSet(keyOtherLesson, { indexedDBImpl: idb });
    await clearPracticeSet(keyOtherUser, { indexedDBImpl: idb });
  });

  test("falls back cleanly to in-memory Map when indexedDBImpl is null or fails to open", async () => {
    const keyNull = buildPracticeSetKey("user-mem", "lesson-mem", "fill_blank");
    const savedNull = await savePracticeSet(
      keyNull,
      { exercises: [{ id: "fb1", type: "fill_blank" }] },
      { indexedDBImpl: null }
    );
    assert.deepEqual(savedNull, { saved: true, fallback: true });
    const loadedNull = await loadPracticeSet(keyNull, { indexedDBImpl: null });
    assert.equal(loadedNull.exercises.length, 1);

    const brokenIdb = createMockIndexedDB({ failOnOpen: true });
    const keyBroken = buildPracticeSetKey("user-mem", "lesson-mem", "word_scramble");
    const savedBroken = await savePracticeSet(
      keyBroken,
      { exercises: [{ id: "ws1", type: "word_scramble" }] },
      { indexedDBImpl: brokenIdb }
    );
    assert.deepEqual(savedBroken, { saved: true, fallback: true });
    const loadedBroken = await loadPracticeSet(keyBroken, { indexedDBImpl: brokenIdb });
    assert.equal(loadedBroken.exercises[0].id, "ws1");

    const listed = await listLessonPracticeModes("user-mem", "lesson-mem", { indexedDBImpl: brokenIdb });
    assert.equal(listed.length, 2);

    const clearedBroken = await clearPracticeSet(keyBroken, { indexedDBImpl: brokenIdb });
    assert.deepEqual(clearedBroken, { cleared: true, fallback: true });
    assert.equal(await loadPracticeSet(keyBroken, { indexedDBImpl: brokenIdb }), null);
    await clearPracticeSet(keyNull, { indexedDBImpl: null });
  });
});

// ============================================================================
// 4. Interactive Exercise Components, PracticePage & CSS Verification
// ============================================================================
describe("Interactive Practice Studio components, PracticePage, and CSS parity", () => {
  let vite;
  let FillBlankExercise;
  let QuizExercise;
  let OrderExercise;
  let WordScrambleExercise;
  let PracticeStudioRunner;
  let PracticePage;

  const localStorageValues = new Map();
  const sessionStorageValues = new Map();
  let miniDom;

  function exposePracticePagePlugin() {
    return {
      name: "expose-practice-page-for-test",
      transform(code, id) {
        if (id.endsWith("/src/App.jsx") || id.endsWith("\\src\\App.jsx")) {
          return {
            code: `${code}\nexport { PracticePage };`,
            map: null,
          };
        }
        return null;
      },
    };
  }

  before(async () => {
    miniDom = createMiniDom();
    globalThis.window = miniDom.win;
    globalThis.document = miniDom.doc;
    globalThis.Node = miniDom.win.Node;
    globalThis.Element = miniDom.win.Element;
    globalThis.HTMLElement = miniDom.win.HTMLElement;
    globalThis.HTMLIFrameElement = miniDom.win.HTMLIFrameElement;
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

    vite = await createServer({
      configFile: "./vite.config.js",
      logLevel: "silent",
      plugins: [exposePracticePagePlugin()],
      server: { middlewareMode: true },
      appType: "custom",
    });
    ({
      FillBlankExercise,
      QuizExercise,
      OrderExercise,
      WordScrambleExercise,
      PracticeStudioRunner,
    } = await vite.ssrLoadModule("/src/practice-exercises.jsx"));
    ({ PracticePage } = await vite.ssrLoadModule("/src/App.jsx"));
  });

  after(async () => {
    await vite?.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.Node;
    delete globalThis.Element;
    delete globalThis.HTMLElement;
    delete globalThis.HTMLIFrameElement;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  });

  test("FillBlankExercise supports chip selection, slot clearing, keyboard typing, hint toggle, check, and reset", () => {
    const exercise = {
      id: "fb-1",
      type: "fill_blank",
      prompt: "Complete the SQL query",
      template: "___ columns FROM users ___ active = 1;",
      blanks: [
        { index: 0, answer: "SELECT" },
        { index: 1, answer: "WHERE" },
      ],
      wordBank: ["WHERE", "ORDER BY", "SELECT", "LIMIT"],
      explanation: "SELECT chooses columns and WHERE filters rows.",
    };
    const results = [];
    const mounted = mountWithMiniDom(
      React.createElement(FillBlankExercise, {
        exercise,
        onResult: (r) => results.push(r),
      })
    );

    const checkBtn = () => findButton(mounted.container, "Check answer");
    assert.equal(checkBtn().disabled, true);

    // Toggle hint
    flushSync(() => findButton(mounted.container, "Show hint").click());
    assert.ok(findOne(mounted.container, (el) => el.classList.contains("practice-hint-box")));

    const bankChip = (label) =>
      findOne(
        mounted.container,
        (el) => el.classList.contains("practice-bank-chip") && el.textContent.trim() === label
      );

    // Click SELECT chip -> fills Blank 1 and advances activeBlank to Blank 2
    flushSync(() => bankChip("SELECT").click());
    let slots = findAll(mounted.container, (el) => el.classList.contains("practice-blank-slot"));
    assert.equal(slots[0].textContent, "SELECT");
    assert.equal(slots[0].classList.contains("filled"), true);
    assert.equal(slots[1].classList.contains("active"), true);
    assert.equal(bankChip("SELECT").classList.contains("used"), true);

    // Clicking an already-used chip clears its slot
    flushSync(() => bankChip("SELECT").click());
    slots = findAll(mounted.container, (el) => el.classList.contains("practice-blank-slot"));
    assert.equal(slots[0].textContent, "Blank 1");

    // Refill both blanks (case-insensitive typing on slot 0, chip click on slot 1)
    flushSync(() => slots[0].keydown("s"));
    flushSync(() => slots[0].keydown("e"));
    flushSync(() => slots[0].keydown("l"));
    flushSync(() => slots[0].keydown("e"));
    flushSync(() => slots[0].keydown("c"));
    flushSync(() => slots[0].keydown("t"));
    flushSync(() => slots[1].click());
    flushSync(() => bankChip("WHERE").click());
    assert.equal(checkBtn().disabled, false);

    // Check answer
    flushSync(() => checkBtn().click());
    assert.equal(results.length, 1);
    assert.equal(results[0].correct, true);
    assert.equal(results[0].score, 100);
    slots = findAll(mounted.container, (el) => el.classList.contains("practice-blank-slot"));
    assert.equal(slots[0].classList.contains("correct"), true);
    assert.equal(slots[1].classList.contains("correct"), true);
    assert.match(mounted.container.textContent, /Correct!/);

    // Reset clears slots and checked state
    flushSync(() => findButton(mounted.container, "Reset").click());
    slots = findAll(mounted.container, (el) => el.classList.contains("practice-blank-slot"));
    assert.equal(slots[0].textContent, "Blank 1");
    assert.equal(findOne(mounted.container, (el) => el.classList.contains("feedback-box")), null);
    mounted.unmount();
  });

  test("QuizExercise renders codeSnippet, hint, option selection, grading, and Try again reset", () => {
    const exercise = {
      id: "qz-1",
      type: "quiz",
      prompt: "What does `COUNT(*)` count?",
      codeSnippet: "SELECT COUNT(*) FROM orders;",
      options: ["Only non-null rows", "All rows including NULLs", "Distinct keys"],
      answerIndex: 1,
      hint: "Star counts rows, not a single column.",
      explanation: "COUNT(*) counts every row in the group.",
    };
    const results = [];
    const mounted = mountWithMiniDom(
      React.createElement(QuizExercise, {
        exercise,
        onResult: (r) => results.push(r),
      })
    );

    assert.equal(
      findOne(mounted.container, (el) => el.tagName === "PRE" && el.classList.contains("practice-code-snippet"))?.textContent,
      "SELECT COUNT(*) FROM orders;"
    );
    flushSync(() => findButton(mounted.container, "Show hint").click());
    assert.match(mounted.container.textContent, /Star counts rows/);

    const options = findAll(mounted.container, (el) => el.classList.contains("answer-option"));
    assert.equal(options.length, 3);
    assert.equal(findButton(mounted.container, "Check answer").disabled, true);

    // Select wrong option first and check
    flushSync(() => options[0].click());
    assert.equal(options[0].classList.contains("selected"), true);
    flushSync(() => findButton(mounted.container, "Check answer").click());
    assert.equal(results.length, 1);
    assert.equal(results[0].correct, false);
    assert.equal(results[0].score, 0);
    assert.match(mounted.container.textContent, /Not quite/);

    // Try again resets and allows choosing correct option
    flushSync(() => findButton(mounted.container, "Try again").click());
    const optionsAfterReset = findAll(mounted.container, (el) => el.classList.contains("answer-option"));
    flushSync(() => optionsAfterReset[1].click());
    flushSync(() => findButton(mounted.container, "Check answer").click());
    assert.equal(results.length, 2);
    assert.equal(results[1].correct, true);
    assert.equal(results[1].score, 100);
    assert.match(mounted.container.textContent, /Correct!/);
    mounted.unmount();
  });

  test("OrderExercise reorders steps via Move Up / Move Down, grades sequence, and resets", () => {
    const exercise = {
      id: "ord-1",
      type: "order",
      prompt: "Order the pipeline",
      correctSteps: ["Extract", "Transform", "Load"],
      shuffledSteps: ["Transform", "Extract", "Load"],
      explanation: "ETL stands for Extract, Transform, Load.",
    };
    const results = [];
    const mounted = mountWithMiniDom(
      React.createElement(OrderExercise, {
        exercise,
        onResult: (r) => results.push(r),
      })
    );

    const getOrderTexts = () =>
      findAll(mounted.container, (el) => el.classList.contains("practice-order-text")).map((el) => el.textContent);

    assert.deepEqual(getOrderTexts(), ["Transform", "Extract", "Load"]);

    // Move step 2 ("Extract") up -> ["Extract", "Transform", "Load"]
    const moveStep2Up = findOne(
      mounted.container,
      (el) => el.tagName === "BUTTON" && el.getAttribute("aria-label") === "Move step 2 up"
    );
    flushSync(() => moveStep2Up.click());
    assert.deepEqual(getOrderTexts(), ["Extract", "Transform", "Load"]);

    flushSync(() => findButton(mounted.container, "Check order").click());
    assert.equal(results.length, 1);
    assert.equal(results[0].correct, true);
    assert.equal(results[0].score, 100);
    assert.match(mounted.container.textContent, /Order is correct!/);

    // Reset restores shuffledSteps, then check wrong order
    flushSync(() => findButton(mounted.container, "Reset").click());
    assert.deepEqual(getOrderTexts(), ["Transform", "Extract", "Load"]);
    flushSync(() => findButton(mounted.container, "Check order").click());
    assert.equal(results.length, 2);
    assert.equal(results[1].correct, false);
    assert.match(mounted.container.textContent, /Correct sequence: 1\. Extract → 2\. Transform → 3\. Load/);
    mounted.unmount();
  });

  test("WordScrambleExercise handles tile placement, slot removal, shuffle, hint, keyboard input, check, and clear", () => {
    const exercise = {
      id: "ws-1",
      type: "word_scramble",
      prompt: "Relational table key",
      word: "JOIN",
      scrambledLetters: ["N", "J", "I", "O"],
      hint: "Combines tables",
      explanation: "JOIN links tables.",
    };
    const results = [];
    const mounted = mountWithMiniDom(
      React.createElement(WordScrambleExercise, {
        exercise,
        onResult: (r) => results.push(r),
      })
    );

    flushSync(() => findButton(mounted.container, "Hint").click());
    assert.match(mounted.container.textContent, /Combines tables \(Starts with "J" \(4 letters\)\)/);

    const tileByChar = (ch) =>
      findOne(
        mounted.container,
        (el) => el.classList.contains("practice-letter-tile") && el.textContent === ch
      );

    flushSync(() => tileByChar("J").click());
    flushSync(() => tileByChar("O").click());
    let slots = findAll(mounted.container, (el) => el.classList.contains("practice-scramble-slot"));
    assert.equal(slots[0].textContent, "J");
    assert.equal(slots[1].textContent, "O");

    // Remove slot 1 ("O"), then finish typing via keyboard ("o", "i", "n")
    flushSync(() => slots[1].click());
    const card = findOne(mounted.container, (el) => el.classList.contains("practice-exercise-card"));
    flushSync(() => card.keydown("o"));
    flushSync(() => card.keydown("i"));
    flushSync(() => card.keydown("n"));
    assert.equal(findButton(mounted.container, "Check word").disabled, false);

    flushSync(() => findButton(mounted.container, "Check word").click());
    assert.equal(results.length, 1);
    assert.equal(results[0].correct, true);
    assert.equal(results[0].answer, "JOIN");
    assert.match(mounted.container.textContent, /Exact match!/);

    // Clear resets placed tiles and enables shuffle
    flushSync(() => findButton(mounted.container, "Clear").click());
    const beforeShuffle = findAll(mounted.container, (el) => el.classList.contains("practice-letter-tile")).map(
      (el) => el.textContent
    );
    flushSync(() => findButton(mounted.container, "Shuffle").click());
    const afterShuffle = findAll(mounted.container, (el) => el.classList.contains("practice-letter-tile")).map(
      (el) => el.textContent
    );
    assert.equal(afterShuffle.length, beforeShuffle.length);
    mounted.unmount();
  });

  test("PracticeStudioRunner navigates steps, preserves per-exercise state, and records attempts", async () => {
    const exercises = [
      {
        id: "ex-quiz",
        type: "quiz",
        prompt: "Pick B",
        options: ["A", "B", "C"],
        answerIndex: 1,
        explanation: "B is right.",
      },
      {
        id: "ex-order",
        type: "order",
        prompt: "Order 1-2-3",
        correctSteps: ["1", "2", "3"],
        shuffledSteps: ["2", "1", "3"],
        explanation: "1 -> 2 -> 3",
      },
    ];
    const persisted = [];
    const recorded = [];
    const mounted = mountWithMiniDom(
      React.createElement(PracticeStudioRunner, {
        exercises,
        mode: "mixed",
        lesson: { id: "l1", title: "SQL" },
        onPersistProgress: (snap) => persisted.push(snap),
        onRecordAttempt: async (payload) => {
          recorded.push(payload);
          return true;
        },
      })
    );

    assert.match(mounted.container.textContent, /0\/2 checked · 0 correct/);
    const optB = findAll(mounted.container, (el) => el.classList.contains("answer-option"))[1];
    flushSync(() => optB.click());
    flushSync(() => findButton(mounted.container, "Check answer").click());
    await Promise.resolve();

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].exercise.id, "ex-quiz");
    assert.equal(recorded[0].correct, true);
    assert.match(mounted.container.textContent, /1\/2 checked · 1 correct/);

    // Navigate Next -> Prev and ensure checked Quiz state is preserved
    flushSync(() => findButton(mounted.container, "Next").click());
    assert.match(mounted.container.textContent, /Order 1-2-3/);
    flushSync(() => findButton(mounted.container, "Prev").click());
    assert.match(mounted.container.textContent, /B is right\./);
    assert.ok(persisted.length >= 2);
    mounted.unmount();
  });

  test("PracticePage renders EmptyState when no lesson exists and renders lazy mode tabs without auto-calling AI", async () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(PracticePage, {
        lessons: [],
        data: { attempts: [], tasks: [] },
        go() {},
        openAccount() {},
      })
    );
    assert.match(emptyHtml, /Choose a lesson first/);
    assert.doesNotMatch(emptyHtml, /practice-mode-tabs/);

    const requests = [];
    const sampleLesson = {
      id: "33333333-3333-4333-8333-333333333333",
      title: "SQL Joins",
      moduleTitle: "Module 1",
      objective: "Combine tables.",
      checkpoint: {
        question: "Which join keeps left rows?",
        options: ["INNER", "LEFT"],
        answerIndex: 1,
        explanation: "LEFT keeps left rows.",
      },
    };

    const mounted = mountWithMiniDom(
      React.createElement(PracticePage, {
        remote: true,
        user: { id: "u-lazy", fullName: "Ada" },
        lessons: [sampleLesson],
        activeLesson: sampleLesson,
        data: { attempts: [], tasks: [] },
        request: async (path, opts) => {
          requests.push({ path, opts });
          return {
            exercises: [
              {
                id: "gen-1",
                type: "quiz",
                prompt: "Generated question?",
                options: ["One", "Two", "Three"],
                answerIndex: 0,
                explanation: "One is correct.",
              },
            ],
            mode: "mixed",
            source: "nvidia",
            model: "test-model",
            failoverCount: 0,
          };
        },
        updateData() {},
        refreshRemote: async () => {},
        flashToast() {},
        openAccount() {},
        go() {},
      })
    );

    // Wait microtasks for initial cache check
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(requests.length, 0, "PracticePage must NOT automatically call practice/generate on mount");
    const tabs = findAll(mounted.container, (el) => el.classList.contains("practice-mode-tab"));
    assert.equal(tabs.length, 6);
    const banner = findOne(mounted.container, (el) => el.classList.contains("practice-status-banner"));
    assert.ok(banner, "lazy .practice-status-banner should be rendered");
    assert.match(banner.textContent, /Select Generate Quick Mix/);

    // Explicit click on Generate Quick Mix calls API once and mounts PracticeStudioRunner
    flushSync(() => findButton(mounted.container, "Generate Quick Mix").click());
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].path, "practice/generate");
    assert.ok(findOne(mounted.container, (el) => el.classList.contains("practice-runner")));
    assert.match(mounted.container.textContent, /Regenerate Quick Mix/);

    // Clicking Regenerate Quick Mix passes prior prompt in excludeQuestions
    flushSync(() => findButton(mounted.container, "Regenerate Quick Mix").click());
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(requests.length, 2);
    assert.deepEqual(JSON.parse(requests[1].opts.body).excludeQuestions, ["Generated question?"]);

    // Switching to Topic Checkpoint preserves legacy checkpoint UI
    flushSync(() => findButton(mounted.container, "Topic Checkpoint").click());
    await new Promise((r) => setTimeout(r, 10));
    assert.match(mounted.container.textContent, /Which join keeps left rows\?/);

    // Clean up cached set from in-memory map
    await clearPracticeSet(buildPracticeSetKey("u-lazy", sampleLesson.id, "mixed"), { indexedDBImpl: null });
    mounted.unmount();

    // Signed-out learner clicking Generate sees explicit error banner + Sign in action
    let accountOpened = false;
    const signedOutMounted = mountWithMiniDom(
      React.createElement(PracticePage, {
        remote: false,
        user: null,
        lessons: [sampleLesson],
        activeLesson: sampleLesson,
        data: { attempts: [], tasks: [] },
        request: async () => {
          throw new Error("Should not call remote when signed out");
        },
        updateData() {},
        flashToast() {},
        openAccount() {
          accountOpened = true;
        },
        go() {},
      })
    );
    await new Promise((r) => setTimeout(r, 15));
    flushSync(() => findButton(signedOutMounted.container, "Generate Quick Mix").click());
    const errBanner = findOne(
      signedOutMounted.container,
      (el) => el.classList.contains("practice-status-banner") && el.classList.contains("is-error")
    );
    assert.ok(errBanner);
    assert.match(errBanner.textContent, /Sign in to generate AI practice exercises/);
    flushSync(() => findButton(errBanner, "Sign in").click());
    assert.equal(accountOpened, true);
    signedOutMounted.unmount();
  });

  test("CSS selector parity: classes rendered by PracticePage & practice-exercises.jsx match src/styles.css", async () => {
    const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
    const exercisesJsx = await readFile(new URL("../src/practice-exercises.jsx", import.meta.url), "utf8");
    const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
    const practicePageSlice = appSource.slice(
      appSource.indexOf("function PracticePage"),
      appSource.indexOf("function EvidenceList")
    );

    const mismatches = [];
    const expectSelector = (usedIn, usedClass, expectedCssSelector) => {
      if (usedIn.includes(usedClass) && !css.includes(expectedCssSelector)) {
        mismatches.push(`${usedClass} (expected ${expectedCssSelector} in src/styles.css)`);
      }
    };

    expectSelector(practicePageSlice, "practice-mode-tab", ".practice-mode-tab.selected");
    expectSelector(practicePageSlice, "cached-dot", ".cached-dot");
    expectSelector(exercisesJsx, "practice-dot", ".practice-dot.done");
    expectSelector(exercisesJsx, "practice-order-num", ".practice-order-num");
    expectSelector(exercisesJsx, "practice-code-snippet", ".practice-code-snippet");
    expectSelector(exercisesJsx, "answer-wrong", ".answer-option.answer-wrong");

    assert.deepEqual(
      mismatches,
      [],
      `CSS class mismatches found between JSX and src/styles.css:\n- ${mismatches.join("\n- ")}`
    );
  });
});
