import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

const testUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "learner@example.com",
  full_name: "Sample Learner",
  timezone: "Asia/Kolkata",
  preferred_study_days: [1, 3, 5],
  session_minutes: 45,
  weekly_minutes: 360,
  notification_preferences: { study: true, review: true },
};
const lesson = {
  id: "lesson-1",
  course_id: "course-1",
  title: "Train/test split",
  objective: "Keep test examples outside the tuning loop.",
  checkpoint: { question: "Which set stays held out?", options: ["Training", "Test"], answerIndex: 1, explanation: "The test set stays held out." },
};
const taskId = "22222222-2222-4222-8222-222222222222";
const cardId = "44444444-4444-4444-8444-444444444444";
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
    name: "learnos-api-test-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.includes("api/[...path].js")) return null;
      const replacement = replacements.get(source);
      return replacement ? `\0learnos-test:${replacement}` : null;
    },
    load(id) {
      if (!id.startsWith("\0learnos-test:")) return null;
      const mock = id.slice("\0learnos-test:".length);
      if (mock === "db") return `
        export async function query(...args) { return globalThis.__learnosApiTest.query(...args); }
        export async function withTransaction(work) { return work({ query: (...args) => globalThis.__learnosApiTest.query(...args) }); }
      `;
      if (mock === "auth") return `
        export async function requireUser() { return globalThis.__learnosApiTest.user; }
        export function sessionUserId() { return globalThis.__learnosApiTest.user.id; }
        export function createSessionCookie() { return "learnos_session=test; HttpOnly; Path=/; SameSite=Lax"; }
        export function clearSessionCookie() { return "learnos_session=; HttpOnly; Path=/; Max-Age=0"; }
      `;
      if (mock === "email") return `export async function sendEmail() { globalThis.__learnosApiTest.emailSent = true; return { id: "email-test" }; }`;
      if (mock === "plans") return `
        export async function generateCourseProposal(...args) { return globalThis.__learnosApiTest.generateCourseProposal(...args); }
        export async function improveCourseProposal(...args) { return globalThis.__learnosApiTest.improveCourseProposal(...args); }
        export async function approveCourse(...args) { return globalThis.__learnosApiTest.approveCourse(...args); }
      `;
      if (mock === "ai") return `export async function tutorReply(...args) { return globalThis.__learnosApiTest.tutorReply(...args); }`;
      if (mock === "retrieval") return `export async function retrieveLearnerContext(...args) { return globalThis.__learnosApiTest.retrieveLearnerContext(...args); }`;
      return null;
    },
  };
}

