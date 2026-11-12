import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import {
  buildTutorSystemPrompt,
  parseStructuredTutorReply,
  sanitizeTutorText,
} from "../server/ai.js";
import {
  scoreAndRankCandidates,
  analyzeQuery,
} from "../server/rag-service.js";
import { retrieveLearnerContext } from "../server/retrieval.js";

let vite;
let AppModule;
const localStorageValues = new Map();

before(async () => {
  globalThis.window = {
    location: { pathname: "/", search: "", hash: "" },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
  };
  globalThis.localStorage = {
    getItem: (key) => localStorageValues.get(key) || null,
    setItem: (key, value) => localStorageValues.set(key, String(value)),
    removeItem: (key) => localStorageValues.delete(key),
    clear: () => localStorageValues.clear(),
  };
  globalThis.sessionStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  vite = await createServer({
    configFile: "./vite.config.js",
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
  });
  AppModule = await vite.ssrLoadModule("/src/App.jsx");
});

beforeEach(() => {
  localStorageValues.clear();
});

after(async () => {
  await vite?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

test("buildTutorSystemPrompt enforces domain matching and forbids programming cross-talk for non-coding topics", () => {
  const prompt = buildTutorSystemPrompt("Explain");
  assert.ok(
    prompt.includes("Always match the academic discipline, tone, and domain of the course"),
    "System prompt must instruct tutor to match the academic discipline and domain"
  );
  assert.ok(
    prompt.includes("do NOT output programming code, Python scripts, or software engineering analogies unless the course is explicitly about computer programming"),
    "System prompt must explicitly forbid programming scripts on non-coding courses"
  );
  assert.ok(
    prompt.includes("Never confuse or cross-pollinate subjects"),
    "System prompt must prevent cross-pollinating unrelated subjects"
  );
  assert.ok(
    prompt.includes("Never cite the current lesson or topic ID"),
    "Tutor prompt must instruct model never to cite current lesson or topic ID"
  );
  assert.ok(
    prompt.includes("never attach topic or lesson IDs to sentences or bullet points"),
    "Tutor prompt must forbid peppering sentences with topic/lesson IDs"
  );
});

test("sanitizeTutorText strips current lesson citations and normalizes punctuation spacing", () => {
  const currentLessonId = "87a4eb27-abdf-42bb-8cfa-63aa1a4b1b0f";
  const rawText =
    "Think of an English sentence [lesson:87a4eb27-abdf-42bb-8cfa-63aa1a4b1b0f] : each requires a subject pronoun [lesson:87a4eb27-abdf-42bb-8cfa-63aa1a4b1b0f] . Here is a note [note:owned-1] .";
  const allowed = new Set(["note:owned-1", `lesson:${currentLessonId}`]);

  const sanitized = sanitizeTutorText(rawText, allowed, 10000, currentLessonId);
  assert.strictEqual(
    sanitized.includes("[lesson:87a4eb27-abdf-42bb-8cfa-63aa1a4b1b0f]"),
    false,
    "Must strip current lesson ID citation"
  );
  assert.ok(sanitized.includes("[note:owned-1]"), "Must keep allowed note citation");
  assert.ok(sanitized.includes("English sentence:"), "Must clean dangling space before colon");
  assert.ok(sanitized.includes("subject pronoun."), "Must clean dangling space before period");
});

test("parseStructuredTutorReply preserves full explanation text up to 5000+ characters without cutting off", () => {
  const longExplanation = "## Deep dive\n\n" + "Detailed syntactic explanation. ".repeat(200) + "\n\n### Key Takeaway\nComplete.";
  assert.ok(longExplanation.length > 5000);
  const result = parseStructuredTutorReply("Explain", longExplanation, new Set());
  assert.strictEqual(result.structured, null);
  assert.ok(result.text.length >= 5000, "Must not truncate text below 5000 characters");
  assert.ok(result.text.includes("Key Takeaway"), "Must keep end takeaway without premature termination");
});

test("retrieveLearnerContext excludes corpus items belonging to a different course", async () => {
  const englishCourseId = "course-english-111";
  const pythonCourseId = "course-python-222";

  const mockQuery = async (sql) => {
    if (sql.includes("FROM notes")) {
      return {
        rows: [
          { id: "note-eng-1", course_id: englishCourseId, title: "English Pronouns", excerpt: "Subject pronouns include I, you, he, she." },
          { id: "note-py-1", course_id: pythonCourseId, title: "Python Variables", excerpt: "In Python, variables assign values with = operator." },
        ],
      };
    }
    if (sql.includes("FROM lessons l JOIN courses c")) {
      return {
        rows: [
          { id: "les-eng-1", course_id: englishCourseId, title: "Subject Pronouns and Basic Verbs", excerpt: "Form core English sentences.", course_title: "English Mastery" },
          { id: "les-py-1", course_id: pythonCourseId, title: "Python Operators and Expressions", excerpt: "Python operators include +, -, *.", course_title: "Python Foundations" },
        ],
      };
    }
    if (sql.includes("FROM practice_attempts")) {
      return {
        rows: [
          { id: "att-py-1", course_id: pythonCourseId, title: "Python Syntax Check", excerpt: "print('Hello world')", score: 85 },
        ],
      };
    }
    return { rows: [] };
  };

  const results = await retrieveLearnerContext("user-1", "Subject Pronouns and Basic Verbs", {
    courseId: englishCourseId,
    queryFn: mockQuery,
    deepRag: false,
  });

  const returnedIds = results.map((r) => r.id);
  assert.ok(returnedIds.includes("note:note-eng-1"), "Should include notes from the active English course");
  assert.ok(returnedIds.includes("lesson:les-eng-1"), "Should include lessons from the active English course");

  // Crucial assertion: Python items from another course must NOT leak into the English course tutor prompt
  assert.strictEqual(
    returnedIds.includes("note:note-py-1"),
    false,
    "Must NOT leak notes from a different course (Python note in English course)"
  );
  assert.strictEqual(
    returnedIds.includes("lesson:les-py-1"),
    false,
    "Must NOT leak lessons from a different course (Python lesson in English course)"
  );
  assert.strictEqual(
    returnedIds.includes("attempt:att-py-1"),
    false,
    "Must NOT leak attempts from a different course"
  );
});

test("scoreAndRankCandidates applies affinity boost to target course items over conflicting course items", () => {
  const queryAnalysis = analyzeQuery("Operators and Expressions");
  const candidates = [
    { id: "c2", course_id: "course-other", title: "Other Course Operators", content: "Different course operators." },
    { id: "c1", course_id: "course-target", title: "Target Operators", content: "Operators in this domain." },
  ];

  const ranked = scoreAndRankCandidates(candidates, queryAnalysis, null, null, {
    courseId: "course-target",
  });

  assert.equal(ranked[0].id, "c1", "Target course candidate must be ranked first");
  assert.ok(ranked[0].affinityBoost > ranked[1].affinityBoost, "Target course must have higher affinity boost than conflicting course");
});

test("readStoredDepths, writeStoredDepth, and clearStoredDepth persist in localStorage under learnos.lesson_depth.v1", () => {
  const { readStoredDepths, writeStoredDepth, clearStoredDepth, LESSON_DEPTH_STORAGE_KEY } = AppModule;
  const lessonId = "test-lesson-abc";

  // Initially empty
  assert.deepEqual(readStoredDepths(lessonId), {});

  // Store simpler explanation
  writeStoredDepth(lessonId, "simpler", "Simpler analogy content.");
  assert.strictEqual(readStoredDepths(lessonId).simpler, "Simpler analogy content.");

  // Store deep explanation without overwriting simpler
  writeStoredDepth(lessonId, "deep", "Deep dive breakdown content.");
  const read = readStoredDepths(lessonId);
  assert.strictEqual(read.simpler, "Simpler analogy content.");
  assert.strictEqual(read.deep, "Deep dive breakdown content.");

  // Verify localStorage key
  const raw = JSON.parse(globalThis.localStorage.getItem(LESSON_DEPTH_STORAGE_KEY));
  assert.strictEqual(raw[lessonId].simpler, "Simpler analogy content.");
  assert.strictEqual(raw[lessonId].deep, "Deep dive breakdown content.");

  // Clear one depth
  clearStoredDepth(lessonId, "simpler");
  const afterClear = readStoredDepths(lessonId);
  assert.strictEqual(afterClear.simpler, undefined);
  assert.strictEqual(afterClear.deep, "Deep dive breakdown content.");
});

test("LessonPage SSR renders explanation depth bar with buttons and proper ARIA states", () => {
  const { LessonPage } = AppModule;
  const sampleLesson = {
    id: "lesson-sample-1",
    title: "Subject Pronouns and Basic Verbs",
    objective: "Identify subjects and basic action verbs.",
    moduleTitle: "Module 1",
    content_markdown: "Standard lesson text explaining subjects and verbs.",
    checkpoint: {
      question: "Which word is a subject pronoun?",
      options: ["He", "Quickly", "Walk"],
      answerIndex: 0,
      explanation: "'He' is a subject pronoun.",
    },
  };

  const html = renderToStaticMarkup(
    React.createElement(LessonPage, {
      activeLesson: sampleLesson,
      lessons: [sampleLesson],
      activeCourse: { id: "course-sample", title: "Mastering English Tenses" },
      remote: true,
      go: () => {},
      openLesson: () => {},
      setActiveLessonId: () => {},
      submitCheckpoint: async () => ({ correct: true }),
      sendTutor: async () => ({ text: "Simpler explanation" }),
    })
  );

  assert.ok(html.includes("explanation-depth-bar"), "Must render explanation depth bar");
  assert.ok(html.includes("Standard"), "Must render Standard tab");
  assert.ok(html.includes("Simpler (with analogy)"), "Must render Simpler tab");
  assert.ok(html.includes("Deep dive"), "Must render Deep dive tab");
  assert.ok(html.includes('aria-pressed="true"'), "Active depth must carry aria-pressed true");
  assert.ok(html.includes("Standard lesson text explaining subjects and verbs."), "Renders standard content initially");
});
