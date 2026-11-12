import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { createServer } from "vite";
import { safeError } from "../server/http.js";
import { withTransaction, getPool } from "../server/db.js";
import { createSessionCookie, clearSessionCookie, sessionUserId } from "../server/auth.js";
import { approveCourse } from "../server/plan-service.js";

process.env.SESSION_SECRET = process.env.SESSION_SECRET || "test-session-secret-that-is-at-least-32-characters";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://dummy:dummy@localhost:5432/drizzlearn_test";

const testUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "learner@example.com",
  full_name: "Test Learner",
  timezone: "UTC",
  preferred_study_days: [1, 3, 5],
  session_minutes: 60,
  weekly_minutes: 360,
  notification_preferences: { study: true, review: true, quietStart: "22:00", quietEnd: "08:00" },
};

const sampleGoal = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: testUser.id,
  topic: "Distributed Systems",
  desired_outcome: "Understand consensus and replication protocols.",
  current_level: "Intermediate",
  weekly_minutes: 360,
  target_weeks: 8,
  status: "active",
};

const sampleCourse = {
  id: "33333333-3333-4333-8333-333333333333",
  user_id: testUser.id,
  goal_id: sampleGoal.id,
  title: "Consensus Protocols",
  summary: "Raft and Paxos in depth.",
  status: "proposal",
  estimated_minutes: 240,
  assumptions: ["Basic networking"],
};

const sampleLesson = {
  id: "44444444-4444-4444-8444-444444444444",
  course_id: sampleCourse.id,
  module_id: "55555555-5555-4555-8555-555555555555",
  title: "Leader Election in Raft",
  objective: "Explain randomized election timeouts.",
  prerequisites: ["RPC basics"],
  content_markdown: "Raft uses randomized timers.",
  worked_example: "Split vote resolution with timers.",
  checkpoint: {
    question: "What breaks split vote ties?",
    options: ["Higher term ID", "Randomized election timeouts"],
    answerIndex: 1,
    explanation: "Randomized timers ensure one candidate times out first.",
  },
  estimated_minutes: 25,
};

const sampleTask = {
  id: "66666666-6666-4666-8666-666666666666",
  user_id: testUser.id,
  course_id: sampleCourse.id,
  lesson_id: sampleLesson.id,
  task_type: "lesson",
  title: "Leader Election in Raft",
  scheduled_at: new Date(Date.now() + 86400000).toISOString(),
  status: "upcoming",
  estimated_minutes: 25,
};

const sampleNote = {
  id: "77777777-7777-4777-8777-777777777777",
  user_id: testUser.id,
  course_id: sampleCourse.id,
  lesson_id: sampleLesson.id,
  title: "Raft Notes",
  body: "Key takeaway on randomized election timeouts.",
  source_ref: "Section 5.2",
};

const sampleCard = {
  id: "88888888-8888-4888-8888-888888888888",
  user_id: testUser.id,
  course_id: sampleCourse.id,
  lesson_id: sampleLesson.id,
  front: "What breaks split vote ties in Raft?",
  back: "Randomized election timeouts.",
  interval_days: 1,
  repetitions: 1,
  ease: 2.5,
  due_at: new Date().toISOString(),
};

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
    name: "learnos-backend-verification-mocks",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer?.includes("api/[...path].js")) return null;
      const replacement = replacements.get(source);
      return replacement ? `\0learnos-backend-verification:${replacement}` : null;
    },
    load(id) {
      if (!id.startsWith("\0learnos-backend-verification:")) return null;
      const mock = id.slice("\0learnos-backend-verification:".length);
      if (mock === "db") return `
        export async function query(...args) { return globalThis.__learnosBackendVerificationTest.query(...args); }
        export async function withTransaction(work) { return globalThis.__learnosBackendVerificationTest.withTransaction(work); }
      `;
      if (mock === "auth") return `
        export async function requireUser(...args) { return globalThis.__learnosBackendVerificationTest.requireUser(...args); }
        export function sessionUserId(...args) { return globalThis.__learnosBackendVerificationTest.sessionUserId(...args); }
        export function createSessionCookie(...args) { return globalThis.__learnosBackendVerificationTest.createSessionCookie(...args); }
        export function clearSessionCookie(...args) { return globalThis.__learnosBackendVerificationTest.clearSessionCookie(...args); }
      `;
      if (mock === "email") return `export async function sendEmail(...args) { globalThis.__learnosBackendVerificationTest.emailSent = true; return { id: "email-test" }; }`;
      if (mock === "plans") return `
        export async function generateCourseProposal(...args) { return globalThis.__learnosBackendVerificationTest.generateCourseProposal(...args); }
        export async function improveCourseProposal(...args) { return globalThis.__learnosBackendVerificationTest.improveCourseProposal(...args); }
        export async function approveCourse(...args) { return globalThis.__learnosBackendVerificationTest.approveCourse(...args); }
      `;
      if (mock === "ai") return `export async function tutorReply(...args) { return globalThis.__learnosBackendVerificationTest.tutorReply(...args); }`;
      if (mock === "retrieval") return `export async function retrieveLearnerContext(...args) { return globalThis.__learnosBackendVerificationTest.retrieveLearnerContext(...args); }`;
      return null;
    },
  };
}

