import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildPath,
  getActiveNav,
  getPageTitle,
  getRouteContext,
  navigateTo,
  parseLocation,
  shouldInterceptNavClick,
} from "../src/router.js";

let vite;
let App;
const storage = new Map();

before(async () => {
  globalThis.localStorage = {
    getItem: (k) => storage.get(k) || null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  globalThis.sessionStorage = {
    getItem: (k) => storage.get(`s:${k}`) || null,
    setItem: (k, v) => storage.set(`s:${k}`, String(v)),
    removeItem: (k) => storage.delete(`s:${k}`),
  };
  vite = await createServer({ configFile: "./vite.config.js", logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  ({ default: App } = await vite.ssrLoadModule("/src/App.jsx"));
});

beforeEach(() => {
  storage.clear();
});

after(async () => {
  await vite?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.sessionStorage;
});

test("parseLocation handles clean History paths, dynamic params, queries, unknown routes, and legacy #/ hashes", () => {
  assert.equal(parseLocation({ pathname: "/", search: "", hash: "" }).page, "home");

  const courses = parseLocation({ pathname: "/courses", search: "", hash: "" });
  assert.equal(courses.page, "courses");

  const courseDetail = parseLocation({ pathname: "/courses/c-123/", search: "", hash: "" });
  assert.equal(courseDetail.page, "course");
  assert.equal(courseDetail.params.courseId, "c-123");

  const proposal = parseLocation({ pathname: "/courses/c-123/proposal", search: "", hash: "" });
  assert.equal(proposal.page, "proposal");
  assert.equal(proposal.params.courseId, "c-123");

  const lesson = parseLocation({ pathname: "/lessons/l-456", search: "", hash: "" });
  assert.equal(lesson.page, "lesson");
  assert.equal(lesson.params.lessonId, "l-456");

  const practiceLesson = parseLocation({ pathname: "/practice/l-789", search: "", hash: "" });
  assert.equal(practiceLesson.page, "practice");
  assert.equal(practiceLesson.params.lessonId, "l-789");

  const roomByQuery = parseLocation({ pathname: "/study-together", search: "?room=abcd2345", hash: "" });
  assert.equal(roomByQuery.page, "study-together");
  assert.equal(roomByQuery.params.roomCode, "ABCD2345");

  const roomByPath = parseLocation({ pathname: "/study-together/wxyz6789", search: "", hash: "" });
  assert.equal(roomByPath.page, "study-together");
  assert.equal(roomByPath.params.roomCode, "WXYZ6789");

  const reset = parseLocation({ pathname: "/reset-password", search: "?token=tok_abc", hash: "" });
  assert.equal(reset.page, "reset-password");
  assert.equal(reset.query.get("token"), "tok_abc");

  const legacy = parseLocation({ pathname: "/", search: "", hash: "#/verify?token=tok_legacy" });
  assert.equal(legacy.page, "verify");
  assert.equal(legacy.isLegacyHash, true);
  assert.equal(legacy.query.get("token"), "tok_legacy");

  const unknown = parseLocation({ pathname: "/nonexistent-route", search: "", hash: "" });
  assert.equal(unknown.page, "nonexistent-route");
});

test("buildPath generates canonical URLs and navigateTo uses History API cleanly with hash fallback", () => {
  assert.equal(buildPath("home"), "/");
  assert.equal(buildPath("courses"), "/courses");
  assert.equal(buildPath("course", { params: { courseId: "c-1" } }), "/courses/c-1");
  assert.equal(buildPath("proposal", { params: { courseId: "c-1" } }), "/courses/c-1/proposal");
  assert.equal(buildPath("lesson", { params: { lessonId: "l-2" } }), "/lessons/l-2");
  assert.equal(buildPath("practice", { params: { lessonId: "l-2" } }), "/practice/l-2");
  assert.equal(buildPath("study-together", { query: { room: "RM42" } }), "/study-together?room=RM42");

  const pushed = [];
  let scrolled = false;
  const mockWin = {
    location: { pathname: "/", search: "", hash: "" },
    document: { title: "" },
    history: {
      pushState: (state, _t, url) => pushed.push({ method: "pushState", state, url }),
      replaceState: (state, _t, url) => pushed.push({ method: "replaceState", state, url }),
    },
    scrollTo: () => { scrolled = true; },
  };
  const next = navigateTo("course", { params: { courseId: "c-1" }, win: mockWin });
  assert.equal(next, "/courses/c-1");
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].method, "pushState");
  assert.equal(pushed[0].url, "/courses/c-1");
  assert.equal(mockWin.document.title, getPageTitle("course"));
  assert.equal(scrolled, true);

  navigateTo("today", { replace: true, win: mockWin });
  assert.equal(pushed[1].method, "replaceState");
  assert.equal(pushed[1].url, "/today");

  // Minimal mock environment without History API falls back safely to hash
  const fallbackWin = { location: { pathname: "/", hash: "" } };
  navigateTo("notes", { win: fallbackWin });
  assert.equal(fallbackWin.location.hash, "/notes");

  assert.equal(shouldInterceptNavClick({ button: 0 }), true);
  assert.equal(shouldInterceptNavClick({ button: 1 }), false);
  assert.equal(shouldInterceptNavClick({ button: 0, metaKey: true }), false);
  assert.equal(shouldInterceptNavClick({ button: 0, ctrlKey: true }), false);
  assert.equal(shouldInterceptNavClick({ button: 0, defaultPrevented: true }), false);
});

test("App renders semantic anchor nav links with clean hrefs and hydrates deep-linked /courses/:id and /lessons/:id paths", () => {
  storage.set(
    "learnos.local.v2",
    JSON.stringify({
      courses: [
        { id: "c-alpha", title: "Alpha Course", status: "active", modules: [{ id: "m1", title: "Mod 1", objective: "Obj", lessons: [{ id: "l-alpha", title: "Alpha Lesson", objective: "Learn alpha" }] }] },
        { id: "c-beta", title: "Beta Course", status: "active", modules: [{ id: "m2", title: "Mod 2", objective: "Obj", lessons: [{ id: "l-beta", title: "Deep Linked Lesson", objective: "Learn beta" }] }] },
      ],
      activeCourseId: "c-alpha",
      goals: [],
      tasks: [],
      notes: [],
      flashcards: [],
      attempts: [],
      settings: {},
    })
  );

  globalThis.window = {
    location: { pathname: "/courses/c-beta", search: "", hash: "" },
    addEventListener() {},
    removeEventListener() {},
  };
  const courseHtml = renderToStaticMarkup(React.createElement(App));
  assert.ok(courseHtml.includes('href="/courses"'), "sidebar should render real anchor href links");
  assert.ok(courseHtml.includes('href="/today"'));
  assert.ok(courseHtml.includes("Beta Course"), "deep-linked /courses/:id must load target course directly");

  globalThis.window = {
    location: { pathname: "/lessons/l-beta", search: "", hash: "" },
    addEventListener() {},
    removeEventListener() {},
  };
  const lessonHtml = renderToStaticMarkup(React.createElement(App));
  assert.ok(lessonHtml.includes("Deep Linked Lesson"), "deep-linked /lessons/:id must load target lesson");

  globalThis.window = {
    location: { pathname: "/unknown-xyz", search: "", hash: "" },
    addEventListener() {},
    removeEventListener() {},
  };
  const unknownHtml = renderToStaticMarkup(React.createElement(App));
  assert.ok(unknownHtml.includes("This page is ready for your next course"));
});

test("sub-pages highlight parent sidebar section and render back button + breadcrumbs", () => {
  assert.equal(getActiveNav("course"), "courses");
  assert.equal(getActiveNav("lesson"), "courses");
  assert.equal(getActiveNav("proposal"), "courses");
  assert.equal(getActiveNav("goal"), "courses");
  assert.equal(getActiveNav("practice"), "practice");
  assert.equal(getActiveNav("settings"), null);

  const ctx = getRouteContext({
    page: "course",
    routeParams: { courseId: "c-beta" },
    activeCourse: { id: "c-beta", title: "Beta Course" },
  });
  assert.equal(ctx.back.page, "courses");
  assert.equal(ctx.back.label, "Back to My Courses");
  assert.deepEqual(
    ctx.breadcrumbs.map((b) => b.label),
    ["Home", "My Courses", "Beta Course"]
  );

  storage.set(
    "learnos.local.v2",
    JSON.stringify({
      courses: [
        {
          id: "c-beta",
          title: "Beta Course",
          status: "active",
          modules: [
            {
              id: "m2",
              title: "Mod 2",
              objective: "Obj",
              lessons: [{ id: "l-beta", title: "Deep Linked Lesson", objective: "Learn beta" }],
            },
          ],
        },
      ],
      activeCourseId: "c-beta",
      goals: [],
      tasks: [],
      notes: [],
      flashcards: [],
      attempts: [],
      settings: {},
    })
  );

  globalThis.window = {
    location: { pathname: "/courses/c-beta", search: "", hash: "" },
    addEventListener() {},
    removeEventListener() {},
  };
  const courseHtml = renderToStaticMarkup(React.createElement(App));
  assert.match(courseHtml, /href="\/courses"[^>]*class="nav-link active"/);
  assert.ok(courseHtml.includes('class="page-back-btn"'));
  assert.ok(courseHtml.includes("Back to My Courses"));
  assert.ok(courseHtml.includes('aria-label="Breadcrumb"'));
  assert.match(courseHtml, /class="page-breadcrumb-current"[^>]*>Beta Course<\/span>/);

  globalThis.window = {
    location: { pathname: "/lessons/l-beta", search: "", hash: "" },
    addEventListener() {},
    removeEventListener() {},
  };
  const lessonHtml = renderToStaticMarkup(React.createElement(App));
  assert.match(lessonHtml, /href="\/courses"[^>]*class="nav-link active"/);
  assert.ok(lessonHtml.includes("Back to Course roadmap"));
  assert.ok(lessonHtml.includes('href="/courses/c-beta"'));
  assert.match(lessonHtml, /class="page-breadcrumb-current"[^>]*>Deep Linked Lesson<\/span>/);
});

test("vercel.json provides SPA History API rewrite fallback while preserving /api/* and static files", async () => {
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const apiRewrite = vercel.rewrites.find((r) => r.source === "/api/(.*)" && r.destination === "/api/handler.js");
  const spaRewrite = vercel.rewrites.find((r) => r.destination === "/index.html");
  assert.ok(apiRewrite);
  assert.ok(spaRewrite, "vercel.json must include an SPA fallback rewrite to /index.html");
  assert.match(spaRewrite.source, /api/);
});
