import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let vite;
let App;
let Modal;
const localStorageValues=new Map();
const sessionStorageValues=new Map();

before(async () => {
  globalThis.localStorage = { getItem:key=>localStorageValues.get(key)||null, setItem:(key,value)=>localStorageValues.set(key,String(value)), removeItem:key=>localStorageValues.delete(key) };
  globalThis.sessionStorage = { getItem:key=>sessionStorageValues.get(key)||null, setItem:(key,value)=>sessionStorageValues.set(key,String(value)), removeItem:key=>sessionStorageValues.delete(key) };
  vite = await createServer({ configFile: "./vite.config.js", logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  ({ default: App, Modal } = await vite.ssrLoadModule("/src/App.jsx"));
});

beforeEach(()=>{localStorageValues.clear();sessionStorageValues.clear();});

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
  };
  return renderToStaticMarkup(React.createElement(App));
}

test("first-run home keeps the demo navigation and visual structure without invented learner data", () => {
  const html = renderRoute();
  for (const label of ["Home", "My Courses", "Today’s Plan", "Study Together", "Notes", "Flashcards", "Practice", "Progress", "AI Tutor", "More study tools"]) {
    assert.ok(html.includes(`aria-label="${label}"`), `missing accessible sidebar label ${label}`);
  }
  assert.match(html,/aria-label="Sign in" title="Sign in to your account">\?\s*<\/button>/);
  assert.match(html, /What do you want to/);
  assert.match(html, /Create learning goal/);
  assert.match(html, /Current course/);
  assert.match(html, /Learning roadmap/);
  assert.match(html, /<svg[^>]+aria-hidden="true"/);
  for(const fictional of ["Harsh Tiwari","Machine Learning","Train/test split","Project checklist","Sample profile","Sample workspace"]){
    assert.ok(!html.includes(fictional),`first-run home must not show fictional learner data: ${fictional}`);
  }
});

test("workspace routes render meaningful first-run states and maintain the shared page shell", async (t) => {
  const routes = [
    ["courses", "My Courses", "No courses yet"],
    ["today", "Today’s plan", "No study sessions yet"],
    ["study-together", "Study Together", "Loading your rooms…"],
    ["notes", "Notes", "No notes saved yet"],
    ["flashcards", "Flashcards", "No cards due right now"],
    ["practice", "Practice", "Choose a lesson first"],
    ["progress", "Your progress", "0 of 0 sessions done"],
    ["tutor", "AI Tutor", "Connect an account to use AI Tutor"],
    ["settings", "Settings", "Learner profile"],
    ["goal", "Build a learning plan", "Your learning goal"],
    ["proposal", "Your course proposal", "No proposal to review"],
    ["course", "Course roadmap", "No active course yet"],
    ["lesson", "Lesson", "Choose a lesson to begin"],
    ["search", "Search results", "No matching learning material"],
    ["verify", "Verify your email", "Checking your verification link…"],
    ["reset-password", "Choose a new password", "Confirm password"],
    ["verified", "Email verified", "Your email is verified"],
  ];
  for (const [route, heading, content] of routes) {
    await t.test(route, () => {
      const html = renderRoute(route);
      assert.ok(html.includes(heading), `expected heading/content '${heading}'`);
      assert.ok(html.includes(content), `expected route content '${content}'`);
      assert.ok(html.includes('class="workspace-page"'), "workspace layout should be present");
    });
  }
});

test("empty first-run notes, cards, progress, profile, and tutor do not contain seed records", () => {
  const notes = renderRoute("notes");
  assert.match(notes,/No notes saved yet/);
  assert.match(notes,/Choose a note to edit/);

  const cards=renderRoute("flashcards");
  assert.match(cards,/No cards due right now/);
  assert.match(cards,/0<span> cards saved/);

  const progress=renderRoute("progress");
  assert.match(progress,/0 of 0 sessions done/);
  assert.match(progress,/<strong>0<\/strong><span>checkpoint passes<\/span>/);
  assert.match(progress,/Your checkpoint and practice evidence will appear here/);

  const settings=renderRoute("settings");
  assert.match(settings,/aria-label="Sign in" title="Sign in to your account">\?\s*<\/button>/);
  assert.match(settings,/placeholder="Your name"/);
  assert.doesNotMatch(settings,/Harsh Tiwari|Sample profile|value="Harsh"/);

  const tutor=renderRoute("tutor");
  assert.match(tutor,/Connect an account to use AI Tutor/);
  assert.doesNotMatch(tutor,/Think of a train\/test split|Hold the test set aside\./);
  assert.doesNotMatch(tutor,/Sample Learner|Harsh Tiwari/);

  for(const html of [notes,cards,progress,settings,tutor]){
    assert.doesNotMatch(html,/Train\/test split|Useful baseline questions|Data leakage reminders|Classifier evaluation|My first baseline|Project checklist/);
  }
});

