import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  recordBehavior,
  getBehaviorEvents,
  getBehaviorAggregates,
  clearBehaviorData,
  calculateStreak,
  collectActiveDates,
  generateWeeklyRhythm,
  calculateLearnerMetrics,
  getLocalDateString
} from "../src/behavior-tracking.js";

let vite;
let App;
const localStorageValues = new Map();
const sessionStorageValues = new Map();

before(async () => {
  globalThis.localStorage = {
    getItem: key => localStorageValues.get(key) || null,
    setItem: (key, value) => localStorageValues.set(key, String(value)),
    removeItem: key => localStorageValues.delete(key),
  };
  globalThis.sessionStorage = {
    getItem: key => sessionStorageValues.get(key) || null,
    setItem: (key, value) => sessionStorageValues.set(key, String(value)),
    removeItem: key => sessionStorageValues.delete(key),
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
  clearBehaviorData();
});

after(async () => {
  await vite?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

function renderRoute(route = "") {
  globalThis.window = {
    location: { hash: route ? `#/${route}` : "", pathname: route ? `/${route}` : "/", search: "" },
    addEventListener() {},
    removeEventListener() {},
    history: { pushState() {}, replaceState() {} },
  };
  return renderToStaticMarkup(React.createElement(App));
}

test("behavior tracking records events and daily aggregates", () => {
  recordBehavior("page_view", { page: "practice" });
  recordBehavior("checkpoint_attempt", { concept: "Variables", score: 100 });
  recordBehavior("flashcard_review", { cardId: "f1", rating: "good" });
  recordBehavior("tutor_query", { mode: "explain" });

  const events = getBehaviorEvents();
  assert.equal(events.length, 4);
  assert.equal(events[0].type, "tutor_query");
  assert.equal(events[1].type, "flashcard_review");
  assert.equal(events[2].type, "checkpoint_attempt");
  assert.equal(events[3].type, "page_view");

  const todayStr = getLocalDateString();
  const agg = getBehaviorAggregates();
  assert.ok(agg[todayStr]);
  assert.equal(agg[todayStr].totalEvents, 4);
  assert.equal(agg[todayStr].pageViews, 1);
  assert.equal(agg[todayStr].checkpointAttempts, 1);
  assert.equal(agg[todayStr].flashcardReviews, 1);
  assert.equal(agg[todayStr].tutorQueries, 1);
  assert.ok(agg[todayStr].activeMinutes >= 8);
});

test("calculateStreak calculates active, pending, and broken streaks correctly", () => {
  const today = new Date();
  const todayStr = getLocalDateString(today.getTime());

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterday.getTime());

  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = getLocalDateString(twoDaysAgo.getTime());

  // 1. Empty set -> streak 0
  assert.deepEqual(calculateStreak(new Set()), { streakDays: 0, activeToday: false, status: "inactive" });

  // 2. Active today and yesterday and 2 days ago -> 3-day streak
  const streak3 = calculateStreak(new Set([todayStr, yesterdayStr, twoDaysAgoStr]));
  assert.equal(streak3.streakDays, 3);
  assert.equal(streak3.activeToday, true);
  assert.equal(streak3.status, "active");

  // 3. Active yesterday but not today -> 1-day pending streak
  const pendingStreak = calculateStreak(new Set([yesterdayStr]));
  assert.equal(pendingStreak.streakDays, 1);
  assert.equal(pendingStreak.activeToday, false);
  assert.equal(pendingStreak.status, "pending_today");

  // 4. Broken streak (active 3 days ago, but not today or yesterday)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const brokenStreak = calculateStreak(new Set([getLocalDateString(threeDaysAgo.getTime())]));
  assert.equal(brokenStreak.streakDays, 0);
  assert.equal(brokenStreak.status, "broken");
});

test("calculateLearnerMetrics combines workspace data with telemetry for rich progress parameters", () => {
  const mockWorkspace = {
    attempts: [
      { id: "a1", concept: "Basic Syntax", score: 100, created_at: new Date().toISOString() },
      { id: "a2", concept: "Variables", score: 80, created_at: new Date().toISOString() },
      { id: "a3", concept: "Loops", score: 40, created_at: new Date().toISOString() },
    ],
    tasks: [
      { id: "t1", status: "completed", completed_at: new Date().toISOString() },
      { id: "t2", status: "pending", scheduled_at: new Date().toISOString() },
    ],
    flashcards: [
      { id: "f1", front: "Q1", back: "A1", repetitions: 4, interval_days: 10 },
      { id: "f2", front: "Q2", back: "A2", repetitions: 1, interval_days: 1 },
      { id: "f3", front: "Q3", back: "A3", repetitions: 0, interval_days: 0 },
    ],
    notes: [
      { id: "n1", title: "Python intro", updated_at: new Date().toISOString() },
    ],
    courses: [{ id: "c1", title: "Python" }],
  };

  recordBehavior("flashcard_review", { rating: "good" });
  recordBehavior("flashcard_review", { rating: "easy" });
  recordBehavior("flashcard_review", { rating: "again" });
  recordBehavior("tutor_query", { mode: "explain" });
  recordBehavior("tutor_query", { mode: "quiz" });

  const metrics = calculateLearnerMetrics(mockWorkspace, { weeklyMinutes: 120 });

  assert.equal(metrics.streak.activeToday, true);
  assert.equal(metrics.streak.streakDays, 1);
  assert.equal(metrics.practice.totalAttempts, 3);
  assert.equal(metrics.practice.passedAttempts, 2);
  assert.equal(metrics.practice.passRate, 67);
  assert.equal(metrics.practice.masteredConceptsCount, 2);
  assert.equal(metrics.retention.totalCardReviews, 3);
  assert.equal(metrics.retention.retentionRate, 67);
  assert.equal(metrics.retention.masteredCards, 1);
  assert.equal(metrics.retention.learningCards, 1);
  assert.equal(metrics.tutor.totalInteractions, 2);
  assert.equal(metrics.tutor.modeCounts.explain, 1);
  assert.equal(metrics.tutor.modeCounts.quiz, 1);
  assert.equal(metrics.studyTime.weeklyGoalMinutes, 120);
  assert.ok(metrics.studyTime.weeklyMinutesSpent > 0);
  assert.equal(metrics.rhythm.length, 7);
});

test("first-run empty progress route renders renamed card, KPIs, and empty evidence without mock data", () => {
  const html = renderRoute("progress");

  // 1. Renamed card heading is present, old heading is gone
  assert.ok(
    html.includes("Concept Mastery &amp; Practice Activity") || html.includes("Concept Mastery & Practice Activity"),
    "Missing renamed card header"
  );
  assert.ok(!html.includes("Understanding evidence"), "Old 'Understanding evidence' header should be replaced");

  // 2. Behavioral KPI cards are present
  assert.ok(html.includes("DAILY STREAK"));
  assert.ok(html.includes("WEEKLY COMMITMENT"));
  assert.ok(html.includes("RETENTION RATE"));
  assert.ok(html.includes("PRACTICE ACCURACY"));

  // 3. 7-Day Rhythm and Retention panels are present
  assert.ok(html.includes("7-Day Learning Rhythm"));
  assert.ok(
    html.includes("Memory &amp; Review Progress") ||
    html.includes("Memory & Review Progress") ||
    html.includes("Retention &amp; Knowledge Synthesis") ||
    html.includes("Retention & Knowledge Synthesis")
  );

  // 4. Preserves backward-compatible empty assertions
  assert.match(html, /0 of 0 sessions done/);
  assert.match(html, /<strong>0<\/strong><span>checkpoint passes<\/span>/);
  assert.match(html, /Your checkpoint and practice evidence will appear here/);
});

test("progress route with 7 practice attempts renders paginated list with page size 5", () => {
  // Pre-seed workspace with 7 attempts (similar to user's screenshot)
  const attempts = [
    { id: "a1", concept: "Basic Operators and Expressions", score: 100, created_at: "2026-11-12T12:00:00Z" },
    { id: "a2", concept: "Basic Operators and Expressions", score: 100, created_at: "2026-11-12T12:05:00Z" },
    { id: "a3", concept: "Variables and Data Types", score: 100, created_at: "2026-11-12T12:10:00Z" },
    { id: "a4", concept: "Variables and Data Types", score: 100, created_at: "2026-11-12T12:15:00Z" },
    { id: "a5", concept: "Variables and Data Types", score: 100, created_at: "2026-11-12T12:20:00Z" },
    { id: "a6", concept: "What is Python and Why Use It?", score: 100, created_at: "2026-11-12T12:25:00Z" },
    { id: "a7", concept: "What is Python and Why Use It?", score: 100, created_at: "2026-11-12T12:30:00Z" },
  ];

  localStorageValues.set("learnos.local.v2", JSON.stringify({
    courses: [{ id: "c-py", title: "Python Foundations", status: "active", modules: [] }],
    activeCourseId: "c-py",
    goals: [],
    tasks: [],
    notes: [],
    flashcards: [],
    attempts,
    settings: { fullName: "Learner", weeklyMinutes: 180 },
  }));

  const html = renderRoute("progress");

  // Summary header metrics
  assert.ok(
    html.includes("Concept Mastery &amp; Practice Activity") || html.includes("Concept Mastery & Practice Activity"),
    "Missing Concept Mastery & Practice Activity heading"
  );
  assert.match(html, /<strong>7<\/strong><span>checkpoint passes<\/span>/);
  assert.match(html, /<strong>3<\/strong><span>concepts mastered<\/span>/);
  assert.match(html, /<strong>7<\/strong><span>attempts recorded<\/span>/);

  // Pagination controls
  assert.ok(html.includes("Showing 1–5 of 7 attempts"), "Expected pagination range showing 1-5 of 7");
  assert.ok(html.includes("Page 1 of 2"), "Expected Page 1 of 2 indicator");
  assert.ok(html.includes("Previous"), "Expected Previous button");
  assert.ok(html.includes("Next"), "Expected Next button");

  // Filter pills
  assert.ok(html.includes("All (7)"));
  assert.ok(html.includes("Passed (7)"));
  assert.ok(html.includes("Needs review (0)"));
});
