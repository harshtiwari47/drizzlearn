import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generatePlan } from "../server/ai.js";
import { deleteUserAccount } from "../server/http.js";

let vite;
let App;
const localStorageValues = new Map();
const sessionStorageValues = new Map();

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
  vite = await createServer({
    configFile: "./vite.config.js",
    logLevel: "silent",
    server: { middlewareMode: true },
    appType: "custom",
  });
  ({ default: App } = await vite.ssrLoadModule("/src/App.jsx"));
});

beforeEach(() => {
  localStorageValues.clear();
  sessionStorageValues.clear();
});

after(async () => {
  await vite?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

function renderRoute(route = "") {
  globalThis.window = {
    location: { hash: route ? `#/${route}` : "" },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
  };
  return renderToStaticMarkup(React.createElement(App));
}

test("course prompt construction in server/ai.js incorporates backward design, faded scaffolding, and worked examples", async () => {
  const goal = {
    topic: "Full-Stack Development",
    desired_outcome: "Build and deploy a full-stack web application.",
    current_level: "Beginner",
    purpose: "Career transition",
    weekly_minutes: 240,
    target_weeks: 6,
    target_date: null,
  };

  const keys = ["NVIDIA_API_KEY", "NVIDIA_BASE_URL", "NVIDIA_MODEL"];
  const prior = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.NVIDIA_API_KEY = "test-ai-key";
  process.env.NVIDIA_BASE_URL = "https://nvidia.mock.test/v1";
  process.env.NVIDIA_MODEL = "test-model";

  const originalFetch = globalThis.fetch;
  const capturedRequests = [];

  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    capturedRequests.push({ url, options, body });
    const system = body.messages[0].content;

    if (system.includes("curriculum and prerequisite planner")) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              title: "Full-Stack Development",
              summary: goal.desired_outcome,
              durationWeeks: 6,
              assumptions: ["Basic programming familiarity"],
              modules: [
                {
                  position: 1,
                  title: "Frontend Foundations",
                  objective: "Build responsive user interfaces",
                  rationale: "Core UI concepts",
                  prerequisites: [],
                  lessons: [{ position: 1, title: "Component Architecture", objective: "Create composable components", prerequisites: [] }],
                },
                {
                  position: 2,
                  title: "Backend API",
                  objective: "Build RESTful APIs",
                  rationale: "Data persistence and endpoints",
                  prerequisites: [1],
                  lessons: [{ position: 1, title: "Route Handlers", objective: "Implement HTTP route handlers", prerequisites: ["Component Architecture"] }],
                },
                {
                  position: 3,
                  title: "Full Stack Deployment",
                  objective: "Deploy full stack app to production",
                  rationale: "Terminal practical outcome",
                  prerequisites: [2],
                  lessons: [{ position: 1, title: "Production Deployment", objective: "Deploy and monitor web application", prerequisites: ["Route Handlers"] }],
                },
              ],
            }),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (system.includes("lesson-content designer")) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              lessons: [
                {
                  modulePosition: 1, lessonPosition: 1,
                  content: "Understand component composition through clean separation of concerns and pure functions.",
                  workedExample: "Step 1: Define state. Step 2: Render pure markup based on props. Step 3: Verify outputs.",
                  estimatedMinutes: 25,
                },
                {
                  modulePosition: 2, lessonPosition: 1,
                  content: "Structure request handlers to validate inputs, process models, and return appropriate HTTP status codes.",
                  workedExample: "Step 1: Parse request body. Step 2: Validate fields with schema. Step 3: Return 201 Created.",
                  estimatedMinutes: 30,
                },
                {
                  modulePosition: 3, lessonPosition: 1,
                  content: "Configure deployment pipelines, environment secrets, and verify uptime health checks.",
                  workedExample: "Step 1: Set environment variables. Step 2: Run production build. Step 3: Inspect deployment URL.",
                  estimatedMinutes: 35,
                },
              ],
            }),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    if (system.includes("assessment designer")) {
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              checkpoints: [
                {
                  modulePosition: 1, lessonPosition: 1,
                  question: "Why should components remain pure with respect to their props?",
                  options: ["To prevent unpredictable side effects and ensure predictable rendering", "To make them load slower", "To prevent typing"],
                  answerIndex: 0,
                  explanation: "Pure components only rely on their inputs, making rendering deterministic and testing straightforward.",
                },
                {
                  modulePosition: 2, lessonPosition: 1,
                  question: "What status code should a successful resource creation return?",
                  options: ["201 Created", "404 Not Found", "500 Internal Error"],
                  answerIndex: 0,
                  explanation: "201 Created indicates the requested resource was created successfully on the server.",
                },
                {
                  modulePosition: 3, lessonPosition: 1,
                  question: "Where should sensitive production database credentials be stored?",
                  options: ["Encrypted server environment variables", "Client bundle code", "Public HTML comments"],
                  answerIndex: 0,
                  explanation: "Production credentials must remain in secure server environment variables to prevent credential exposure.",
                },
              ],
            }),
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }

    throw new Error("Unexpected system prompt: " + system);
  };

  try {
    const plan = await generatePlan(goal);
    assert.equal(plan.title, "Full-Stack Development");
    assert.equal(plan.modules.length, 3);
    assert.equal(capturedRequests.length, 3);

    const curriculumPrompt = capturedRequests[0].body.messages[0].content;
    assert.match(curriculumPrompt, /Backward Design/i, "Curriculum prompt must specify Backward Design");
    assert.match(curriculumPrompt, /terminal practical outcome/i, "Curriculum prompt must start from terminal practical outcome");
    assert.match(curriculumPrompt, /backward progression/i, "Curriculum prompt must order in backward progression");
    assert.match(curriculumPrompt, /explicit prerequisites/i, "Curriculum prompt must require explicit prerequisites");

    const lessonPrompt = capturedRequests[1].body.messages[0].content;
    assert.match(lessonPrompt, /Faded Scaffolding/i, "Lesson prompt must enforce Faded Scaffolding");
    assert.match(lessonPrompt, /mental model/i, "Lesson prompt must require clear mental model");
    assert.match(lessonPrompt, /worked example/i, "Lesson prompt must require worked examples");
    assert.match(lessonPrompt, /reasoning/i, "Lesson prompt must require explicit reasoning in worked examples");
    assert.match(lessonPrompt, /pitfalls|anti-patterns/i, "Lesson prompt must require common pitfalls or anti-patterns");

    const assessmentPrompt = capturedRequests[2].body.messages[0].content;
    assert.match(assessmentPrompt, /applied reasoning/i, "Assessment prompt must focus on applied reasoning");
    assert.match(assessmentPrompt, /explanation/i, "Assessment prompt must require teaching explanations");
  } finally {
    globalThis.fetch = originalFetch;
    for (const k of keys) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
});