test("Study Together exposes loading, failure/retry, and empty-room states", async () => {
  const html=renderRoute("study-together");
  assert.match(html,/Recent rooms/);
  assert.match(html,/Loading your rooms…/);
  assert.doesNotMatch(html,/Your rooms will show up here/);
  const app=await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
  assert.match(app,/roomsLoading\?/);
  assert.match(app,/roomsLoadError\?/);
  assert.match(app,/role="alert"/);
  assert.match(app,/Try again ↻/);
  assert.match(app,/rooms\.length\?/);
  assert.match(app,/Your rooms will show up here/);
  assert.match(html,/Create a room/);
  assert.match(html,/Join a room/);
  assert.match(html,/8 character code/);
});

test("legacy sample data is removed while learner-created notes and cards survive", () => {
  const past=new Date(Date.now()-86400000).toISOString();
  localStorageValues.set("learnos.sample.v1",JSON.stringify({
    courses:[{id:"sample-course",title:"Machine Learning",status:"active",modules:[]},{id:"learner-course",title:"My own course",status:"active",modules:[]}],
    activeCourseId:"sample-course",
    goals:[{id:"sample-goal",topic:"Machine Learning"},{id:"learner-goal",topic:"My own goal"}],
    tasks:[{id:"task-done-1",course_id:"sample-course",status:"completed"},{id:"learner-task",course_id:"learner-course",status:"upcoming"}],
    notes:[{id:"n1",title:"Legacy sample note",body:"This was bundled sample content."},{id:"learner-note",title:"My own note",body:"Saved learner writing."}],
    flashcards:[{id:"f1",front:"Legacy sample prompt",back:"Bundled sample answer",due_at:past},{id:"learner-card",front:"My own recall question",back:"My own answer",due_at:past}],
    attempts:[{id:"sample-attempt-1",concept:"Sample concept"},{id:"learner-attempt",concept:"My own concept"}],
    settings:{fullName:"Harsh Tiwari"},
  }));

  const notes=renderRoute("notes");
  assert.match(notes,/My own note/);
  assert.doesNotMatch(notes,/Legacy sample note|Machine Learning|Harsh Tiwari/);
  const cards=renderRoute("flashcards");
  assert.match(cards,/My own recall question/);
  assert.doesNotMatch(cards,/Legacy sample prompt|Bundled sample answer/);
  const migrated=JSON.parse(localStorageValues.get("learnos.local.v2"));
  assert.equal(localStorageValues.has("learnos.sample.v1"),false);
  assert.deepEqual(migrated.courses.map(course=>course.id),["learner-course"]);
  assert.deepEqual(migrated.notes.map(note=>note.id),["learner-note"]);
  assert.deepEqual(migrated.flashcards.map(card=>card.id),["learner-card"]);
  assert.deepEqual(migrated.attempts.map(attempt=>attempt.id),["learner-attempt"]);
  assert.deepEqual(migrated.tasks.map(task=>task.id),["learner-task"]);
  assert.deepEqual(migrated.goals.map(goal=>goal.id),["learner-goal"]);
  assert.equal(migrated.settings.fullName,"");
});