function queryStub(sql, values = []) {
  state.queries.push({ sql, values });
  if (sql.includes("INSERT INTO users(email,full_name,password_hash,email_verified_at)")) return Promise.resolve({ rows:[{id:testUser.id,email:values[0],full_name:values[1],...testUser}] });
  if (sql.includes("SELECT * FROM study_rooms WHERE room_code=$1 FOR UPDATE")) return Promise.resolve({ rows: state.studyRoom?.room_code === values[0] ? [state.studyRoom] : [] });
  if (sql.includes("INSERT INTO study_rooms")) {
    state.studyRoom = { id:"room-1", room_code:values[0], owner_user_id:values[1], title:values[2], topic:values[3], focus_minutes:values[4], break_minutes:values[5], long_break_minutes:values[6], long_break_every:values[7], phase:"idle", paused_phase:null, completed_focuses:0, paused_remaining_seconds:0, phase_started_at:null, phase_ends_at:null, created_at:new Date().toISOString(), updated_at:new Date().toISOString() };
    return Promise.resolve({ rows:[state.studyRoom] });
  }
  if (sql.includes("INSERT INTO study_room_members")) { state.studyMembership=true; return Promise.resolve({ rows:[] }); }
  if (sql.includes("UPDATE study_room_members SET last_seen_at=NOW()")) return Promise.resolve({ rows:state.studyMembership?[{user_id:values[1]}]:[] });
  if (sql.includes("SELECT role FROM study_room_members WHERE room_id=$1 AND user_id=$2")) return Promise.resolve({ rows:state.studyMembership?[{role:"owner"}]:[] });
  if (sql.includes("SELECT m.user_id,m.role,u.full_name,m.last_seen_at")) return Promise.resolve({ rows:state.studyMembership?[{user_id:testUser.id,role:"owner",full_name:testUser.full_name,is_online:true}]:[] });
  if (sql.includes("UPDATE study_rooms SET phase=$1")) {
    Object.assign(state.studyRoom,{phase:values[0],paused_phase:values[1],completed_focuses:values[2],paused_remaining_seconds:values[3],phase_started_at:values[4],phase_ends_at:values[5],updated_at:new Date().toISOString()});
    return Promise.resolve({ rows:[state.studyRoom] });
  }
  if (sql.includes("FROM study_rooms r JOIN study_room_members mine")) return Promise.resolve({ rows:[] });
  if (sql.includes("SELECT * FROM study_tasks WHERE id=$1 AND user_id=$2")) {
    return Promise.resolve({ rows: state.task ? [{ id: taskId, lesson_id: "lesson-1", estimated_minutes: 25, ...state.task }] : [] });
  }
  if (sql.includes("SELECT id FROM practice_attempts WHERE user_id=$1 AND lesson_id=$2")) {
    return Promise.resolve({ rows: state.hasEvidence ? [{ id: "attempt-1" }] : [] });
  }
  if (sql.includes("UPDATE study_tasks SET status='completed'")) {
    return Promise.resolve({ rows: [{ id: taskId, status: "completed", actual_minutes: values[0] }] });
  }
  if (sql.includes("SELECT l.id,l.course_id FROM lessons")) {
    return Promise.resolve({ rows: state.lessonFound ? [{ id: lesson.id, course_id: lesson.course_id }] : [] });
  }
  if (sql.includes("SELECT l.id,l.course_id,l.title,l.objective,l.checkpoint FROM lessons")) {
    return Promise.resolve({ rows: state.lessonFound ? [lesson] : [] });
  }
  if (sql.includes("SELECT l.title,l.objective,l.content_markdown,l.worked_example")) {
    return Promise.resolve({ rows: state.lessonFound ? [{ ...lesson, course_title: "Machine Learning" }] : [] });
  }
  if (sql.includes("INSERT INTO learning_goals")) {
    return Promise.resolve({ rows: [{ id: "goal-1", topic: values[1], desired_outcome: values[2], current_level: values[3], weekly_minutes: values[7] }] });
  }
  if (sql.includes("INSERT INTO notes")) {
    return Promise.resolve({ rows: [{ id: "note-1", user_id: values[0], course_id: values[1], lesson_id: values[2], title: values[3], body: values[4], source_ref: values[5] }] });
  }
  if (sql.includes("UPDATE notes SET")) return Promise.resolve({ rows: state.noteFound ? [{ id: "note-1", title: values[0], body: values[1] }] : [] });
  if (sql.includes("DELETE FROM notes")) return Promise.resolve({ rows: state.noteFound ? [{ id: "note-1" }] : [] });
  if (sql.includes("WHERE n.id=$1 AND n.user_id=$2")) return Promise.resolve({ rows: state.noteFound ? [{ id: "note-1", title: "Train/test split", body: "Hold out test examples." }] : [] });
  if (sql.includes("INSERT INTO flashcards")) {
    return Promise.resolve({ rows: [{ id: "card-1", user_id: values[0], front: values[3], back: values[4] }] });
  }
  if (sql.includes("SELECT * FROM flashcards WHERE id=$1")) {
    return Promise.resolve({ rows: [{ id: "card-1", interval_days: 2, repetitions: 0, ease: 2.5 }] });
  }
  if (sql.includes("UPDATE flashcards SET due_at")) return Promise.resolve({ rows: [{ id: "card-1", interval_days: values[1], due_at: values[0] }] });
  if (sql.includes("INSERT INTO practice_attempts")) {
    return Promise.resolve({ rows: [{ id: "attempt-1", lesson_id: values[2], score: values[7], submitted_answer: values[5] }] });
  }
  if (sql.includes("UPDATE users SET full_name")) {
    return Promise.resolve({ rows: [{ ...testUser, full_name: values[0], timezone: values[1], preferred_study_days: values[2], session_minutes: values[3], weekly_minutes: values[4], notification_preferences: JSON.parse(values[5]) }] });
  }
  if (sql.includes("SELECT password_hash FROM users")) return Promise.resolve({ rows: [{ password_hash: state.passwordHash || "unused" }] });
  if (sql.includes("SELECT l.id,l.title,l.objective,c.title course_title")) return Promise.resolve({ rows: [{ id: lesson.id, title: lesson.title, objective: lesson.objective, course_title: "Machine Learning" }] });
  if (sql.includes("SELECT id,title,body FROM notes")) return Promise.resolve({ rows: [{ id: "note-1", title: "Train/test split", body: "Hold out test examples." }] });
  if (sql.includes("SELECT id,title,status FROM courses")) return Promise.resolve({ rows: [{ id: "course-1", title: "Machine Learning", status: "active" }] });
  if (/^SELECT \*/.test(sql.trim())) return Promise.resolve({ rows: [{ id: "record-1" }] });
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
  vite = await createServer({ configFile: "./vite.config.js", logLevel: "silent", plugins: [mockPlugin()], server: { middlewareMode: true }, appType: "custom" });
  ({ default: handler } = await vite.ssrLoadModule("/api/[...path].js"));
});