test("explanation depth controls (Standard, Simpler, Deep dive) render properly in LessonPage", () => {
  const customWorkspace = {
    courses: [{
      id: "course-depth-1",
      title: "Interactive Systems",
      status: "active",
      modules: [{
        id: "mod-1",
        title: "Event Loops",
        objective: "Understand asynchronous event loops",
        lessons: [{
          id: "lesson-depth-1",
          title: "Microtasks and Macrotasks",
          objective: "Differentiate between microtask queues and macrotask queues.",
          content_markdown: "The event loop coordinates asynchronous execution. Microtasks run before macrotasks.",
          worked_example: "Step 1: Promise.resolve queues a microtask. Step 2: setTimeout queues a macrotask.",
          checkpoint: {
            question: "Which executes first after the synchronous call stack empties?",
            options: ["Microtasks (Promise callbacks)", "Macrotasks (setTimeout callbacks)"],
            answerIndex: 0,
            explanation: "The microtask queue is completely drained before the next macrotask is dequeued.",
          },
          estimated_minutes: 20,
        }],
      }],
    }],
    activeCourseId: "course-depth-1",
    tasks: [{
      id: "task-depth-1",
      course_id: "course-depth-1",
      lesson_id: "lesson-depth-1",
      status: "upcoming",
      scheduled_at: new Date().toISOString(),
    }],
    goals: [],
    notes: [],
    flashcards: [],
    attempts: [],
    settings: { fullName: "Learner Test" },
  };

  localStorageValues.set("learnos.local.v2", JSON.stringify(customWorkspace));

  const html = renderRoute("lesson");

  // Verify the page renders the lesson
  assert.match(html, /Microtasks and Macrotasks/);
  assert.match(html, /Differentiate between microtask queues/);

  // Verify Explanation depth toolbar and controls
  assert.match(html, /aria-label="Explanation depth"/, "Depth controls container should have accessible label");
  assert.match(html, />Standard<\/button>/, "Standard depth option must be present");
  assert.match(html, />Simpler \(with analogy\)<\/button>/, "Simpler with analogy depth option must be present");
  assert.match(html, />Deep dive<\/button>/, "Deep dive depth option must be present");

  // Verify worked example is rendered
  assert.match(html, /Worked example/);
  assert.match(html, /Promise\.resolve queues a microtask/);

  // Verify checkpoint understanding check
  assert.match(html, /CHECK YOUR UNDERSTANDING/);
  assert.match(html, /Which executes first after the synchronous call stack empties\?/);
});