test("screenshot regressions stay fixed in the stylesheet", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.nav-icon \{[^}]*padding: 0; border: 0;[^}]*background: transparent; box-shadow: none/s);
  assert.match(css, /\.nav-icon svg \{ display: block; width: 19px; height: 19px; \}/);
  assert.match(css, /\.today-layout \{ grid-template-columns:minmax\(0,1\.35fr\) minmax\(235px,\.75fr\); \}/);
  assert.match(css, /select \{ appearance:none; color-scheme:dark;/);
  assert.match(css, /select option \{ color:#f2eef9; background:#171827; \}/);
  assert.match(css, /\.note-title-input:focus-visible,\.note-body-input:focus-visible \{ outline:2px solid #c5a8ff;/);
  assert.match(css, /\.sidebar \{\s*overflow-x: hidden;\s*overflow-y: auto;/);
  assert.match(css, /\.nav-link:focus-visible,\s*\.primary-btn:focus-visible,\s*\.quiet-btn:focus-visible \{\s*outline: 2px solid #c5a8ff;/);
  assert.match(css, /@media \(min-width: 621px\) and \(max-height: 760px\)/);
  assert.match(css, /@media \(min-width: 621px\) and \(max-height: 620px\)/);
  assert.match(css, /\.app-footer \{ min-width: 0; \}/);
  assert.match(css, /\.app-footer \{ flex-wrap:wrap;gap:8px;/);
  assert.match(css, /\.mobile-more-menu \{\s*display: grid;\s*position: fixed;/);
  assert.match(css, /\.mobile-more-menu \.nav-icon \{ display:grid; \}/);
  assert.match(css, /\.study-room-layout \{ display: grid;/);
  assert.match(css, /\.pomodoro-progress \{ --timer-progress:0%;/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /\.study-room-heading h2 \{ overflow-wrap:anywhere; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.quiet-btn \{\s*width: auto;\s*min-width: 34px;\s*height: auto;\s*min-height: 36px;\s*padding: 8px 14px;/);
  assert.match(css, /\.quiet-btn\.compact \{\s*min-height: 32px;\s*padding: 6px 11px;/);
  assert.match(css, /\.sidebar-nav-scroll \{\s*flex: 1 1 0%;\s*min-height: 0;\s*overflow-x: hidden;\s*overflow-y: auto;/);
  assert.match(css, /\.tutor-card::after[^{]*\{\s*display: none !important;/);
  const home=renderRoute();
  assert.match(home,/class="brand-name">Drizzlearn<\/div>/);
  assert.match(home,/class="sidebar-nav-scroll/);
  assert.match(home,/class="sidebar-bottom/);
});

test("account login and signup modal renders with proper layout, tabs, and styles", async () => {
  const signupHtml = renderToStaticMarkup(React.createElement(Modal, {
    modal: { type: "account" },
    onClose() {},
    onApprove() {},
    loginMode: "signup",
    setLoginMode() {},
    authSubmit() {},
    authError: "",
    authMessage: "",
    setAuthError() {},
    setAuthMessage() {},
    logout() {}
  }));

  assert.match(signupHtml, /class="modal auth-modal panel/);
  assert.match(signupHtml, /Your Drizzlearn account/);
  assert.match(signupHtml, /<span class="auth-kicker eyebrow self-start">ACCOUNT<\/span>/);
  assert.match(signupHtml, /Create your account/);
  assert.match(signupHtml, /Save your courses and progress\./);
  assert.match(signupHtml, /<div class="auth-tabs" role="group" aria-label="Account type">/);
  assert.doesNotMatch(signupHtml, /border-b border-learnos-border pb-2/);
  assert.match(signupHtml, /name="fullName"/);
  assert.match(signupHtml, /name="email"/);
  assert.match(signupHtml, /name="password"/);
  assert.match(signupHtml, /<button class="primary-btn mt-1\.5" type="submit">Create account<\/button>/);

  const loginHtml = renderToStaticMarkup(React.createElement(Modal, {
    modal: { type: "account" },
    onClose() {},
    onApprove() {},
    loginMode: "login",
    setLoginMode() {},
    authSubmit() {},
    authError: "",
    authMessage: "",
    setAuthError() {},
    setAuthMessage() {},
    logout() {}
  }));

  assert.match(loginHtml, /Welcome back/);
  assert.match(loginHtml, /Sign in to continue\./);
  assert.doesNotMatch(loginHtml, /name="fullName"/);
  assert.match(loginHtml, /Forgot password\?/);
  assert.match(loginHtml, /<button class="primary-btn mt-1\.5" type="submit">Sign in<\/button>/);

  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.auth-modal \.modal-body\s*\{[^}]*scrollbar-gutter:\s*auto;/s);
  assert.match(css, /\.modal-body::-webkit-scrollbar\s*\{/);
  assert.match(css, /\.modal-body::-webkit-scrollbar-thumb\s*\{/);
  assert.match(css, /\.auth-kicker[^{]*\{[^}]*width:\s*fit-content;/s);
  assert.match(css, /\.auth-tabs\s*\{[^}]*display:\s*grid;/s);
  assert.match(css, /\.auth-tabs button\.active,\s*\.auth-tab-btn\.active\s*\{/s);
});

test("full page login and signup routes render as dedicated pages with brand header and auth card", async () => {
  const loginHtml = renderRoute("login");
  assert.match(loginHtml, /class="login-fullpage"/);
  assert.match(loginHtml, /class="login-brand-link"/);
  assert.match(loginHtml, /Back to workspace/);
  assert.match(loginHtml, /class="auth-page-card/);
  assert.match(loginHtml, /Welcome back/);
  assert.match(loginHtml, /name="email"/);
  assert.match(loginHtml, /name="password"/);
  assert.doesNotMatch(loginHtml, /name="fullName"/);
  assert.match(loginHtml, /<button class="primary-btn mt-2" type="submit">Sign in<\/button>/);

  const signupHtml = renderRoute("signup");
  assert.match(signupHtml, /class="login-fullpage"/);
  assert.match(signupHtml, /Create your account/);
  assert.match(signupHtml, /name="fullName"/);
  assert.match(signupHtml, /name="email"/);
  assert.match(signupHtml, /name="password"/);
  assert.match(signupHtml, /<button class="primary-btn mt-2" type="submit">Create account<\/button>/);

  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.login-fullpage\s*\{/);
  assert.match(css, /\.auth-page-card\s*\{/);
});

test("study tools expose topics and filters across all courses instead of only the latest active course", () => {
  localStorageValues.set(
    "learnos.local.v2",
    JSON.stringify({
      courses: [
        {
          id: "c-new",
          title: "React Hooks Mastery",
          status: "active",
          modules: [{ id: "m-new", title: "Hooks Core", lessons: [{ id: "l-new", title: "Latest React Lesson", objective: "Use state" }] }],
        },
        {
          id: "c-old",
          title: "Python Foundations",
          status: "active",
          modules: [{ id: "m-old", title: "Python Basics", lessons: [{ id: "l-old", title: "Old Python Lesson", objective: "Use lists" }] }],
        },
      ],
      activeCourseId: "c-new",
      goals: [],
      tasks: [],
      notes: [],
      flashcards: [
        { id: "f-old", front: "Python list push?", back: "append()", lesson_id: "l-old", course_id: "c-old", due_at: "2025-01-01T00:00:00Z" },
      ],
      attempts: [],
      settings: {},
    })
  );

  const practiceHtml = renderRoute("practice");
  assert.ok(practiceHtml.includes("All courses (2 topics)"));
  assert.ok(practiceHtml.includes("React Hooks Mastery"));
  assert.ok(practiceHtml.includes("Python Foundations"));
  assert.ok(practiceHtml.includes("Latest React Lesson"));
  assert.ok(practiceHtml.includes("Old Python Lesson"));

  const tutorHtml = renderRoute("tutor");
  assert.ok(tutorHtml.includes("All courses (2 topics)"));
  assert.ok(tutorHtml.includes("Python Foundations"));
  assert.ok(tutorHtml.includes("Old Python Lesson"));

  const flashcardsHtml = renderRoute("flashcards");
  assert.ok(flashcardsHtml.includes("All courses (1)"));
  assert.ok(flashcardsHtml.includes("Python Foundations"));
  assert.ok(flashcardsHtml.includes("Old Python Lesson"));

  const progressHtml = renderRoute("progress");
  assert.ok(progressHtml.includes("All courses (2)"));
  assert.ok(progressHtml.includes("React Hooks Mastery"));
  assert.ok(progressHtml.includes("Python Foundations"));

  const notesHtml = renderRoute("notes");
  assert.ok(notesHtml.includes("React Hooks Mastery"));
  assert.ok(notesHtml.includes("Python Foundations"));
});