beforeEach(() => {
  state = {
    user: testUser,
    queries: [],
    lessonFound: true,
    noteFound: false,
    hasEvidence: false,
    task: { lesson_id: "lesson-1", estimated_minutes: 25 },
    generateCourseProposal: async () => ({ id: "course-proposal", title: "Machine Learning" }),
    improveCourseProposal: async (_userId,courseId,feedback) => ({ id:courseId,title:"Improved course",feedback }),
    approveCourse: async () => ({ course: { id: "course-1", status: "active" } }),
    tutorReply: async () => ({ text: "Hold the test set aside.", source: "sample" }),
    retrieveLearnerContext: async () => [],
    studyRoom: null,
    studyMembership: false,
    emailSent: false,
    passwordHash: null,
    query: queryStub,
  };
  globalThis.__learnosApiTest = state;
});

after(async () => {
  await vite?.close();
  delete globalThis.__learnosApiTest;
});

test("goal creation validates inputs and returns a proposal", async (t) => {
  await t.test("invalid goals are rejected", async () => {
    const result = await callApi({ path: "goals", method: "POST", body: { topic: "", desiredOutcome: "tiny" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_GOAL");
  });
  await t.test("valid goal is stored", async () => {
    const result = await callApi({ path: "goals", method: "POST", body: { topic: "Machine Learning", desiredOutcome: "Train and explain a classifier.", weeklyMinutes: 360, targetWeeks: 8 } });
    assert.equal(result.status, 201);
    assert.equal(result.json.goal.topic, "Machine Learning");
  });
  await t.test("a plan proposal is generated for a valid goal id", async () => {
    const result = await callApi({ path: "goals/11111111-1111-4111-8111-111111111111/proposal", method: "POST", body: {} });
    assert.equal(result.status, 201);
    assert.equal(result.json.course.id, "course-proposal");
  });
});

test("notes support create, update, delete, and ownership misses", async (t) => {
  await t.test("requires a title", async () => {
    const result = await callApi({ path: "notes", method: "POST", body: { body: "Body without title" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "TITLE_REQUIRED");
  });
  await t.test("creates a lesson-linked note", async () => {
    const result = await callApi({ path: "notes", method: "POST", body: { title: "Split reminder", body: "Keep examples held out.", lessonId: "lesson-1" } });
    assert.equal(result.status, 201);
    assert.equal(result.json.note.lesson_id, "lesson-1");
  });
  await t.test("unknown note update and delete return 404", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const update = await callApi({ path: `notes/${id}`, method: "PUT", body: { title: "Missing", body: "Body" } });
    const remove = await callApi({ path: `notes/${id}`, method: "DELETE" });
    assert.equal(update.status, 404);
    assert.equal(remove.status, 404);
  });
  await t.test("rejects non-UUID note IDs with 404 NOT_FOUND", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await callApi({ path: "notes/not-a-uuid", method, body: { title: "T", body: "B" } });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, "NOT_FOUND");
    }
  });
  await t.test("retrieves an existing note by UUID", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    state.noteFound = true;
    const res = await callApi({ path: `notes/${id}`, method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.note.id, "note-1");
  });
});

test("flashcard creation and spaced review validate ratings", async (t) => {
  await t.test("both sides are required", async () => {
    const result = await callApi({ path: "flashcards", method: "POST", body: { front: "Only a prompt" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "CARD_REQUIRED");
  });
  await t.test("valid card is created", async () => {
    const result = await callApi({ path: "flashcards", method: "POST", body: { front: "What is a label?", back: "The target to predict." } });
    assert.equal(result.status, 201);
    assert.equal(result.json.flashcard.front, "What is a label?");
  });
  await t.test("invalid ratings are rejected and valid ratings reschedule the card", async () => {
    const invalid = await callApi({ path: `flashcards/${cardId}/review`, method: "POST", body: { rating: "Maybe" } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, "INVALID_RATING");
    const valid = await callApi({ path: `flashcards/${cardId}/review`, method: "POST", body: { rating: "Good" } });
    assert.equal(valid.status, 200);
    assert.equal(valid.json.flashcard.interval_days, 4);
  });
  await t.test("rejects non-UUID flashcard IDs with 404 NOT_FOUND", async () => {
    const remove = await callApi({ path: "flashcards/not-a-uuid", method: "DELETE" });
    assert.equal(remove.status, 404);
    assert.equal(remove.json.error.code, "NOT_FOUND");
    const review = await callApi({ path: "flashcards/not-a-uuid/review", method: "POST", body: { rating: "Good" } });
    assert.equal(review.status, 404);
    assert.equal(review.json.error.code, "NOT_FOUND");
  });
});

test("study rooms validate settings, create, join, and synchronize the Pomodoro timer", async (t) => {
  await t.test("rejects invalid room title and Pomodoro values", async () => {
    const missingTitle = await callApi({ path:"study-rooms", method:"POST", body:{title:" ",focusMinutes:25,breakMinutes:5} });
    const invalidTimer = await callApi({ path:"study-rooms", method:"POST", body:{title:"Study room",focusMinutes:2,breakMinutes:5} });
    assert.equal(missingTitle.status,400);
    assert.equal(missingTitle.json.error.code,"ROOM_TITLE_REQUIRED");
    assert.equal(invalidTimer.status,400);
    assert.equal(invalidTimer.json.error.code,"INVALID_POMODORO");
  });
  await t.test("creates a persisted room with owner membership", async () => {
    const result = await callApi({ path:"study-rooms", method:"POST", body:{title:"Evening focus",topic:"Machine Learning",focusMinutes:30,breakMinutes:10,longBreakMinutes:20,longBreakEvery:3} });
    assert.equal(result.status,201);
    assert.equal(result.json.room.title,"Evening focus");
    assert.equal(result.json.room.focusMinutes,30);
    assert.equal(result.json.room.participants[0].role,"owner");
    assert.match(result.json.room.code,/^[A-HJ-NP-Z2-9]{8}$/);
    assert.ok(state.queries.some(query=>query.sql.includes("INSERT INTO study_room_members")));
  });
  await t.test("room codes are not enumerable and joining returns synchronized membership", async () => {
    const missing=await callApi({path:"study-rooms/DEADBEEF",method:"GET"});
    assert.equal(missing.status,404);
    state.studyRoom={id:"room-1",room_code:"ABCDEF23",owner_user_id:testUser.id,title:"Study room",topic:"",focus_minutes:25,break_minutes:5,long_break_minutes:15,long_break_every:4,phase:"idle",paused_phase:null,completed_focuses:0,paused_remaining_seconds:0,phase_started_at:null,phase_ends_at:null};
    const joined=await callApi({path:"study-rooms/ABCDEF23/join",method:"POST",body:{}});
    assert.equal(joined.status,200);
    assert.equal(joined.json.room.code,"ABCDEF23");
    assert.equal(joined.json.room.participants[0].name,testUser.full_name);
  });
  await t.test("shared timer supports start, pause, resume, skip, and rejects invalid actions", async () => {
    state.studyRoom={id:"room-1",room_code:"ABCDEF23",owner_user_id:testUser.id,title:"Study room",topic:"",focus_minutes:25,break_minutes:5,long_break_minutes:15,long_break_every:4,phase:"idle",paused_phase:null,completed_focuses:0,paused_remaining_seconds:0,phase_started_at:null,phase_ends_at:null};
    state.studyMembership=true;
    const invalid=await callApi({path:"study-rooms/ABCDEF23/timer",method:"POST",body:{action:"launch"}});
    const started=await callApi({path:"study-rooms/ABCDEF23/timer",method:"POST",body:{action:"start"}});
    const paused=await callApi({path:"study-rooms/ABCDEF23/timer",method:"POST",body:{action:"pause"}});
    const resumed=await callApi({path:"study-rooms/ABCDEF23/timer",method:"POST",body:{action:"resume"}});
    const skipped=await callApi({path:"study-rooms/ABCDEF23/timer",method:"POST",body:{action:"skip"}});
    assert.equal(invalid.status,400);
    assert.equal(started.json.room.phase,"focus");
    assert.equal(paused.json.room.phase,"paused");
    assert.ok(paused.json.room.pausedRemainingSeconds>0);
    assert.equal(resumed.json.room.phase,"focus");
    assert.equal(skipped.json.room.phase,"short_break");
    assert.equal(skipped.json.room.completedFocuses,1);
  });
});

test("practice evidence records correct and incorrect checkpoint answers", async (t) => {
  await t.test("requires an answer", async () => {
    const result = await callApi({ path: "practice", method: "POST", body: { lessonId: "lesson-1" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "ANSWER_REQUIRED");
  });
  await t.test("correct answer receives passing evidence", async () => {
    const result = await callApi({ path: "practice", method: "POST", body: { lessonId: "lesson-1", answer: "Test", selectedIndex: 1 } });
    assert.equal(result.status, 201);
    assert.equal(result.json.result.correct, true);
    assert.equal(result.json.attempt.score, 100);
  });
  await t.test("incorrect answer is kept without passing", async () => {
    const result = await callApi({ path: "practice", method: "POST", body: { lessonId: "lesson-1", answer: "Training", selectedIndex: 0 } });
    assert.equal(result.status, 201);
    assert.equal(result.json.result.correct, false);
    assert.equal(result.json.attempt.score, 0);
  });
});

test("task completion requires passing checkpoint evidence", async (t) => {
  await t.test("blocks incomplete learning evidence", async () => {
    const result = await callApi({ path: `tasks/${taskId}/complete`, method: "POST", body: { actualMinutes: 25 } });
    assert.equal(result.status, 409);
    assert.equal(result.json.error.code, "EVIDENCE_REQUIRED");
  });
  await t.test("completes a task after passing evidence exists", async () => {
    state.hasEvidence = true;
    const result = await callApi({ path: `tasks/${taskId}/complete`, method: "POST", body: { actualMinutes: 30 } });
    assert.equal(result.status, 200);
    assert.equal(result.json.task.status, "completed");
    assert.equal(result.json.task.actual_minutes, 30);
  });
  await t.test("reschedule dates are validated", async () => {
    const result = await callApi({ path: `tasks/${taskId}/reschedule`, method: "POST", body: { scheduledAt: "not-a-date" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_DATE");
  });
  await t.test("task list query validates from and to date filters", async () => {
    const invalidFrom = await callApi({ path: "tasks?from=not-a-date", method: "GET" });
    assert.equal(invalidFrom.status, 400);
    assert.equal(invalidFrom.json.error.code, "INVALID_DATE");

    const invalidTo = await callApi({ path: "tasks?to=not-a-date", method: "GET" });
    assert.equal(invalidTo.status, 400);
    assert.equal(invalidTo.json.error.code, "INVALID_DATE");

    const validRange = await callApi({ path: "tasks?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z", method: "GET" });
    assert.equal(validRange.status, 200);
    assert.ok(Array.isArray(validRange.json.tasks));
  });
});

test("tutor and settings endpoints reject invalid input and accept valid updates", async (t) => {
  await t.test("tutor rejects unsupported modes", async () => {
    const result = await callApi({ path: "tutor", method: "POST", body: { mode: "Write an essay", prompt: "Help" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_MODE");
  });
  await t.test("tutor returns an answer for a supported mode", async () => {
    const result = await callApi({ path: "tutor", method: "POST", body: { mode: "Hint", prompt: "What should I hold out?", lessonId: "lesson-1" } });
    assert.equal(result.status, 200);
    assert.equal(result.json.reply, "Hold the test set aside.");
  });
  await t.test("settings enforce study time limits", async () => {
    const result = await callApi({ path: "settings", method: "PUT", body: { fullName: "A", sessionMinutes: 10, weeklyMinutes: 99999 } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_SETTINGS");
  });
  await t.test("valid settings update the learner profile", async () => {
    const result = await callApi({ path: "settings", method: "PUT", body: { fullName: "Harsh Tiwari", timezone: "Asia/Kolkata", sessionMinutes: 45, weeklyMinutes: 360, preferredStudyDays: [1, 3, 5] } });
    assert.equal(result.status, 200);
    assert.equal(result.json.user.fullName, "Harsh Tiwari");
    assert.deepEqual(result.json.user.preferredStudyDays, [1, 3, 5]);
  });
  await t.test("account deletion validates password and clears user data", async () => {
    state.passwordHash = "$2b$04$eLSnic9TGs024RlfMTQQBeKg7Ui98UZ.fPnTbAWN.cl.z22NaooRi";
    const invalid = await callApi({ path: "settings/account", method: "DELETE", body: { password: "wrong-password" } });
    assert.equal(invalid.status, 401);
    assert.equal(invalid.json.error.code, "INVALID_CREDENTIALS");

    const valid = await callApi({ path: "settings/account", method: "DELETE", body: { password: "correct-password" } });
    assert.equal(valid.status, 200);
    assert.equal(valid.json.deleted, true);
    assert.match(valid.headers.get("set-cookie"), /learnos_session=;.*Max-Age=0/);
    assert.ok(state.queries.some(q => q.sql.includes("DELETE FROM users WHERE id=$1")));
  });
});

test("search and account data export return the expected structures", async (t) => {
  await t.test("search returns lesson, note, and course collections", async () => {
    const result = await callApi({ path: "search", query: "?q=split" });
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.json.lessons));
    assert.ok(Array.isArray(result.json.notes));
    assert.ok(Array.isArray(result.json.courses));
  });
  await t.test("export includes learner-owned data collections", async () => {
    const result = await callApi({ path: "settings/export" });
    assert.equal(result.status, 200);
    for (const key of ["user", "goals", "courses", "notes", "flashcards", "tasks", "practiceAttempts"]) {
      assert.ok(key in result.json, `export is missing ${key}`);
    }
  });
});

test("signup activates the account immediately without email verification", async () => {
  const result=await callApi({path:"auth/signup",method:"POST",body:{fullName:"Sample Learner",email:"learner@example.com",password:"long-enough-pass"}});
  assert.equal(result.status,201);
  assert.equal(result.json.user.email,testUser.email);
  assert.equal(result.json.verificationSent,undefined);
  assert.match(result.headers.get("set-cookie"),/learnos_session=test/);
  assert.ok(state.queries.some(query=>query.sql.includes("email_verified_at) VALUES($1,$2,$3,NOW())")));
  assert.equal(state.queries.some(query=>query.sql.includes("INSERT INTO auth_tokens")),false);
  assert.equal(state.emailSent,false);
});

test("course proposal improvements validate feedback and preserve the draft workflow", async (t) => {
  const courseId="44444444-4444-4444-8444-444444444444";
  await t.test("requires useful feedback",async()=>{
    const result=await callApi({path:`courses/${courseId}/improve`,method:"POST",body:{feedback:"short"}});
    assert.equal(result.status,400);
    assert.equal(result.json.error.code,"IMPROVEMENT_FEEDBACK_REQUIRED");
  });
  await t.test("returns an improved editable proposal",async()=>{
    const result=await callApi({path:`courses/${courseId}/improve`,method:"POST",body:{feedback:"Add more practical projects and examples."}});
    assert.equal(result.status,200);
    assert.equal(result.json.course.id,courseId);
    assert.equal(result.json.course.title,"Improved course");
  });
});