test("dashboard roadmap dynamically marks the active module based on pending tasks instead of hardcoding module 0", () => {
  const customWorkspace = {
    courses: [{
      id: "course-road-1",
      title: "Distributed Architectures",
      status: "active",
      modules: [
        {
          id: "mod-1",
          title: "Consensus Algorithms",
          objective: "Raft and Paxos fundamentals",
          lessons: [{ id: "l-1", title: "Leader Election" }],
        },
        {
          id: "mod-2",
          title: "Replication Logs",
          objective: "State machine log replication",
          lessons: [{ id: "l-2", title: "Log Entries & Commit Index" }],
        },
        {
          id: "mod-3",
          title: "Cluster Recovery",
          objective: "Handling node partitions and partitions recovery",
          lessons: [{ id: "l-3", title: "Split Brain Prevention" }],
        },
      ],
    }],
    activeCourseId: "course-road-1",
    tasks: [
      { id: "task-1", course_id: "course-road-1", lesson_id: "l-1", status: "completed" },
      { id: "task-2", course_id: "course-road-1", lesson_id: "l-2", status: "upcoming", scheduled_at: new Date().toISOString() },
      { id: "task-3", course_id: "course-road-1", lesson_id: "l-3", status: "upcoming", scheduled_at: new Date().toISOString() },
    ],
    attempts: [
      { id: "att-1", lesson_id: "l-1", score: 100 },
    ],
    goals: [],
    notes: [],
    flashcards: [],
    settings: { fullName: "Learner Test" },
  };

  localStorageValues.set("learnos.local.v2", JSON.stringify(customWorkspace));

  const html = renderRoute("home");

  // Module 1 is complete because task-1 is completed and attempt passed
  assert.match(html, /class="module grid items-center gap-2\.5\s+complete"/, "Module 1 must be marked complete");
  assert.match(html, />1\.\s+Consensus Algorithms<\/strong>/);

  // Module 2 is active because task-2 is the earliest incomplete task
  assert.match(html, /class="module grid items-center gap-2\.5\s+active\s*"/, "Module 2 must be dynamically marked active");
  assert.match(html, />2\.\s+Replication Logs<\/strong>/);

  // Module 1 action should show checkmark; Module 2 action should show play indicator
  assert.match(html, /aria-label="Open Consensus Algorithms"[^>]*>✓<\/button>/);
  assert.match(html, /aria-label="Open Replication Logs"[^>]*>▶<\/button>/);
});