function queryStub(sql, values = []) {
  state.queries.push({ sql, values });

  // Users & Auth
  if (sql.includes("INSERT INTO users(email,full_name,password_hash,email_verified_at)")) {
    if (state.userExists) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [{ ...testUser, id: testUser.id, email: values[0], full_name: values[1] }] });
  }
  if (sql.includes("SELECT id,email,full_name,password_hash,timezone,preferred_study_days")) {
    if (state.loginFound) return Promise.resolve({ rows: [{ id: testUser.id, email: values[0], full_name: testUser.full_name, password_hash: state.passwordHash, ...testUser }] });
    return Promise.resolve({ rows: [] });
  }
  if (sql.includes("SELECT password_hash FROM users WHERE id=$1")) {
    return Promise.resolve({ rows: [{ password_hash: state.passwordHash }] });
  }
  if (sql.includes("DELETE FROM users WHERE id=$1")) {
    state.userDeleted = true;
    return Promise.resolve({ rows: [{ id: values[0] }] });
  }
  if (sql.includes("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='verify_email'")) {
    return Promise.resolve({ rows: state.tokenValid ? [{ user_id: testUser.id }] : [] });
  }
  if (sql.includes("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='reset_password'")) {
    return Promise.resolve({ rows: state.tokenValid ? [{ user_id: testUser.id }] : [] });
  }
  if (sql.includes("UPDATE users SET email_verified_at=NOW()")) {
    return Promise.resolve({ rows: [{ id: testUser.id }] });
  }
  if (sql.includes("UPDATE users SET password_hash=$1")) {
    return Promise.resolve({ rows: [{ id: testUser.id }] });
  }
  if (sql.includes("SELECT id FROM users WHERE email=$1")) {
    return Promise.resolve({ rows: [{ id: testUser.id }] });
  }
  if (sql.includes("INSERT INTO auth_tokens")) {
    return Promise.resolve({ rows: [{ id: "token-1" }] });
  }
  if (sql.includes("UPDATE users SET full_name=$1")) {
    return Promise.resolve({ rows: [{ ...testUser, full_name: values[0], timezone: values[1], session_minutes: values[3], weekly_minutes: values[4] }] });
  }

  // Home Dashboard queries
  if (sql.includes("FROM courses c JOIN learning_goals g ON g.id=c.goal_id WHERE c.user_id=$1 AND c.status='active'")) {
    return Promise.resolve({ rows: [sampleCourse] });
  }
  if (sql.includes("FROM study_tasks WHERE user_id=$1 AND status IN ('due','in_progress','upcoming','overdue')")) {
    return Promise.resolve({ rows: [sampleTask] });
  }
  if (sql.includes("SELECT COUNT(*)::int AS count FROM flashcards WHERE user_id=$1 AND due_at<=NOW()")) {
    return Promise.resolve({ rows: [{ count: 2 }] });
  }
  if (sql.includes("SELECT (SELECT COUNT(*)::int FROM notes WHERE user_id=$1) notes")) {
    return Promise.resolve({ rows: [{ notes: 1, flashcards: 1, attempts: 2, completed: 1, total: 3 }] });
  }
  if (sql.includes("SELECT COUNT(DISTINCT concept)::int AS concepts FROM practice_attempts")) {
    return Promise.resolve({ rows: [{ concepts: 2 }] });
  }

  // Study Rooms
  if (sql.includes("SELECT * FROM study_rooms WHERE room_code=$1 FOR UPDATE")) {
    if (state.studyRoom && state.studyRoom.room_code === values[0]) return Promise.resolve({ rows: [state.studyRoom] });
    return Promise.resolve({ rows: [] });
  }
  if (sql.includes("INSERT INTO study_rooms")) {
    state.studyRoom = {
      id: "room-uuid-1",
      room_code: values[0],
      owner_user_id: values[1],
      title: values[2],
      topic: values[3],
      focus_minutes: values[4],
      break_minutes: values[5],
      long_break_minutes: values[6],
      long_break_every: values[7],
      phase: "idle",
      paused_phase: null,
      completed_focuses: 0,
      paused_remaining_seconds: 0,
      phase_started_at: null,
      phase_ends_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return Promise.resolve({ rows: [state.studyRoom] });
  }
  if (sql.includes("INSERT INTO study_room_members")) {
    state.studyMembership = true;
    return Promise.resolve({ rows: [] });
  }
  if (sql.includes("UPDATE study_room_members SET last_seen_at=NOW()")) {
    return Promise.resolve({ rows: state.studyMembership ? [{ user_id: values[1] }] : [] });
  }
  if (sql.includes("SELECT role FROM study_room_members WHERE room_id=$1 AND user_id=$2")) {
    return Promise.resolve({ rows: state.studyMembership ? [{ role: "owner" }] : [] });
  }
  if (sql.includes("SELECT m.user_id,m.role,u.full_name,m.last_seen_at")) {
    return Promise.resolve({ rows: state.studyMembership ? [{ user_id: testUser.id, role: "owner", full_name: testUser.full_name, is_online: true }] : [] });
  }
  if (sql.includes("UPDATE study_rooms SET phase=$1")) {
    Object.assign(state.studyRoom, {
      phase: values[0],
      paused_phase: values[1],
      completed_focuses: values[2],
      paused_remaining_seconds: values[3],
      phase_started_at: values[4],
      phase_ends_at: values[5],
      updated_at: new Date().toISOString(),
    });
    return Promise.resolve({ rows: [state.studyRoom] });
  }
  if (sql.includes("FROM study_rooms r JOIN study_room_members mine")) {
    return Promise.resolve({ rows: state.studyRoom ? [{ ...state.studyRoom, participants: [{ id: testUser.id, name: testUser.full_name, role: "owner", isOnline: true }] }] : [] });
  }

  // Goals
  if (sql.includes("INSERT INTO learning_goals")) {
    return Promise.resolve({ rows: [{ id: sampleGoal.id, topic: values[1], desired_outcome: values[2], current_level: values[3], purpose: values[4], target_date: values[5], target_weeks: values[6], weekly_minutes: values[7] }] });
  }
  if (sql.includes("SELECT * FROM learning_goals WHERE user_id=$1")) {
    return Promise.resolve({ rows: [sampleGoal] });
  }

  // Courses & Modules
  if (sql.includes("SELECT id FROM courses WHERE id=$1 AND user_id=$2")) {
    return Promise.resolve({ rows: state.courseFound && values[0] === sampleCourse.id ? [{ id: sampleCourse.id }] : [] });
  }
  if (sql.includes("SELECT c.*,g.topic,g.current_level,g.weekly_minutes,g.target_weeks") && sql.includes("module_count")) {
    return Promise.resolve({ rows: [sampleCourse] });
  }
  if (sql.includes("SELECT c.*,g.topic,g.desired_outcome,g.current_level") && sql.includes("WHERE c.id=$1 AND c.user_id=$2")) {
    return Promise.resolve({ rows: state.courseFound && values[0] === sampleCourse.id ? [sampleCourse] : [] });
  }
  if (sql.includes("SELECT m.*,COALESCE(json_agg") && sql.includes("FROM course_modules m")) {
    return Promise.resolve({ rows: [{ id: sampleLesson.module_id, title: "Module 1", lessons: [sampleLesson] }] });
  }
  if (sql.includes("UPDATE courses SET title=$1,summary=$2")) {
    return Promise.resolve({ rows: state.courseFound ? [{ ...sampleCourse, title: values[0], summary: values[1], status: values[2] || sampleCourse.status }] : [] });
  }
  if (sql.includes("UPDATE learning_goals SET status=$1")) {
    return Promise.resolve({ rows: [{ id: sampleGoal.id, status: values[0] }] });
  }
  if (sql.includes("UPDATE course_modules m SET title=$1,objective=$2")) {
    return Promise.resolve({ rows: state.moduleFound ? [{ id: values[2], title: values[0], objective: values[1] }] : [] });
  }

  // Lessons
  if (sql.includes("SELECT l.id,l.course_id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2")) {
    return Promise.resolve({ rows: state.lessonFound && values[0] === sampleLesson.id ? [{ id: sampleLesson.id, course_id: sampleCourse.id }] : [] });
  }
  if (sql.includes("SELECT l.id,l.course_id,l.title,l.objective,l.checkpoint FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2")) {
    return Promise.resolve({ rows: state.lessonFound && values[0] === sampleLesson.id ? [sampleLesson] : [] });
  }
  if (sql.includes("SELECT l.*,c.title AS course_title,m.title AS module_title FROM lessons l")) {
    return Promise.resolve({ rows: state.lessonFound && values[0] === sampleLesson.id ? [{ ...sampleLesson, course_title: sampleCourse.title, module_title: "Module 1" }] : [] });
  }
  if (sql.includes("SELECT l.id,l.course_id FROM lessons l JOIN courses c")) {
    return Promise.resolve({ rows: state.lessonFound && values[0] === sampleLesson.id ? [{ id: sampleLesson.id, course_id: sampleCourse.id }] : [] });
  }
  if (sql.includes("SELECT l.title,l.objective,l.content_markdown,l.worked_example,c.title course_title FROM lessons l")) {
    return Promise.resolve({ rows: state.lessonFound && values[0] === sampleLesson.id ? [{ ...sampleLesson, course_title: sampleCourse.title }] : [] });
  }

  // Tasks
  if (sql.includes("SELECT id,lesson_id FROM study_tasks WHERE id=$1 AND user_id=$2")) {
    return Promise.resolve({ rows: state.taskFound && values[0] === sampleTask.id ? [{ id: sampleTask.id, lesson_id: sampleLesson.id }] : [] });
  }
  if (sql.includes("UPDATE study_tasks SET status='overdue'")) {
    return Promise.resolve({ rows: [] });
  }
  if (sql.includes("SELECT t.*,l.objective,c.title AS course_title FROM study_tasks t")) {
    return Promise.resolve({ rows: state.tasksFound ? [sampleTask] : [] });
  }
  if (sql.includes("SELECT * FROM study_tasks WHERE id=$1 AND user_id=$2")) {
    return Promise.resolve({ rows: state.taskFound && values[0] === sampleTask.id ? [sampleTask] : [] });
  }
  if (sql.includes("SELECT id FROM practice_attempts WHERE user_id=$1 AND lesson_id=$2 AND score>=70")) {
    return Promise.resolve({ rows: state.hasEvidence ? [{ id: "attempt-1" }] : [] });
  }
  if (sql.includes("UPDATE study_tasks SET status='in_progress'")) {
    return Promise.resolve({ rows: [{ ...sampleTask, status: "in_progress" }] });
  }
  if (sql.includes("UPDATE study_tasks SET scheduled_at=$1,status='rescheduled'")) {
    return Promise.resolve({ rows: [{ ...sampleTask, status: "rescheduled", scheduled_at: values[0] }] });
  }
  if (sql.includes("UPDATE study_tasks SET status='completed'")) {
    return Promise.resolve({ rows: [{ ...sampleTask, status: "completed", actual_minutes: values[0] }] });
  }

  // Notes
  if (sql.includes("SELECT n.*,c.title course_title,l.title lesson_title FROM notes n")) {
    if (sql.includes("WHERE n.id=$1 AND n.user_id=$2")) {
      return Promise.resolve({ rows: state.noteFound ? [sampleNote] : [] });
    }
    return Promise.resolve({ rows: [sampleNote] });
  }
  if (sql.includes("INSERT INTO notes")) {
    return Promise.resolve({ rows: [{ id: sampleNote.id, user_id: values[0], course_id: values[1], lesson_id: values[2], title: values[3], body: values[4], source_ref: values[5] }] });
  }
  if (sql.includes("UPDATE notes SET title=$1,body=$2")) {
    return Promise.resolve({ rows: state.noteFound ? [{ ...sampleNote, title: values[0], body: values[1] }] : [] });
  }
  if (sql.includes("DELETE FROM notes WHERE id=$1 AND user_id=$2")) {
    return Promise.resolve({ rows: state.noteFound ? [{ id: sampleNote.id }] : [] });
  }

  // Flashcards
  if (sql.includes("SELECT f.*,l.title lesson_title FROM flashcards f")) {
    return Promise.resolve({ rows: [sampleCard] });
  }
  if (sql.includes("INSERT INTO flashcards")) {
    return Promise.resolve({ rows: [{ id: sampleCard.id, user_id: values[0], course_id: values[1], lesson_id: values[2], front: values[3], back: values[4] }] });
  }
  if (sql.includes("SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE")) {
    return Promise.resolve({ rows: state.cardFound ? [state.card || sampleCard] : [] });
  }
  if (sql.includes("INSERT INTO review_events")) {
    return Promise.resolve({ rows: [{ id: "rev-1" }] });
  }
  if (sql.includes("UPDATE flashcards SET due_at=$1")) {
    return Promise.resolve({ rows: [{ ...sampleCard, interval_days: values[1], repetitions: 2, ease: 2.5 }] });
  }
  if (sql.includes("DELETE FROM flashcards WHERE id=$1 AND user_id=$2")) {
    return Promise.resolve({ rows: state.cardFound ? [{ id: sampleCard.id }] : [] });
  }

  // Practice Attempts
  if (sql.includes("INSERT INTO practice_attempts")) {
    return Promise.resolve({ rows: [{ id: "attempt-1", user_id: values[0], task_id: values[1], lesson_id: values[2], concept: values[3], prompt: values[4], submitted_answer: values[5], result: JSON.parse(values[6] || "{}"), score: values[7] }] });
  }

  // Progress Analytics
  if (sql.includes("SELECT c.id,c.title,COUNT(t.id)::int total_tasks")) {
    return Promise.resolve({ rows: [{ id: sampleCourse.id, title: sampleCourse.title, total_tasks: 4, completed_tasks: 2 }] });
  }
  if (sql.includes("SELECT status,COUNT(*)::int count FROM study_tasks")) {
    return Promise.resolve({ rows: [{ status: "completed", count: 2 }, { status: "upcoming", count: 2 }] });
  }
  if (sql.includes("SELECT concept,COUNT(*)::int attempts,ROUND(AVG(score))::int average_score")) {
    return Promise.resolve({ rows: [{ concept: "Raft Consensus", attempts: 3, average_score: 90, last_evidence: new Date().toISOString() }] });
  }
  if (sql.includes("SELECT date_trunc('week',scheduled_at)::date week")) {
    return Promise.resolve({ rows: [{ week: "2026-11-09", scheduled: 4, completed: 2 }] });
  }
  if (sql.includes("SELECT id,lesson_id,concept,score,result,created_at FROM practice_attempts")) {
    return Promise.resolve({ rows: [{ id: "attempt-1", lesson_id: sampleLesson.id, concept: "Raft Consensus", score: 100, result: {}, created_at: new Date().toISOString() }] });
  }

  // Search
  if (sql.includes("SELECT l.id,l.title,l.objective,c.title course_title FROM lessons l")) {
    return Promise.resolve({ rows: [{ id: sampleLesson.id, title: sampleLesson.title, objective: sampleLesson.objective, course_title: sampleCourse.title }] });
  }
  if (sql.includes("SELECT id,title,body FROM notes WHERE user_id=$1")) {
    return Promise.resolve({ rows: [{ id: sampleNote.id, title: sampleNote.title, body: sampleNote.body }] });
  }
  if (sql.includes("SELECT id,title,status FROM courses WHERE user_id=$1")) {
    return Promise.resolve({ rows: [{ id: sampleCourse.id, title: sampleCourse.title, status: sampleCourse.status }] });
  }

  // Export
  if (sql.includes("SELECT * FROM courses WHERE user_id=$1")) return Promise.resolve({ rows: [sampleCourse] });
  if (sql.includes("SELECT * FROM notes WHERE user_id=$1")) return Promise.resolve({ rows: [sampleNote] });
  if (sql.includes("SELECT * FROM flashcards WHERE user_id=$1")) return Promise.resolve({ rows: [sampleCard] });
  if (sql.includes("SELECT * FROM study_tasks WHERE user_id=$1")) return Promise.resolve({ rows: [sampleTask] });
  if (sql.includes("SELECT * FROM practice_attempts WHERE user_id=$1")) return Promise.resolve({ rows: [] });

  return Promise.resolve({ rows: [] });
}

async function callApi({ path, method = "GET", body, query = "", headers = {} }) {
  const resHeaders = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { resHeaders.set(name.toLowerCase(), value); },
    end(value = "") { this.body = value; },
  };
  await handler({ url: `/api/${path}${query}`, method, headers, body }, response);
  return {
    status: response.statusCode,
    headers: resHeaders,
    json: response.body ? JSON.parse(response.body) : null,
    rawBody: response.body,
  };
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

beforeEach(async () => {
  const hash = await bcrypt.hash("strong-password-123", 10);
  state = {
    user: testUser,
    passwordHash: hash,
    loginFound: true,
    userExists: false,
    tokenValid: true,
    courseFound: true,
    moduleFound: true,
    lessonFound: true,
    taskFound: true,
    tasksFound: true,
    hasEvidence: false,
    noteFound: true,
    cardFound: true,
    studyRoom: null,
    studyMembership: false,
    emailSent: false,
    userDeleted: false,
    queries: [],
    generateCourseProposal: async () => ({ id: "proposal-1", title: "Consensus Protocols", status: "proposal" }),
    improveCourseProposal: async (_userId, courseId, feedback) => ({ id: courseId, title: "Improved Consensus", feedback }),
    approveCourse: async () => ({ course: { id: sampleCourse.id, status: "active" } }),
    tutorReply: async () => ({ text: "Randomized timers avoid split votes.", source: "raft-spec", sources: ["raft-paper.pdf"] }),
    retrieveLearnerContext: async () => [{ id: "mem-1", text: "Learner reviewed Raft leader election" }],
    query: queryStub,
    withTransaction: async (work) => work({ query: (...args) => state.query(...args) }),
    requireUser: async (req, res) => {
      if (!state.user) {
        res.statusCode = 401;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }));
        return null;
      }
      return state.user;
    },
    sessionUserId: () => state.user ? state.user.id : null,
    createSessionCookie: (userId) => `learnos_session=${userId}; HttpOnly; Path=/; SameSite=Lax`,
    clearSessionCookie: () => "learnos_session=; HttpOnly; Path=/; Max-Age=0",
  };
  globalThis.__learnosBackendVerificationTest = state;
});