test("flashcard source lesson link renders when a lesson is attached", () => {
  const customWorkspace = {
    courses: [{
      id: "course-fc-1",
      title: "Data Structures",
      status: "active",
      modules: [{
        id: "mod-fc-1",
        title: "Tree Structures",
        lessons: [{ id: "l-tree-1", title: "B-Trees & Indexing" }],
      }],
    }],
    activeCourseId: "course-fc-1",
    tasks: [],
    goals: [],
    notes: [],
    flashcards: [
      {
        id: "card-with-lesson",
        front: "What is the branching factor of a B-tree?",
        back: "The maximum number of children a node can have.",
        lesson_id: "l-tree-1",
        lesson_title: "B-Trees & Indexing",
        course_id: "course-fc-1",
        due_at: new Date(Date.now() - 100000).toISOString(),
      },
    ],
    attempts: [],
    settings: { fullName: "Learner Test" },
  };

  localStorageValues.set("learnos.local.v2", JSON.stringify(customWorkspace));

  const html = renderRoute("flashcards");

  // First due card is card-with-lesson
  assert.match(html, /What is the branching factor of a B-tree\?/);
  assert.match(html, /class="flashcard-source-link/, "Source link container should be present");
  assert.match(html, /Review lesson:/);
  assert.match(html, /B-Trees &amp; Indexing|B-Trees & Indexing/);
});

test("schedule rebalance action and account deletion endpoint/settings button exist and function properly", async (t) => {
  await t.test("TodayPage displays schedule rebalance banner when overdue tasks exist", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const customWorkspace = {
      courses: [{
        id: "course-reb-1",
        title: "Compiler Design",
        status: "active",
        modules: [{
          id: "m-1",
          title: "Parsing",
          lessons: [{ id: "l-parse", title: "LL(1) Parsers" }],
        }],
      }],
      activeCourseId: "course-reb-1",
      tasks: [
        {
          id: "task-overdue-1",
          course_id: "course-reb-1",
          lesson_id: "l-parse",
          title: "Parse tables",
          status: "upcoming",
          scheduled_at: yesterday,
          estimated_minutes: 30,
        },
      ],
      goals: [],
      notes: [],
      flashcards: [],
      attempts: [],
      settings: { fullName: "Learner Test", preferredStudyDays: [1, 3, 5], weeklyMinutes: 180 },
    };

    localStorageValues.set("learnos.local.v2", JSON.stringify(customWorkspace));
    const html = renderRoute("today");

    // Rebalance banner and button should render
    assert.match(html, /rebalance-notice/, "Rebalance notice container should render");
    assert.match(html, /overdue or missed session/);
    assert.match(html, />Rebalance schedule [↻↗]<\/button>/);
  });

  await t.test("TodayPage hides schedule rebalance banner when no overdue tasks exist", () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const customWorkspace = {
      courses: [{
        id: "course-reb-2",
        title: "Compiler Design",
        status: "active",
        modules: [{
          id: "m-2",
          title: "Parsing",
          lessons: [{ id: "l-parse-2", title: "LL(1) Parsers" }],
        }],
      }],
      activeCourseId: "course-reb-2",
      tasks: [
        {
          id: "task-upcoming-1",
          course_id: "course-reb-2",
          lesson_id: "l-parse-2",
          title: "Parse tables",
          status: "upcoming",
          scheduled_at: tomorrow,
          estimated_minutes: 30,
        },
      ],
      goals: [],
      notes: [],
      flashcards: [],
      attempts: [],
      settings: { fullName: "Learner Test" },
    };

    localStorageValues.set("learnos.local.v2", JSON.stringify(customWorkspace));
    const html = renderRoute("today");

    assert.ok(!html.includes("rebalance-notice"), "Rebalance notice should not appear when no tasks are overdue");
  });

  await t.test("SettingsPage displays danger zone and delete account button", () => {
    const customWorkspace = {
      courses: [],
      goals: [],
      notes: [],
      flashcards: [],
      tasks: [],
      attempts: [],
      settings: { fullName: "Test Learner" },
    };

    localStorageValues.set("learnos.local.v2", JSON.stringify(customWorkspace));
    const html = renderRoute("settings");

    assert.match(html, /Permanently delete your account/);
    assert.match(html, /class="quiet-btn danger text-xs self-start"[^>]*>Delete account<\/button>/);
  });

  await t.test("deleteUserAccount helper validates password and performs account deletion", async () => {
    let deletedUserId = null;
    const mockQuery = async (sql, params) => {
      if (sql.includes("SELECT password_hash FROM users")) {
        return { rows: [{ password_hash: "hashed_correct_password" }] };
      }
      if (sql.includes("DELETE FROM users WHERE id=$1")) {
        deletedUserId = params[0];
        return { rowCount: 1 };
      }
      return { rows: [] };
    };

    const mockBcrypt = {
      compare: async (plain, hashed) => plain === "correct_password" && hashed === "hashed_correct_password",
    };

    // Test incorrect password
    let failedStatus = null;
    let failedCode = null;
    const resFail = {
      setHeader() {},
      statusCode: 200,
      end() {},
    };
    await deleteUserAccount({
      userId: "user-123",
      password: "wrong_password",
      query: mockQuery,
      bcrypt: mockBcrypt,
      sendJson: () => {},
      sendError: (_res, status, code) => {
        failedStatus = status;
        failedCode = code;
      },
      clearSessionCookie: () => "learnos_session=; Max-Age=0",
      res: resFail,
    });
    assert.equal(failedStatus, 401);
    assert.equal(failedCode, "INVALID_CREDENTIALS");
    assert.equal(deletedUserId, null);

    // Test correct password
    let successStatus = null;
    let successData = null;
    let setHeaders = null;
    const resSuccess = {
      setHeader() {},
      statusCode: 200,
      end() {},
    };
    await deleteUserAccount({
      userId: "user-123",
      password: "correct_password",
      query: mockQuery,
      bcrypt: mockBcrypt,
      sendJson: (_res, status, data, headers) => {
        successStatus = status;
        successData = data;
        setHeaders = headers;
      },
      sendError: () => {},
      clearSessionCookie: () => "learnos_session=; Max-Age=0",
      res: resSuccess,
    });
    assert.equal(successStatus, 200);
    assert.deepEqual(successData, { deleted: true });
    assert.equal(deletedUserId, "user-123");
    assert.match(setHeaders["Set-Cookie"], /learnos_session=; Max-Age=0/);
  });
});