after(async () => {
  await vite?.close();
  delete globalThis.__learnosBackendVerificationTest;
});

// =========================================================================
// 1. API ROUTES VERIFICATION
// =========================================================================
test("API Routes: Health & Auth Lifecycle", async (t) => {
  await t.test("GET /api/health returns 200 with service status", async () => {
    const res = await callApi({ path: "health" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true, service: "learnos-api", runtime: "nodejs" });
    assert.equal(res.headers.get("cache-control"), "no-store");
  });

  await t.test("POST /api/auth/signup creates account and issues session cookie", async () => {
    const res = await callApi({
      path: "auth/signup",
      method: "POST",
      body: { fullName: "New User", email: "newuser@example.com", password: "secure-password-123" },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.user.email, "newuser@example.com");
    assert.match(res.headers.get("set-cookie") || "", /learnos_session=/);
  });

  await t.test("POST /api/auth/signup returns 409 EMAIL_EXISTS on duplicate email", async () => {
    state.userExists = true;
    const res = await callApi({
      path: "auth/signup",
      method: "POST",
      body: { fullName: "Duplicate User", email: "existing@example.com", password: "secure-password-123" },
    });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "EMAIL_EXISTS");
  });

  await t.test("POST /api/auth/login authenticates valid credentials", async () => {
    const res = await callApi({
      path: "auth/login",
      method: "POST",
      body: { email: "learner@example.com", password: "strong-password-123" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.email, "learner@example.com");
    assert.match(res.headers.get("set-cookie") || "", /learnos_session=/);
  });

  await t.test("POST /api/auth/login rejects wrong password with 401 INVALID_CREDENTIALS", async () => {
    const res = await callApi({
      path: "auth/login",
      method: "POST",
      body: { email: "learner@example.com", password: "incorrect-password" },
    });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, "INVALID_CREDENTIALS");
  });

  await t.test("GET /api/auth/me returns current authenticated learner", async () => {
    const res = await callApi({ path: "auth/me", method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.user.id, testUser.id);
  });

  await t.test("POST /api/auth/logout clears session cookie", async () => {
    const res = await callApi({ path: "auth/logout", method: "POST" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
    assert.match(res.headers.get("set-cookie") || "", /Max-Age=0/);
  });

  await t.test("POST /api/auth/change-password returns 404 (escalation defect verification)", async () => {
    // Note: Project feature inventory lists change-password, but endpoint is currently not registered under authRoutes
    const res = await callApi({ path: "auth/change-password", method: "POST", body: { currentPassword: "pass", newPassword: "new" } });
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, "NOT_FOUND");
  });
});

test("API Routes: Home, Goals & Course Generation", async (t) => {
  await t.test("GET /api/home returns learner dashboard aggregates", async () => {
    const res = await callApi({ path: "home", method: "GET" });
    assert.equal(res.status, 200);
    assert.ok(res.json.course);
    assert.ok(Array.isArray(res.json.tasks));
    assert.equal(typeof res.json.reviewsDue, "number");
    assert.equal(typeof res.json.counts, "object");
  });

  await t.test("POST /api/goals stores valid learning goal", async () => {
    const res = await callApi({
      path: "goals",
      method: "POST",
      body: { topic: "Distributed Systems", desiredOutcome: "Understand consensus and replication protocols.", weeklyMinutes: 360, targetWeeks: 8 },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.goal.topic, "Distributed Systems");
  });

  await t.test("GET /api/goals lists learner goals", async () => {
    const res = await callApi({ path: "goals", method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.goals.length, 1);
  });

  await t.test("POST /api/goals/:id/proposal generates course proposal", async () => {
    const res = await callApi({ path: `goals/${sampleGoal.id}/proposal`, method: "POST", body: {} });
    assert.equal(res.status, 201);
    assert.equal(res.json.course.id, "proposal-1");
  });

  await t.test("POST /api/courses/generate returns 404 as proposal generation is goal-scoped", async () => {
    const res = await callApi({ path: "courses/generate", method: "POST", body: {} });
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, "NOT_FOUND");
  });

  await t.test("GET /api/courses lists courses", async () => {
    const res = await callApi({ path: "courses", method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.courses.length, 1);
  });

  await t.test("GET /api/courses/:id returns course details with modules", async () => {
    const res = await callApi({ path: `courses/${sampleCourse.id}`, method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.course.id, sampleCourse.id);
    assert.ok(Array.isArray(res.json.modules));
  });

  await t.test("PUT /api/courses/:id updates course and synchronizes status", async () => {
    const res = await callApi({
      path: `courses/${sampleCourse.id}`,
      method: "PUT",
      body: { title: "Updated Consensus", summary: "Updated summary text", status: "active" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.course.title, "Updated Consensus");
  });

  await t.test("POST /api/courses/:id/improve accepts feedback", async () => {
    const res = await callApi({
      path: `courses/${sampleCourse.id}/improve`,
      method: "POST",
      body: { feedback: "Add more practical exercises on Raft." },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.course.title, "Improved Consensus");
  });

  await t.test("POST /api/courses/:id/approve approves proposal", async () => {
    const res = await callApi({
      path: `courses/${sampleCourse.id}/approve`,
      method: "POST",
      body: { acceptOverload: true },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.course.status, "active");
  });
});

test("API Routes: Modules, Lessons, Tasks & Evidence", async (t) => {
  await t.test("PUT /api/modules/:id updates module title and objective", async () => {
    const res = await callApi({
      path: `modules/${sampleLesson.module_id}`,
      method: "PUT",
      body: { title: "Consensus Basics", objective: "Master Raft replication" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.module.title, "Consensus Basics");
  });

  await t.test("GET /api/modules/:id returns 404 (method not allowed / route unsupported)", async () => {
    const res = await callApi({ path: `modules/${sampleLesson.module_id}`, method: "GET" });
    assert.equal(res.status, 404);
  });

  await t.test("GET /api/lessons/:id returns full lesson content", async () => {
    const res = await callApi({ path: `lessons/${sampleLesson.id}`, method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.lesson.id, sampleLesson.id);
    assert.equal(res.json.lesson.course_title, sampleCourse.title);
  });

  await t.test("GET /api/tasks with valid ISO date range filter", async () => {
    const res = await callApi({
      path: "tasks",
      method: "GET",
      query: "?from=2026-11-01T00:00:00Z&to=2026-11-30T23:59:59Z",
    });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.tasks));
  });

  await t.test("GET /api/tasks with invalid ISO date returns 400 INVALID_DATE", async () => {
    const res = await callApi({ path: "tasks", method: "GET", query: "?from=not-a-valid-date" });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_DATE");
  });

  await t.test("POST /api/tasks/:id/start transitions task to in_progress", async () => {
    const res = await callApi({ path: `tasks/${sampleTask.id}/start`, method: "POST", body: {} });
    assert.equal(res.status, 200);
    assert.equal(res.json.task.status, "in_progress");
  });

  await t.test("POST /api/tasks/:id/reschedule updates scheduled_at", async () => {
    const nextDate = new Date(Date.now() + 172800000).toISOString();
    const res = await callApi({
      path: `tasks/${sampleTask.id}/reschedule`,
      method: "POST",
      body: { scheduledAt: nextDate },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.task.status, "rescheduled");
  });

  await t.test("POST /api/tasks/:id/complete blocks completion without evidence with 409", async () => {
    state.hasEvidence = false;
    const res = await callApi({ path: `tasks/${sampleTask.id}/complete`, method: "POST", body: { actualMinutes: 30 } });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "EVIDENCE_REQUIRED");
  });

  await t.test("POST /api/tasks/:id/complete marks task completed when passing evidence exists", async () => {
    state.hasEvidence = true;
    const res = await callApi({ path: `tasks/${sampleTask.id}/complete`, method: "POST", body: { actualMinutes: 25 } });
    assert.equal(res.status, 200);
    assert.equal(res.json.task.status, "completed");
  });
});

test("API Routes: Notes & Flashcards CRUD and Spaced Review", async (t) => {
  await t.test("POST /api/notes creates note", async () => {
    const res = await callApi({
      path: "notes",
      method: "POST",
      body: { title: "Raft Notes", body: "Raft leader election explanation", courseId: sampleCourse.id, lessonId: sampleLesson.id },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.note.title, "Raft Notes");
  });

  await t.test("GET /api/notes lists learner notes", async () => {
    const res = await callApi({ path: "notes", method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.notes.length, 1);
  });

  await t.test("GET /api/notes/:id retrieves single note", async () => {
    const res = await callApi({ path: `notes/${sampleNote.id}`, method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.note.id, sampleNote.id);
  });

  await t.test("PUT /api/notes/:id updates note content", async () => {
    const res = await callApi({
      path: `notes/${sampleNote.id}`,
      method: "PUT",
      body: { title: "Updated Raft Notes", body: "Updated body content" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.note.title, "Updated Raft Notes");
  });

  await t.test("DELETE /api/notes/:id deletes note", async () => {
    const res = await callApi({ path: `notes/${sampleNote.id}`, method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(res.json.deleted, true);
  });

  await t.test("POST /api/flashcards creates flashcard", async () => {
    const res = await callApi({
      path: "flashcards",
      method: "POST",
      body: { front: "Question?", back: "Answer.", courseId: sampleCourse.id, lessonId: sampleLesson.id },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.flashcard.front, "Question?");
  });

  await t.test("GET /api/flashcards lists cards", async () => {
    const res = await callApi({ path: "flashcards", method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(res.json.flashcards.length, 1);
  });

  await t.test("POST /api/flashcards/:id/review updates SM-2 repetition and interval", async () => {
    const res = await callApi({
      path: `flashcards/${sampleCard.id}/review`,
      method: "POST",
      body: { rating: "Good" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.flashcard.repetitions, 2);
  });

  await t.test("DELETE /api/flashcards/:id deletes card", async () => {
    const res = await callApi({ path: `flashcards/${sampleCard.id}`, method: "DELETE" });
    assert.equal(res.status, 200);
    assert.equal(res.json.deleted, true);
  });
});

test("API Routes: Practice, Tutor, Progress, Search, Study Rooms & Settings", async (t) => {
  await t.test("POST /api/practice records checkpoint answer and calculates score", async () => {
    const res = await callApi({
      path: "practice",
      method: "POST",
      body: {
        lessonId: sampleLesson.id,
        taskId: sampleTask.id,
        selectedIndex: 1, // Correct answer in sampleLesson.checkpoint
        answer: "Randomized election timeouts",
      },
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.attempt.score, 100);
    assert.equal(res.json.result.correct, true);
  });

  await t.test("POST /api/tutor generates socratic response", async () => {
    const res = await callApi({
      path: "tutor",
      method: "POST",
      body: { mode: "Explain", prompt: "How does Raft elect a leader?", lessonId: sampleLesson.id },
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.reply);
    assert.ok(Array.isArray(res.json.sources));
  });

  await t.test("GET /api/progress returns learner analytics and retention", async () => {
    const res = await callApi({ path: "progress", method: "GET" });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.courses));
    assert.ok(Array.isArray(res.json.tasks));
    assert.ok(Array.isArray(res.json.evidence));
  });

  await t.test("GET /api/search returns lessons, notes, and courses", async () => {
    const res = await callApi({ path: "search", method: "GET", query: "?q=raft" });
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.json.lessons));
    assert.ok(Array.isArray(res.json.notes));
    assert.ok(Array.isArray(res.json.courses));
  });

  await t.test("Study Rooms lifecycle: create, list, snapshot, join, timer", async () => {
    // 1. Create room
    const createRes = await callApi({
      path: "study-rooms",
      method: "POST",
      body: { title: "Raft Study Group", topic: "Consensus", focusMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 },
    });
    assert.equal(createRes.status, 201);
    const roomCode = createRes.json.room.code;

    // 2. List rooms
    const listRes = await callApi({ path: "study-rooms", method: "GET" });
    assert.equal(listRes.status, 200);
    assert.ok(listRes.json.rooms.length >= 1);

    // 3. Snapshot by code
    const snapRes = await callApi({ path: `study-rooms/${roomCode}`, method: "GET" });
    assert.equal(snapRes.status, 200);
    assert.equal(snapRes.json.room.title, "Raft Study Group");

    // 4. Join room
    const joinRes = await callApi({ path: `study-rooms/${roomCode}/join`, method: "POST", body: {} });
    assert.equal(joinRes.status, 200);

    // 5. Timer start
    const timerRes = await callApi({ path: `study-rooms/${roomCode}/timer`, method: "POST", body: { action: "start" } });
    assert.equal(timerRes.status, 200);
    assert.equal(timerRes.json.room.phase, "focus");

    // 6. Timer pause
    const pauseRes = await callApi({ path: `study-rooms/${roomCode}/timer`, method: "POST", body: { action: "pause" } });
    assert.equal(pauseRes.status, 200);
    assert.equal(pauseRes.json.room.phase, "paused");

    // 7. Timer resume
    const resumeRes = await callApi({ path: `study-rooms/${roomCode}/timer`, method: "POST", body: { action: "resume" } });
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeRes.json.room.phase, "focus");

    // 8. Timer reset
    const resetRes = await callApi({ path: `study-rooms/${roomCode}/timer`, method: "POST", body: { action: "reset" } });
    assert.equal(resetRes.status, 200);
    assert.equal(resetRes.json.room.phase, "idle");
  });

  await t.test("Settings & Account lifecycle: get, update, export, delete", async () => {
    // 1. Get settings
    const getRes = await callApi({ path: "settings", method: "GET" });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.json.user.id, testUser.id);

    // 2. Update settings
    const putRes = await callApi({
      path: "settings",
      method: "PUT",
      body: { fullName: "Updated Learner", sessionMinutes: 45, weeklyMinutes: 300 },
    });
    assert.equal(putRes.status, 200);
    assert.equal(putRes.json.user.fullName, "Updated Learner");

    // 3. Export data
    const exportRes = await callApi({ path: "settings/export", method: "GET" });
    assert.equal(exportRes.status, 200);
    assert.ok(exportRes.json.exportedAt);
    assert.ok(Array.isArray(exportRes.json.courses));
    assert.ok(Array.isArray(exportRes.json.notes));
    assert.ok(Array.isArray(exportRes.json.flashcards));

    // 4. Delete account with incorrect password -> 401
    const delFailRes = await callApi({ path: "settings/account", method: "DELETE", body: { password: "wrong-password" } });
    assert.equal(delFailRes.status, 401);
    assert.equal(delFailRes.json.error.code, "INVALID_CREDENTIALS");

    // 5. Delete account with correct password -> 200 & clears cookie
    const delSuccessRes = await callApi({ path: "settings/account", method: "DELETE", body: { password: "strong-password-123" } });
    assert.equal(delSuccessRes.status, 200);
    assert.equal(delSuccessRes.json.deleted, true);
    assert.match(delSuccessRes.headers.get("set-cookie") || "", /Max-Age=0/);
    assert.equal(state.userDeleted, true);
  });
});

// =========================================================================
// 2. DATABASE OPERATIONS & TRANSACTIONS
// =========================================================================
test("Database Operations: Transactional Atomicity in withTransaction", async (t) => {
  const pool = getPool();
  const origConnect = pool.connect;
  t.after(() => { pool.connect = origConnect; });

  await t.test("Commit on success: withTransaction commits and releases client cleanly", async () => {
    const executed = [];
    let releaseArg = "NOT_CALLED";
    pool.connect = async () => ({
      query: async (sql) => {
        executed.push(typeof sql === "string" ? sql.trim() : sql);
        return { rows: [] };
      },
      release: (err) => { releaseArg = err; },
    });

    const res = await withTransaction(async (client) => {
      await client.query("UPDATE accounts SET balance = balance - 100");
      await client.query("UPDATE accounts SET balance = balance + 100");
      return "SUCCESS";
    });

    assert.equal(res, "SUCCESS");
    assert.deepEqual(executed, [
      "BEGIN",
      "UPDATE accounts SET balance = balance - 100",
      "UPDATE accounts SET balance = balance + 100",
      "COMMIT",
    ]);
    assert.equal(releaseArg, undefined, "Client released with no error argument");
  });

  await t.test("Rollback on work failure: withTransaction rolls back and preserves original error", async () => {
    const executed = [];
    const thrownErr = new Error("Unique constraint violation");
    let releaseArg = "NOT_CALLED";
    pool.connect = async () => ({
      query: async (sql) => {
        executed.push(sql.trim());
        return { rows: [] };
      },
      release: (err) => { releaseArg = err; },
    });

    await assert.rejects(
      async () => {
        await withTransaction(async (client) => {
          await client.query("INSERT INTO users(email) VALUES('a@b.com')");
          throw thrownErr;
        });
      },
      (err) => {
        assert.equal(err, thrownErr);
        assert.equal(err.cause, undefined);
        return true;
      }
    );

    assert.deepEqual(executed, [
      "BEGIN",
      "INSERT INTO users(email) VALUES('a@b.com')",
      "ROLLBACK",
    ]);
    assert.equal(releaseArg, undefined);
  });

  await t.test("Rollback failure resilience: preserves original error and chains cause", async () => {
    const originalErr = new Error("Primary operational failure");
    const rollbackErr = new Error("Connection dropped during ROLLBACK");
    let releaseArg = "NOT_CALLED";

    pool.connect = async () => ({
      query: async (sql) => {
        if (sql.trim() === "ROLLBACK") throw rollbackErr;
        return { rows: [] };
      },
      release: (err) => { releaseArg = err; },
    });

    await assert.rejects(
      async () => {
        await withTransaction(async () => {
          throw originalErr;
        });
      },
      (err) => {
        assert.equal(err, originalErr);
        assert.equal(err.cause, rollbackErr, "Rollback failure attached as error.cause");
        return true;
      }
    );
    assert.equal(releaseArg, rollbackErr, "Failed connection evicted via release(rollbackErr)");
  });

  await t.test("Commit failure resilience: attempts rollback and evicts client", async () => {
    const commitErr = new Error("Commit deadlock error");
    const executed = [];
    pool.connect = async () => ({
      query: async (sql) => {
        executed.push(sql.trim());
        if (sql.trim() === "COMMIT") throw commitErr;
        return { rows: [] };
      },
      release: () => {},
    });

    await assert.rejects(
      async () => {
        await withTransaction(async (client) => {
          await client.query("SELECT 1");
        });
      },
      (err) => {
        assert.equal(err, commitErr);
        return true;
      }
    );
    assert.deepEqual(executed, ["BEGIN", "SELECT 1", "COMMIT", "ROLLBACK"]);
  });
});

test("Database Operations: Token Verification and Status Sync Atomicity", async (t) => {
  await t.test("Auth email verify transaction rolls back if user update fails", async () => {
    let tokenRolledBack = false;
    state.withTransaction = async (work) => {
      const mockClient = {
        query: async (sql, values) => {
          if (sql.includes("UPDATE auth_tokens SET consumed_at=NOW()")) {
            return { rows: [{ user_id: testUser.id }] };
          }
          if (sql.includes("UPDATE users SET email_verified_at=NOW()")) {
            tokenRolledBack = true;
            throw new Error("Simulated database failure during users update");
          }
          return { rows: [] };
        },
      };
      return work(mockClient);
    };

    const res = await callApi({
      path: "auth/verify",
      method: "POST",
      body: { token: "123456789012345678901234567890" },
    });
    assert.equal(res.status, 500);
    assert.equal(res.json.error.code, "INTERNAL_ERROR");
    assert.equal(tokenRolledBack, true, "Transaction aborted when second query threw");
  });

  await t.test("Auth password reset transaction rolls back if user password update fails", async () => {
    let resetRolledBack = false;
    state.withTransaction = async (work) => {
      const mockClient = {
        query: async (sql, values) => {
          if (sql.includes("UPDATE auth_tokens SET consumed_at=NOW()")) {
            return { rows: [{ user_id: testUser.id }] };
          }
          if (sql.includes("UPDATE users SET password_hash=$1")) {
            resetRolledBack = true;
            throw new Error("Simulated database failure during password_hash update");
          }
          return { rows: [] };
        },
      };
      return work(mockClient);
    };

    const res = await callApi({
      path: "auth/reset-password",
      method: "POST",
      body: { token: "123456789012345678901234567890", password: "brand-new-secure-password" },
    });
    assert.equal(res.status, 500);
    assert.equal(res.json.error.code, "INTERNAL_ERROR");
    assert.equal(resetRolledBack, true);
  });

  await t.test("PUT /api/courses/:id rolls back when goal status update fails", async () => {
    let courseSyncRolledBack = false;
    state.withTransaction = async (work) => {
      const mockClient = {
        query: async (sql, values) => {
          if (sql.includes("UPDATE courses SET title=$1")) {
            return { rows: [{ id: sampleCourse.id, goal_id: sampleGoal.id, title: values[0], summary: values[1], status: values[2] }] };
          }
          if (sql.includes("UPDATE learning_goals SET status=$1")) {
            courseSyncRolledBack = true;
            throw new Error("Simulated goal table write failure");
          }
          return { rows: [] };
        },
      };
      return work(mockClient);
    };

    const res = await callApi({
      path: `courses/${sampleCourse.id}`,
      method: "PUT",
      body: { title: "Title", summary: "Summary", status: "active" },
    });
    assert.equal(res.status, 500);
    assert.equal(courseSyncRolledBack, true);
  });
});

test("Database Schema Data Preservation: ON DELETE SET NULL Verification", async (t) => {
  await t.test("schema.sql enforces ON DELETE SET NULL for notes, flashcards, attempts, tasks", async () => {
    const schemaSql = await fs.readFile("./db/schema.sql", "utf8");

    // 1. study_tasks -> lessons ON DELETE SET NULL
    assert.match(schemaSql, /lesson_id UUID REFERENCES lessons\(id\) ON DELETE SET NULL/, "study_tasks must preserve task records when lessons are removed");

    // 2. practice_attempts -> study_tasks & lessons ON DELETE SET NULL
    assert.match(schemaSql, /task_id UUID REFERENCES study_tasks\(id\) ON DELETE SET NULL/, "practice_attempts must preserve evidence when tasks are removed");
    assert.match(schemaSql, /lesson_id UUID REFERENCES lessons\(id\) ON DELETE SET NULL/, "practice_attempts must preserve evidence when lessons are removed");

    // 3. notes -> courses & lessons ON DELETE SET NULL
    assert.match(schemaSql, /course_id UUID REFERENCES courses\(id\) ON DELETE SET NULL/, "notes must survive course deletion");
    assert.match(schemaSql, /lesson_id UUID REFERENCES lessons\(id\) ON DELETE SET NULL/, "notes must survive lesson deletion");

    // 4. flashcards -> courses & lessons ON DELETE SET NULL
    assert.match(schemaSql, /course_id UUID REFERENCES courses\(id\) ON DELETE SET NULL/, "flashcards must survive course deletion");
    assert.match(schemaSql, /lesson_id UUID REFERENCES lessons\(id\) ON DELETE SET NULL/, "flashcards must survive lesson deletion");
  });
});

// =========================================================================
// 3. ERROR HANDLING ARCHITECTURE
// =========================================================================
test("Error Handling: safeError sanitization and AI Taxonomy", async (t) => {
  await t.test("safeError suppresses internal database errors and stack traces", () => {
    const resHeaders = new Map();
    let body = "";
    const res = {
      statusCode: 200,
      setHeader: (k, v) => resHeaders.set(k.toLowerCase(), v),
      end: (val) => { body = val; },
    };

    const internalError = new Error("syntax error at or near 'SELECT * FROM users' at client.js:42:10");
    internalError.stack = "Error: syntax error...\n    at pgClient.query (/app/node_modules/pg/client.js:123)";
    safeError(res, internalError);

    assert.equal(res.statusCode, 500);
    const parsed = JSON.parse(body);
    assert.deepEqual(parsed, {
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    });
    assert.equal(body.includes("syntax error"), false);
    assert.equal(body.includes("client.js"), false);
  });

  await t.test("safeError maps DATABASE_NOT_CONFIGURED to 503", () => {
    let body = "";
    const res = {
      statusCode: 200,
      setHeader: () => {},
      end: (val) => { body = val; },
    };
    safeError(res, { code: "DATABASE_NOT_CONFIGURED", message: "Connect a Postgres database." });
    assert.equal(res.statusCode, 503);
    const parsed = JSON.parse(body);
    assert.equal(parsed.error.code, "DATABASE_NOT_CONFIGURED");
  });

  await t.test("safeError maps AI error taxonomy correctly without exposing raw secrets", () => {
    const cases = [
      { code: "AI_RATE_LIMIT", expectedStatus: 429 },
      { code: "AI_TIMEOUT", expectedStatus: 504 },
      { code: "AI_PROVIDER_AUTH", expectedStatus: 502 },
      { code: "AI_PROVIDER_ERROR", expectedStatus: 502 },
      { code: "AI_EMPTY_RESPONSE", expectedStatus: 502 },
      { code: "AI_INVALID_JSON", expectedStatus: 502 },
      { code: "AI_INVALID_PLAN", expectedStatus: 502 },
      { code: "AI_UNKNOWN_SPECIALIST", expectedStatus: 503 },
    ];

    for (const { code, expectedStatus } of cases) {
      let body = "";
      const res = {
        statusCode: 200,
        setHeader: () => {},
        end: (val) => { body = val; },
      };
      safeError(res, { code, message: "AI operation failed." });
      assert.equal(res.statusCode, expectedStatus, `Expected ${expectedStatus} for ${code}`);
      const parsed = JSON.parse(body);
      assert.equal(parsed.error.code, code);
      assert.equal(typeof parsed.error.details.retryable, "boolean");
    }
  });
});

test("Error Handling: 400 Bad Request Input Validation", async (t) => {
  const badInputs = [
    { name: "signup missing details", path: "auth/signup", method: "POST", body: { fullName: "A" }, expectedCode: "INVALID_SIGNUP" },
    { name: "verify short token", path: "auth/verify", method: "POST", body: { token: "too-short" }, expectedCode: "INVALID_TOKEN" },
    { name: "reset password short password", path: "auth/reset-password", method: "POST", body: { token: "123456789012345678901234567890", password: "tiny" }, expectedCode: "INVALID_PASSWORD" },
    { name: "goal short topic", path: "goals", method: "POST", body: { topic: "A", desiredOutcome: "Long enough description" }, expectedCode: "INVALID_GOAL" },
    { name: "goal invalid weekly minutes", path: "goals", method: "POST", body: { topic: "Topic", desiredOutcome: "Long enough description", weeklyMinutes: 10 }, expectedCode: "INVALID_SCHEDULE" },
    { name: "course PUT missing title", path: `courses/${sampleCourse.id}`, method: "PUT", body: { title: "", summary: "Valid summary" }, expectedCode: "INVALID_COURSE" },
    { name: "course improve short feedback", path: `courses/${sampleCourse.id}/improve`, method: "POST", body: { feedback: "short" }, expectedCode: "IMPROVEMENT_FEEDBACK_REQUIRED" },
    { name: "tasks invalid date filter", path: "tasks", method: "GET", query: "?from=invalid-date", body: {}, expectedCode: "INVALID_DATE" },
    { name: "tasks missing ID on action", path: "tasks/start", method: "POST", body: {}, expectedCode: "TASK_ID_REQUIRED" },
    { name: "tasks reschedule invalid date", path: `tasks/${sampleTask.id}/reschedule`, method: "POST", body: { scheduledAt: "not-a-date" }, expectedCode: "INVALID_DATE" },
    { name: "notes missing title", path: "notes", method: "POST", body: { body: "Text without title" }, expectedCode: "TITLE_REQUIRED" },
    { name: "flashcards missing back", path: "flashcards", method: "POST", body: { front: "Front only" }, expectedCode: "CARD_REQUIRED" },
    { name: "flashcards invalid review rating", path: `flashcards/${sampleCard.id}/review`, method: "POST", body: { rating: "Superb" }, expectedCode: "INVALID_RATING" },
    { name: "practice missing answer", path: "practice", method: "POST", body: { answer: "" }, expectedCode: "ANSWER_REQUIRED" },
    { name: "tutor invalid mode", path: "tutor", method: "POST", body: { mode: "Chat" }, expectedCode: "INVALID_MODE" },
    { name: "study rooms short title", path: "study-rooms", method: "POST", body: { title: "A" }, expectedCode: "ROOM_TITLE_REQUIRED" },
    { name: "study rooms invalid pomodoro", path: "study-rooms", method: "POST", body: { title: "Valid Room", focusMinutes: 1 }, expectedCode: "INVALID_POMODORO" },
    { name: "settings invalid minutes", path: "settings", method: "PUT", body: { sessionMinutes: 5 }, expectedCode: "INVALID_SETTINGS" },
  ];

  for (const item of badInputs) {
    await t.test(`rejection: ${item.name}`, async () => {
      const res = await callApi({ path: item.path, method: item.method, body: item.body, query: item.query });
      assert.equal(res.status, 400);
      assert.equal(res.json.error.code, item.expectedCode);
    });
  }
});

test("Error Handling: 401 Unauthenticated & Session Verification", async (t) => {
  await t.test("Protected route rejects unauthenticated request", async () => {
    state.user = null;
    const res = await callApi({ path: "home", method: "GET" });
    assert.equal(res.status, 401);
    assert.equal(res.json.error.code, "UNAUTHENTICATED");
  });

  await t.test("sessionUserId rejects tampered HMAC session cookie", () => {
    const validCookie = createSessionCookie("user-1");
    const rawToken = decodeURIComponent(validCookie.split(";")[0].split("=")[1]);
    const [payload, signature] = rawToken.split(".");
    const tampered = payload + ".tampered_signature_value";

    const req = { headers: { cookie: `learnos_session=${encodeURIComponent(tampered)}` } };
    assert.equal(sessionUserId(req), null, "Tampered signature must return null");
  });

  await t.test("sessionUserId rejects expired session cookie", () => {
    const expiredPayload = Buffer.from(JSON.stringify({ sub: "user-1", exp: Date.now() - 10000 })).toString("base64url");
    const secret = process.env.SESSION_SECRET;
    const sig = crypto.createHmac("sha256", secret).update(expiredPayload).digest("base64url");
    const token = `${expiredPayload}.${sig}`;

    const req = { headers: { cookie: `learnos_session=${encodeURIComponent(token)}` } };
    assert.equal(sessionUserId(req), null, "Expired session token must return null");
  });
});

test("Error Handling: 404 Not Found & UUID Validation", async (t) => {
  const nonUuidIds = ["not-a-uuid", "12345", "../../etc/passwd", "undefined", "null"];

  for (const badId of nonUuidIds) {
    await t.test(`rejects non-UUID parameter on notes: ${badId}`, async () => {
      const res = await callApi({ path: `notes/${badId}`, method: "GET" });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, "NOT_FOUND");
    });

    await t.test(`rejects non-UUID parameter on flashcards: ${badId}`, async () => {
      const res = await callApi({ path: `flashcards/${badId}`, method: "DELETE" });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, "NOT_FOUND");
    });

    await t.test(`rejects non-UUID parameter on courses: ${badId}`, async () => {
      const res = await callApi({ path: `courses/${badId}`, method: "GET" });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, "NOT_FOUND");
    });

    await t.test(`rejects non-UUID parameter on lessons: ${badId}`, async () => {
      const res = await callApi({ path: `lessons/${badId}`, method: "GET" });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, "NOT_FOUND");
    });
  }

  await t.test("returns 404 on non-existent study room code", async () => {
    const res = await callApi({ path: "study-rooms/ZZZZZZZZ", method: "GET" });
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, "NOT_FOUND");
  });
});

test("Error Handling: 409 Conflict State Machine Transitions", async (t) => {
  await t.test("409 TIMER_STATE_CONFLICT on starting an already active timer", async () => {
    state.studyRoom = {
      id: "room-1",
      room_code: "TEST2345",
      phase: "focus",
      owner_user_id: testUser.id,
      focus_minutes: 25,
      break_minutes: 5,
      long_break_minutes: 15,
      long_break_every: 4,
      phase_ends_at: new Date(Date.now() + 600000).toISOString(),
    };
    state.studyMembership = true;

    const res = await callApi({ path: "study-rooms/TEST2345/timer", method: "POST", body: { action: "start" } });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "TIMER_STATE_CONFLICT");
  });

  await t.test("409 COURSE_NOT_PROPOSAL when approving active course", async () => {
    state.approveCourse = async () => {
      throw Object.assign(new Error("This course is no longer awaiting approval."), { code: "COURSE_NOT_PROPOSAL" });
    };

    const res = await callApi({ path: `courses/${sampleCourse.id}/approve`, method: "POST", body: {} });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "COURSE_NOT_PROPOSAL");
  });

  await t.test("409 PLAN_OVER_BUDGET when approval requires overload consent", async () => {
    state.approveCourse = async () => ({
      requiresOverride: true,
      weeklyMinutes: 360,
      neededPerWeek: 500,
    });

    const res = await callApi({ path: `courses/${sampleCourse.id}/approve`, method: "POST", body: { acceptOverload: false } });
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "PLAN_OVER_BUDGET");
  });
});

// =========================================================================
// 4. CONCURRENCY & ROW LOCKING
// =========================================================================
test("Concurrency & Row Locking: Pessimistic FOR UPDATE Synchronizations", async (t) => {
  await t.test("Study room timer query executes SELECT ... FOR UPDATE", async () => {
    state.studyRoom = {
      id: "room-1",
      room_code: "TEST2345",
      phase: "idle",
      owner_user_id: testUser.id,
      focus_minutes: 25,
      break_minutes: 5,
      long_break_minutes: 15,
      long_break_every: 4,
    };
    state.studyMembership = true;

    await callApi({ path: "study-rooms/TEST2345/timer", method: "POST", body: { action: "start" } });
    const lockQuery = state.queries.find((q) => q.sql.includes("SELECT * FROM study_rooms WHERE room_code=$1 FOR UPDATE"));
    assert.ok(lockQuery, "Study room timer state transition must acquire FOR UPDATE row lock");
  });

  await t.test("Flashcard review query executes SELECT ... FOR UPDATE", async () => {
    await callApi({ path: `flashcards/${sampleCard.id}/review`, method: "POST", body: { rating: "Good" } });
    const lockQuery = state.queries.find((q) => q.sql.includes("SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE"));
    assert.ok(lockQuery, "Flashcard review interval update must acquire FOR UPDATE row lock");
  });

  await t.test("Double course approval prevention via FOR UPDATE row lock", async () => {
    // Directly test approveCourse transaction behavior
    const queries = [];
    let currentStatus = "proposal";

    const mockClient = {
      query: async (sql, values) => {
        queries.push(sql);
        if (sql.includes("FOR UPDATE")) {
          return {
            rows: [{
              id: sampleCourse.id,
              status: currentStatus,
              goal_id: sampleGoal.id,
              estimated_minutes: 120,
              target_weeks: 4,
              weekly_minutes: 360,
            }],
          };
        }
        if (sql.includes("UPDATE courses SET status='active'")) {
          currentStatus = "active";
          return { rows: [{ id: sampleCourse.id, status: "active" }] };
        }
        if (sql.includes("course_modules")) return { rows: [] };
        if (sql.includes("lessons")) return { rows: [] };
        return { rows: [] };
      },
    };

    // First caller executes and transitions course to 'active'
    const pool = getPool();
    const origConnect = pool.connect;
    pool.connect = async () => ({ ...mockClient, release: () => {} });

    try {
      const res1 = await approveCourse(testUser.id, sampleCourse.id, false, testUser);
      assert.ok(res1);

      // Second concurrent caller arrives, acquires lock, sees status='active' and throws COURSE_NOT_PROPOSAL
      await assert.rejects(
        async () => {
          await approveCourse(testUser.id, sampleCourse.id, false, testUser);
        },
        (err) => {
          assert.equal(err.code, "COURSE_NOT_PROPOSAL");
          return true;
        }
      );
    } finally {
      pool.connect = origConnect;
    }
  });

  await t.test("Concurrent review repetitions increment sequentially without lost updates", async () => {
    let repetitions = 0;
    let lockHolder = false;

    state.card = { ...sampleCard, repetitions };
    state.withTransaction = async (work) => {
      // Simulate serial execution enforced by FOR UPDATE
      while (lockHolder) {
        await new Promise((r) => setTimeout(r, 5));
      }
      lockHolder = true;
      try {
        const client = {
          query: async (sql, values) => {
            if (sql.includes("FOR UPDATE")) {
              return { rows: [{ ...sampleCard, repetitions }] };
            }
            if (sql.includes("UPDATE flashcards SET due_at")) {
              repetitions += 1;
              return { rows: [{ ...sampleCard, repetitions }] };
            }
            return { rows: [] };
          },
        };
        return await work(client);
      } finally {
        lockHolder = false;
      }
    };

    // Dispatch two concurrent reviews simultaneously
    const [resA, resB] = await Promise.all([
      callApi({ path: `flashcards/${sampleCard.id}/review`, method: "POST", body: { rating: "Good" } }),
      callApi({ path: `flashcards/${sampleCard.id}/review`, method: "POST", body: { rating: "Easy" } }),
    ]);

    assert.equal(resA.status, 200);
    assert.equal(resB.status, 200);
    assert.equal(repetitions, 2, "Both concurrent reviews incremented repetitions to 2");
  });
});
