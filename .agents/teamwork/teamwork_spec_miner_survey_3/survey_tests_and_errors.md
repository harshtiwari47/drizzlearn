# Backend Test Infrastructure & Error Handling Survey

**Date**: 2026-11-11  
**Project**: Drizzlearn (formerly LearnOS)  
**Investigated by**: Test & Error Spec Miner  
**Working Directory**: `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_spec_miner_survey_3\`

---

## Executive Summary

A comprehensive investigation was conducted into the test infrastructure and error handling architecture of the Drizzlearn backend.
- **Baseline Test Execution**: `node --test` currently executes **98 tests across 5 test files with 0 failures** in ~3.5 seconds.
- **Test Runner & Mocking Strategy**: Built-in Node.js test runner (`node:test`, `node:assert/strict`) integrated with Vite SSR (`createServer` with custom `mockPlugin`) to load server modules (`api/[...path].js`, `server/*.js`) in hermetic in-memory test harnesses without requiring external PostgreSQL or NVIDIA API services.
- **Centralized Error Architecture**: The API router (`api/[...path].js`) wraps request handling in a centralized `try/catch` dispatcher that maps typed errors (`error.status`, `error.code`) and delegates to `safeError(res, error)` in `server/http.js`.
- **Sanitization & Safety**: All uncaught server/database errors are sanitized to `500 INTERNAL_ERROR` ("The request could not be completed.") without leaking stack traces or SQL details. AI provider authentication errors (401/403) are sanitized to `502 AI_PROVIDER_AUTH` without leaking secrets or upstream responses.
- **Identified Coverage Gaps**: While existing tests verify core happy paths and several validation errors, significant gaps exist in authentication flows (login with wrong credentials, password reset completion, logout cookie invalidation), course approval overload gating, task rescheduling/starting, notes/cards course-lesson mismatch validation, study room timer concurrency conflict states, and database failure resilience under load.

---

## 1. Test Suite Infrastructure

### 1.1 Test Runner & Configuration
- **Command**: `npm test` or `node --test`
- **Configuration** in `package.json`:
  ```json
  "scripts": {
    "test": "node --test"
  }
  ```
- **Module Format**: ESM (`"type": "module"` in `package.json`).
- **Assertion Framework**: Node.js standard `node:assert/strict`.
- **Baseline Execution Metrics**:
  - Tests: 98 passing
  - Suites: 0 (subtests used via `t.test`)
  - Failures: 0
  - Duration: ~3.5 seconds

### 1.2 Inventory of Existing Test Files

| File | Lines | Tests / Subtests | Scope & Purpose | Mocking Technique |
|---|---|---|---|---|
| `tests/api.test.js` | 96 | 21 | Health endpoint, signup validation, token/password length checks, protected route 401 gating, unconfigured DB 503 check | Direct call to `handler(req, res)` with mock request/response objects |
| `tests/api-authenticated.test.js` | 386 | 26 | Authenticated CRUD operations across goals, notes, flashcards, study rooms, pomodoro timer, practice attempts, tasks, AI tutor, settings, and search | Vite SSR (`createServer`) with `mockPlugin` resolving `\0learnos-test:*` mocks for `db`, `auth`, `email`, `plans`, `ai`, `retrieval` |
| `tests/ai.test.js` | 202 | 10 | NVIDIA AI planning, specialist agents (curriculum, lesson, assessment), upstream 429 retries, timeout/deadlines, self-repair loop, citation stripping, unconfigured state | Vite SSR, `installFetch` mocking `globalThis.fetch`, `withEnvironment` injecting temporary env vars |
| `tests/retrieval.test.js` | 28 | 2 | PostgreSQL Full-Text Search (`ts_rank`, `to_tsvector`, `to_tsquery`) across learner-owned notes, lessons, and practice attempts | Vite SSR with mocked `server/db.js` returning sample rows and capturing executed SQL |
| `tests/ui-render.test.js` | 185 | 39 | React SSR rendering of `src/App.jsx`, first-run empty states, absence of fictional demo seed data, localStorage migration (`v1` to `v2`), CSS regression checks | `react-dom/server` (`renderToStaticMarkup`), mock `localStorage`/`sessionStorage`/`window` |

### 1.3 Test Helpers & Harness Mechanisms
1. **`callApi({ path, method, body, headers, query })`**:
   - Synthesizes an HTTP request object `{ url: /api/... , method, headers, body }`.
   - Synthesizes an HTTP response object `{ statusCode: 200, setHeader(name, value), end(value) }`.
   - Parses the JSON response body and exposes `{ status, headers, json }`.
2. **Vite SSR Module Interception (`mockPlugin`)**:
   - Intercepts imports from `../server/db.js`, `../server/auth.js`, `../server/email.js`, `../server/plan-service.js`, `../server/ai.js`, and `../server/retrieval.js`.
   - Redirects to synthetic modules backed by `globalThis.__learnosApiTest`.
   - Allows tests to verify SQL query generation, simulate database rows, stub auth sessions, and spy on email delivery without external services.
3. **`withEnvironment(values, work)`**:
   - Temporarily alters `process.env` keys (`NVIDIA_API_KEY`, `NVIDIA_REQUEST_BUDGET_MS`, etc.) and reliably restores previous values in a `finally` block.
4. **`installFetch(t, handler)`**:
   - Monkeypatches `globalThis.fetch` for testing HTTP API calls, auto-restores in `t.after()`.

---

## 2. Backend Error Handling Architecture

### 2.1 Centralized Error Handling Pipeline

The error handling pipeline follows a strict multi-layer architecture:

```
[ Incoming HTTP Request ]
          │
          ▼
   [ handler(req, res) ] in api/[...path].js
          │
     try { await route(req, res); }
          │
     catch(error)
          ├──► if (error?.status) ──────► sendError(res, error.status, error.code, error.message)
          ├──► if (error?.code === "COURSE_NOT_PROPOSAL") ──► sendError(res, 409, error.code, error.message)
          └──► fallback ────────────────► safeError(res, error) in server/http.js
                                                ├──► DATABASE_NOT_CONFIGURED ─► 503
                                                ├──► AI_* errors ────────────► 429 / 502 / 503 / 504
                                                └──► Uncaught / DB errors ────► 500 INTERNAL_ERROR (Sanitized)
```

### 2.2 Error Payload Standard
Every error response is serialized using `sendError(res, status, code, message, details)`:
```json
{
  "error": {
    "code": "UPPER_SNAKE_CASE_CODE",
    "message": "User-friendly, non-leaking explanation.",
    "details": { ... }
  }
}
```
All responses set:
- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: no-store`

### 2.3 Status Code & Error Code Taxonomy

| HTTP Status | Error Code | Source / Trigger | Details / Payload |
|---|---|---|---|
| **400 Bad Request** | `INVALID_JSON` | `bodyOf(req)` failed `JSON.parse` | N/A |
| **400 Bad Request** | `INVALID_SIGNUP` | Name < 2 chars, invalid email format, password < 10 or > 200 chars | Validation message |
| **400 Bad Request** | `INVALID_TOKEN` | Token < 20 chars, consumed, or expired in verify / reset | `"This verification link is invalid or expired."` |
| **400 Bad Request** | `INVALID_PASSWORD` | Reset password length < 10 or > 200 chars | `"Use a password between 10 and 200 characters."` |
| **400 Bad Request** | `ROOM_TITLE_REQUIRED` | Study room title < 2 characters | `"Give your room a name with at least two characters."` |
| **400 Bad Request** | `INVALID_POMODORO` | Focus (5-90), break (3-30), long break (5-60), longBreakEvery (2-8) invalid | `"Choose valid focus, break, and long break durations."` |
| **400 Bad Request** | `INVALID_TIMER_ACTION` | Timer action not in `[start, pause, resume, reset, skip]` | `"Choose a valid shared timer action."` |
| **400 Bad Request** | `INVALID_GOAL` | Topic < 2 chars or outcome < 8 chars | `"Add a topic and describe the outcome you want to reach."` |
| **400 Bad Request** | `INVALID_SCHEDULE` | Goal weekly minutes < 30 or > 2400 | `"Weekly study time must be between 30 and 2400 minutes."` |
| **400 Bad Request** | `INVALID_DURATION` | Goal target weeks not null and not between 1 and 104 | `"Choose a duration between 1 and 104 weeks."` |
| **400 Bad Request** | `INVALID_COURSE` | Course title or summary empty on update | `"Course title and outcome are required."` |
| **400 Bad Request** | `IMPROVEMENT_FEEDBACK_REQUIRED`| Feedback < 8 characters | `"Describe what you want to improve in at least eight characters."` |
| **400 Bad Request** | `TASK_ID_REQUIRED` | Task action called without task ID | `"Provide a task ID."` |
| **400 Bad Request** | `INVALID_DATE` | Task reschedule `scheduledAt` missing or `Number.isNaN(Date.parse)` | `"Choose a valid date and time."` |
| **400 Bad Request** | `TITLE_REQUIRED` | Note title empty or whitespace-only | `"Give your note a title."` |
| **400 Bad Request** | `COURSE_LESSON_MISMATCH` | Note or flashcard lesson does not belong to specified course | `"The selected lesson is not part of that course."` |
| **400 Bad Request** | `CARD_REQUIRED` | Flashcard front or back empty | `"Add both a prompt and an answer."` |
| **400 Bad Request** | `INVALID_RATING` | Flashcard review rating not in `[Again, Hard, Good, Easy]` | `"Choose Again, Hard, Good, or Easy."` |
| **400 Bad Request** | `ANSWER_REQUIRED` | Practice checkpoint submission answer empty | `"Submit an answer to save evidence."` |
| **400 Bad Request** | `TASK_LESSON_MISMATCH` | Practice submission task and lesson do not match | `"The task and lesson do not match."` |
| **400 Bad Request** | `INVALID_MODE` | Tutor mode not in `[Explain, Hint, Quiz me, Review my work]` | `"Choose a tutor mode."` |
| **400 Bad Request** | `INVALID_SETTINGS` | Name < 2 chars, session not in 15-240, weekly not in 30-2400 | `"Check your name and study budget values."` |
| **401 Unauthorized** | `UNAUTHENTICATED` | Missing session cookie, invalid HMAC, expired session, or user deleted | `"Sign in to continue."` or `"Your session is no longer valid."` |
| **401 Unauthorized** | `INVALID_CREDENTIALS` | Login password mismatch, user not found, or account delete password mismatch | `"Email or password is incorrect."` or `"Password confirmation did not match."` |
| **404 Not Found** | `NOT_FOUND` | Unknown route, or resource not found / not owned (User, Goal, Course, Module, Lesson, Task, Note, Flashcard, Study room) | `"<Resource> was not found."` |
| **405 Method Not Allowed** | `METHOD_NOT_ALLOWED` | HTTP verb not permitted on route | `{ details: { allowed: [...] } }` |
| **409 Conflict** | `EMAIL_EXISTS` | Signup attempted with email already registered | `"An account already uses this email address."` |
| **409 Conflict** | `TIMER_STATE_CONFLICT` | Invalid timer state transitions (e.g. start while running, pause while paused, skip while idle) | State-specific conflict message |
| **409 Conflict** | `PLAN_OVER_BUDGET` | Course weekly minutes exceed learner budget and `acceptOverload` is false | `{ details: { requiresOverride: true, weeklyMinutes, neededPerWeek } }` |
| **409 Conflict** | `COURSE_NOT_PROPOSAL` | Course approve or improve called on course not in `'proposal'` status | `"This proposal was already approved or is no longer available."` |
| **409 Conflict** | `EVIDENCE_REQUIRED` | Task completion attempted before passing lesson checkpoint (`score >= 70`) | `"Pass the lesson checkpoint before completing this task."` |
| **429 Too Many Requests** | `AI_RATE_LIMIT` | NVIDIA provider rate limiting | `{ details: { retryable: true/false } }` |
| **500 Internal Server Error**| `INTERNAL_ERROR` | Uncaught exceptions, DB query syntax/connection failures | `"The request could not be completed."` (Sanitized) |
| **502 Bad Gateway** | `AI_PROVIDER_ERROR` | Upstream AI 5xx or invalid HTTP response | `{ details: { retryable: true/false } }` |
| **502 Bad Gateway** | `AI_PROVIDER_AUTH` | Upstream AI 401/403 credentials error | Sanitized error, secrets hidden |
| **502 Bad Gateway** | `AI_PROVIDER_RESPONSE`| Upstream AI returned non-JSON / unreadable body | `{ details: { retryable: true } }` |
| **502 Bad Gateway** | `AI_EMPTY_RESPONSE` | Upstream AI returned empty text | `{ details: { retryable: true } }` |
| **502 Bad Gateway** | `AI_INVALID_JSON` | Upstream AI completion could not be parsed as JSON | `{ details: { retryable: true } }` |
| **502 Bad Gateway** | `AI_INVALID_PLAN` | AI generated plan violates schema (modules < 3 or > 8, lessons < 1 or > 8, duplicate modules, etc.) | `{ details: { retryable: true } }` |
| **502 Bad Gateway** | `AI_INVALID_LESSON` | AI lesson missing objective, explanation < 40 chars, or example < 20 chars | `{ details: { retryable: true } }` |
| **502 Bad Gateway** | `AI_INVALID_CHECKPOINT` | AI checkpoint options < 2 or > 5, invalid answerIndex, or missing explanation | `{ details: { retryable: true } }` |
| **502 Bad Gateway** | `AI_INVALID_PREREQUISITE`| AI module/lesson prerequisite contains cycle or forward reference | `{ details: { retryable: true } }` |
| **503 Service Unavailable** | `DATABASE_NOT_CONFIGURED` | `DATABASE_URL` environment variable is missing | `"Database is not configured. Connect a Postgres database..."` |
| **503 Service Unavailable** | `AI_NOT_CONFIGURED` | `NVIDIA_API_KEY` (and `AI_API_KEY`) is missing | Actionable error message, `{ retryable: false }` |
| **504 Gateway Timeout** | `AI_TIMEOUT` | AI provider request exceeded wall-clock budget (shared deadline) | `{ details: { retryable: false } }` |

---

## 3. Concurrency & Data Integrity Architecture

### 3.1 Database Transactions (`withTransaction`)
- Implemented in `server/db.js`:
  ```js
  export async function withTransaction(work) {
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  ```
- Guarantees complete rollback of partially written entities on error.
- Verified in `tests/ai.test.js`: when AI generation or persistence fails, 0 database mutations occur and transactions rollback cleanly.

### 3.2 Row-Level Locking (`FOR UPDATE`)
To avoid race conditions and state corruption under concurrent requests:
1. **Study Room Synchronization (`SELECT * FROM study_rooms WHERE room_code=$1 FOR UPDATE`)**:
   - Multiple users in the same room issuing simultaneous timer commands (`start`, `pause`, `resume`, `skip`) or joining concurrently are serialized.
   - Timer phase advance is calculated deterministically on the locked snapshot.
2. **Flashcard Spaced Repetition (`SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE`)**:
   - Prevents duplicate review events or corrupted interval calculations from concurrent clicks.
3. **Course Approval (`SELECT c.*, ... FROM courses c ... WHERE c.id=$1 AND c.user_id=$2 FOR UPDATE`)**:
   - Ensures an approval request locks the course row, checks `status === 'proposal'`, and transitions atomically to `'active'`.
   - Prevents duplicate generation of `study_tasks`.
4. **Course Improvement (`SELECT id, status FROM courses WHERE id=$1 AND user_id=$2 FOR UPDATE`)**:
   - Prevents modifying or approving a proposal while an improvement rewrite is occurring.

### 3.3 Atomic Constraints & Multi-Tenant Scoping
- **Atomic Signup**: `INSERT INTO users ... ON CONFLICT(email) DO NOTHING RETURNING ...` avoids race conditions between simultaneous signups with the same email.
- **Atomic Room Membership**: `INSERT INTO study_room_members ... ON CONFLICT(room_id, user_id) DO UPDATE SET last_seen_at=NOW()`.
- **Tenant Isolation**: Every select, update, and delete in `api/[...path].js` enforces `user_id = $1` or joins to parent course owned by user. Cross-tenant access yields `404 NOT_FOUND`.

---

## 4. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|---|---|---|---|---|---|---|
| 1 | System | Health Check | Verifies serverless runtime status | `GET /api/health` | 200 `{ ok: true, service: "learnos-api", runtime: "nodejs" }` | None | `api/[...path].js:150` |
| 2 | Auth | Learner Signup | Immediate account creation & session cookie (no email confirmation needed) | `POST /api/auth/signup` with `{ fullName, email, password }` | 201 `{ user }` with `Set-Cookie: learnos_session=...` | 400 `INVALID_SIGNUP`, 409 `EMAIL_EXISTS`, 503 `DATABASE_NOT_CONFIGURED` | `api/[...path].js:23-30` |
| 3 | Auth | Learner Login | Authenticates with bcrypt password verification | `POST /api/auth/login` with `{ email, password }` | 200 `{ user }` with `Set-Cookie` | 401 `INVALID_CREDENTIALS`, 503 `DATABASE_NOT_CONFIGURED` | `api/[...path].js:31-36` |
| 4 | Auth | Learner Logout | Clears session cookie | `POST /api/auth/logout` | 200 `{ ok: true }` with cleared cookie | None | `api/[...path].js:37` |
| 5 | Auth | Session Verification | Returns active user profile from session cookie | `GET /api/auth/me` with session cookie | 200 `{ user }` | 401 `UNAUTHENTICATED` | `api/[...path].js:38` |
| 6 | Auth | Email Verification | Consumes verification token | `POST /api/auth/verify` with `{ token }` | 200 `{ verified: true }` | 400 `INVALID_TOKEN` (< 20 chars or consumed/expired) | `api/[...path].js:39-45` |
| 7 | Auth | Password Reset Request | Issues 1-hour reset token and emails link | `POST /api/auth/forgot-password` with `{ email }` | 200 `{ ok: true, message: "..." }` | Silent success on missing email (enumeration prevention) | `api/[...path].js:46-50` |
| 8 | Auth | Password Reset Submission | Updates password hash using valid reset token | `POST /api/auth/reset-password` with `{ token, password }` | 200 `{ ok: true }` | 400 `INVALID_PASSWORD`, 400 `INVALID_TOKEN` | `api/[...path].js:51-58` |
| 9 | Dashboard | Home Summary | Aggregates active course, due tasks, reviews due, progress counts | `GET /api/home` (authenticated) | 200 `{ course, tasks, reviewsDue, counts, recentUnderstanding }` | 401 `UNAUTHENTICATED` | `api/[...path].js:62-79` |
| 10 | Goals | Goal Creation | Stores learning goal with validation on duration & schedule | `POST /api/goals` with `{ topic, desiredOutcome, currentLevel, weeklyMinutes, targetWeeks, targetDate }` | 201 `{ goal }` | 400 `INVALID_GOAL`, 400 `INVALID_SCHEDULE`, 400 `INVALID_DURATION` | `api/[...path].js:202-211` |
| 11 | Goals | List Goals | Returns learner's learning goals | `GET /api/goals` | 200 `{ goals }` | 401 `UNAUTHENTICATED` | `api/[...path].js:201` |
| 12 | Courses | Generate Proposal | Triggers multi-agent AI course planning pipeline | `POST /api/goals/:id/proposal` | 201 `{ course }` with feasibility analysis | 404 `NOT_FOUND` (Goal), 502/503/504 AI errors | `api/[...path].js:212` |
| 13 | Courses | Approve Course | Activates proposal and schedules `study_tasks` across study days | `POST /api/courses/:id/approve` with `{ acceptOverload }` | 200 `{ approved: true, tasksCreated, modules }` | 404 `NOT_FOUND`, 409 `PLAN_OVER_BUDGET`, 409 `COURSE_NOT_PROPOSAL` | `api/[...path].js:222` |
| 14 | Courses | Improve Proposal | Re-runs AI plan generation with learner feedback and history | `POST /api/courses/:id/improve` with `{ feedback }` | 200 `{ course }` | 400 `IMPROVEMENT_FEEDBACK_REQUIRED`, 404 `NOT_FOUND` | `api/[...path].js:223` |
| 15 | Courses | Course List | Lists courses with computed module, lesson, and completed task counts | `GET /api/courses` | 200 `{ courses }` | 401 `UNAUTHENTICATED` | `api/[...path].js:217-221` |
| 16 | Courses | Course Details | Retrieves course with aggregated modules and nested lessons | `GET /api/courses/:id` | 200 `{ course, modules }` | 404 `NOT_FOUND` | `api/[...path].js:224` |
| 17 | Courses | Course Update | Updates title, summary, or status | `PUT /api/courses/:id` with `{ title, summary, status }` | 200 `{ course }` | 400 `INVALID_COURSE`, 404 `NOT_FOUND` | `api/[...path].js:225` |
| 18 | Modules | Module Update | Updates module title and objective | `PUT /api/modules/:id` with `{ title, objective }` | 200 `{ module }` | 404 `NOT_FOUND` | `api/[...path].js:228` |
| 19 | Lessons | Lesson Details | Retrieves lesson with course title, module title, checkpoint | `GET /api/lessons/:id` | 200 `{ lesson }` | 404 `NOT_FOUND` | `api/[...path].js:230` |
| 20 | Tasks | Task List | Returns tasks with auto-overdue transition and date filtering | `GET /api/tasks?from=...&to=...` | 200 `{ tasks }` | 401 `UNAUTHENTICATED` | `api/[...path].js:233` |
| 21 | Tasks | Start Task | Sets task status to `'in_progress'` and marks `started_at` | `POST /api/tasks/:id/start` | 200 `{ task }` | 400 `TASK_ID_REQUIRED`, 404 `NOT_FOUND` | `api/[...path].js:238` |
| 22 | Tasks | Reschedule Task | Updates task `scheduled_at` and sets status to `'rescheduled'` | `POST /api/tasks/:id/reschedule` with `{ scheduledAt }` | 200 `{ task }` | 400 `INVALID_DATE`, 404 `NOT_FOUND` | `api/[...path].js:239` |
| 23 | Tasks | Complete Task | Completes task, requiring passing checkpoint evidence for lessons | `POST /api/tasks/:id/complete` with `{ actualMinutes }` | 200 `{ task }` | 404 `NOT_FOUND`, 409 `EVIDENCE_REQUIRED` | `api/[...path].js:240-242` |
| 24 | Notes | List Notes | Lists notes with course and lesson associations | `GET /api/notes` | 200 `{ notes }` | 401 `UNAUTHENTICATED` | `api/[...path].js:246` |
| 25 | Notes | Create Note | Creates note linked to course/lesson | `POST /api/notes` with `{ title, body, courseId, lessonId, sourceRef }` | 201 `{ note }` | 400 `TITLE_REQUIRED`, 400 `COURSE_LESSON_MISMATCH`, 404 `NOT_FOUND` | `api/[...path].js:247` |
| 26 | Notes | Update Note | Updates note title and body | `PUT /api/notes/:id` with `{ title, body }` | 200 `{ note }` | 404 `NOT_FOUND` | `api/[...path].js:248` |
| 27 | Notes | Delete Note | Deletes learner note | `DELETE /api/notes/:id` | 200 `{ deleted: true }` | 404 `NOT_FOUND` | `api/[...path].js:249` |
| 28 | Flashcards | List Flashcards | Returns cards ordered by due date | `GET /api/flashcards` | 200 `{ flashcards }` | 401 `UNAUTHENTICATED` | `api/[...path].js:253` |
| 29 | Flashcards | Create Flashcard | Stores front and back of card | `POST /api/flashcards` with `{ front, back, courseId, lessonId }` | 201 `{ flashcard }` | 400 `CARD_REQUIRED`, 400 `COURSE_LESSON_MISMATCH`, 404 `NOT_FOUND` | `api/[...path].js:254` |
| 30 | Flashcards | Spaced Review | Updates card interval/ease/repetitions and records review event | `POST /api/flashcards/:id/review` with `{ rating: Again\|Hard\|Good\|Easy }` | 200 `{ flashcard }` | 400 `INVALID_RATING`, 404 `NOT_FOUND` | `api/[...path].js:255` |
| 31 | Flashcards | Delete Flashcard | Deletes flashcard | `DELETE /api/flashcards/:id` | 200 `{ deleted: true }` | 404 `NOT_FOUND` | `api/[...path].js:256` |
| 32 | Practice | Submit Evidence | Evaluates checkpoint answer, scores 100 or 0, logs attempt | `POST /api/practice` with `{ answer, lessonId, taskId, selectedIndex, concept, prompt }` | 201 `{ attempt, result }` | 400 `ANSWER_REQUIRED`, 400 `TASK_LESSON_MISMATCH`, 404 `NOT_FOUND` | `api/[...path].js:259` |
| 33 | AI Tutor | Tutor Assistant | Grounded AI tutor with 4 modes (Explain, Hint, Quiz me, Review) | `POST /api/tutor` with `{ mode, prompt, lessonId, attempt }` | 200 `{ reply, source, sources }` | 400 `INVALID_MODE`, 404 `NOT_FOUND`, 502/503/504 AI errors | `api/[...path].js:261` |
| 34 | Progress | Progress Analytics | Aggregates task completion, evidence by concept, weekly metrics | `GET /api/progress` | 200 `{ courses, tasks, evidence, weekly, attempts }` | 401 `UNAUTHENTICATED` | `api/[...path].js:263-269` |
| 35 | Search | Full Search | ILIKE search across lessons, notes, and courses | `GET /api/search?q=...` | 200 `{ lessons, notes, courses }` | 401 `UNAUTHENTICATED` | `api/[...path].js:271` |
| 36 | Rooms | List Study Rooms | Lists rooms user participates in with online presence indicators | `GET /api/study-rooms` | 200 `{ rooms }` | 401 `UNAUTHENTICATED` | `api/[...path].js:156-162` |
| 37 | Rooms | Create Room | Creates room with Pomodoro settings and 8-character base-32 code | `POST /api/study-rooms` with `{ title, topic, focusMinutes, breakMinutes, longBreakMinutes, longBreakEvery }` | 201 `{ room }` | 400 `ROOM_TITLE_REQUIRED`, 400 `INVALID_POMODORO` | `api/[...path].js:163-175` |
| 38 | Rooms | Get Room State | Fetches synchronized timer and participant state (members only) | `GET /api/study-rooms/:code` | 200 `{ room }` | 404 `NOT_FOUND` (non-members or unknown code) | `api/[...path].js:176-181` |
| 39 | Rooms | Join Room | Joins study room by code | `POST /api/study-rooms/:code/join` | 200 `{ room }` | 404 `NOT_FOUND` | `api/[...path].js:187-190` |
| 40 | Rooms | Pomodoro Action | State machine transition for timer: start, pause, resume, reset, skip | `POST /api/study-rooms/:code/timer` with `{ action }` | 200 `{ room }` | 400 `INVALID_TIMER_ACTION`, 404 `NOT_FOUND`, 409 `TIMER_STATE_CONFLICT` | `api/[...path].js:191-196` |
| 41 | Settings | Get Profile | Returns learner profile & study budget | `GET /api/settings` | 200 `{ user }` | 401 `UNAUTHENTICATED` | `api/[...path].js:276` |
| 42 | Settings | Update Profile | Updates study preferences, schedule, and notifications | `PUT /api/settings` with `{ fullName, timezone, preferredStudyDays, sessionMinutes, weeklyMinutes, notificationPreferences }` | 200 `{ user }` | 400 `INVALID_SETTINGS` | `api/[...path].js:277` |
| 43 | Settings | Data Export | Exports all learner data across 7 tables as JSON | `GET /api/settings/export` | 200 `{ exportedAt, user, goals, courses, notes, flashcards, tasks, practiceAttempts }` | 401 `UNAUTHENTICATED` | `api/[...path].js:274` |
| 44 | Settings | Account Deletion | Deletes user account and cascades to all learner data | `DELETE /api/settings/account` with `{ password }` | 200 `{ deleted: true }` with cleared cookie | 401 `INVALID_CREDENTIALS` | `api/[...path].js:275` |

---

## 5. Edge Cases & Observed Behaviors

| # | Feature | Input / Condition | Observed Behavior |
|---|---|---|---|
| 1 | Request Body | Malformed JSON string `"{ "` | Returns 400 `INVALID_JSON` with `"Request body must be valid JSON."` |
| 2 | Auth Signup | Name with 1 character `"H"` | Returns 400 `INVALID_SIGNUP` with `"Enter your name (at least 2 characters)."` |
| 3 | Auth Signup | Password with 9 characters `"123456789"` | Returns 400 `INVALID_SIGNUP` with `"Use a password between 10 and 200 characters."` |
| 4 | Auth Signup | Valid signup details | Returns 201, sets `email_verified_at = NOW()` immediately without sending email, sets session cookie |
| 5 | Auth Login | Wrong password or nonexistent email | Returns 401 `INVALID_CREDENTIALS` with `"Email or password is incorrect."` (Constant-time bcrypt prevents timing enumeration) |
| 6 | Auth Login | Unconfigured database (`DATABASE_URL` deleted) | Returns 503 `DATABASE_NOT_CONFIGURED` |
| 7 | Auth Verify | Token < 20 characters | Returns 400 `INVALID_TOKEN` with `"This verification link is invalid or expired."` |
| 8 | Auth Reset Password | Password < 10 characters | Returns 400 `INVALID_PASSWORD` with `"Use a password between 10 and 200 characters."` |
| 9 | Auth Session Cookie | Tampered signature or expired session timestamp | `sessionUserId(req)` returns `null`, route rejects with 401 `UNAUTHENTICATED` |
| 10 | Route Security | Protected routes called without session cookie | Returns 401 `UNAUTHENTICATED` across 15+ verified endpoints |
| 11 | Study Room Access | Non-member requests `GET /api/study-rooms/:code` | Returns 404 `NOT_FOUND` (prevents code enumeration and snooping) |
| 12 | Study Room Code | Code with lowercase characters | Upper-cased automatically before lookup (`code.toUpperCase()`) |
| 13 | Study Room Timer | Call `start` action when timer is already in `focus` phase | Returns 409 `TIMER_STATE_CONFLICT` with `"Only a ready room can start a focus session."` |
| 14 | Study Room Timer | Call `pause` action when timer is in `idle` phase | Returns 409 `TIMER_STATE_CONFLICT` with `"The running timer cannot be paused right now."` |
| 15 | Study Room Timer | Call `resume` action when timer is in `focus` phase | Returns 409 `TIMER_STATE_CONFLICT` with `"The room timer is not paused."` |
| 16 | Study Room Timer | Call `skip` action when timer is in `idle` phase | Returns 409 `TIMER_STATE_CONFLICT` with `"Start a focus session before skipping a phase."` |
| 17 | Study Room Timer | Phase expiration occurs while idle | `advanceRoom` transitions focus to short_break or long_break after `long_break_every` completed focuses; caps iteration at 100 to avoid runaway loops |
| 18 | Flashcard Spaced Repetition | Rating `Again` | Resets `interval_days = 0`, sets `due_at` to +10 minutes, decreases `ease` by 0.2 (minimum 1.30) |
| 19 | Flashcard Spaced Repetition | Rating `Easy` | Sets `interval_days = max(3, round(interval * 2.5))`, increases `ease` by 0.15 |
| 20 | Flashcard Spaced Repetition | Invalid rating `"Maybe"` | Returns 400 `INVALID_RATING` with `"Choose Again, Hard, Good, or Easy."` |
| 21 | Task Completion | Task linked to a lesson without passing checkpoint evidence (`score >= 70`) | Returns 409 `EVIDENCE_REQUIRED` with `"Pass the lesson checkpoint before completing this task."` |
| 22 | Task Completion | Task not linked to a lesson (`lesson_id` is null) | Completes immediately without checking checkpoint evidence |
| 23 | Task Completion | `actualMinutes` not provided in body | Defaults to `ownedTask.estimated_minutes` |
| 24 | Task Reschedule | Malformed timestamp string `"not-a-date"` | Returns 400 `INVALID_DATE` with `"Choose a valid date and time."` |
| 25 | Note Creation | Missing title | Returns 400 `TITLE_REQUIRED` with `"Give your note a title."` |
| 26 | Note Creation | `lessonId` belongs to Course A, but `courseId` specified as Course B | Returns 400 `COURSE_LESSON_MISMATCH` with `"The selected lesson is not part of that course."` |
| 27 | Note Creation | Valid `lessonId` provided without `courseId` | Automatically resolves and stores `course_id` from lesson |
| 28 | Practice Checkpoint | Multiple choice checkpoint answer with matching `selectedIndex === answerIndex` | Returns 201 with `{ correct: true }` and `score: 100` |
| 29 | Practice Checkpoint | Multiple choice checkpoint answer with non-matching `selectedIndex` | Returns 201 with `{ correct: false }` and `score: 0` |
| 30 | Practice Checkpoint | Checkpoint on lesson without options | Stores answer with `score: null` and advice to use AI Tutor |
| 31 | AI Course Generation | Unconfigured `NVIDIA_API_KEY` | Rejects with typed `AI_NOT_CONFIGURED` without modifying goals or proposals |
| 32 | AI Course Generation | Upstream 429 rate limit | Retries once after `Retry-After` header delay and recovers |
| 33 | AI Course Generation | Upstream request exceeds time budget | Aborted by shared deadline, rejects with `AI_TIMEOUT` before Vercel 60s maxDuration |
| 34 | AI Course Generation | Stalled specialist or repair request | Shared deadline terminates pipeline, rejects with `AI_TIMEOUT` within ~2.5s |
| 35 | AI Course Generation | Invalid structure returned by model | Exactly one self-repair request triggered; if still invalid, fails with `AI_INVALID_PLAN` |
| 36 | AI Course Generation | Upstream 401/403 provider authentication error | Rejects with safe `AI_PROVIDER_AUTH` without leaking response body or secret keys |
| 37 | AI Course Generation | AI response cites ungrounded / invented source IDs | `sourceList` cross-references IDs against retrieved learner memory and strips invalid references |
| 38 | AI Tutor | Output includes URLs or hallucinations | RegEx strips all URLs and non-retrieved citations |
| 39 | AI Tutor | Unsupported tutor mode `"Write an essay"` | Returns 400 `INVALID_MODE` with `"Choose a tutor mode."` |
| 40 | Retrieval | Empty query or punctuation-only query `" !!! "` | Skips database execution completely and returns empty array `[]` |
| 41 | Settings Update | `sessionMinutes: 10` (< 15) or `weeklyMinutes: 99999` (> 2400) | Returns 400 `INVALID_SETTINGS` with `"Check your name and study budget values."` |
| 42 | Account Deletion | Incorrect password confirmation | Returns 401 `INVALID_CREDENTIALS` with `"Password confirmation did not match."` |
| 43 | Account Deletion | Correct password confirmation | Deletes user row (ON DELETE CASCADE cascades across all 8 user tables) and clears session cookie |
| 44 | Database Error | PostgreSQL query throws uncaught exception | `safeError` sanitizes to 500 `INTERNAL_ERROR` ("The request could not be completed.") |

---

## 6. Coverage Gap Analysis & Recommended Verification Targets

The existing test suite provides strong regression coverage for happy paths and mock-based validation, but several critical production scenarios remain uncovered by automated tests.

### Priority 1: High Impact (Security & Data Integrity)
1. **Full Authentication Cycle**:
   - `POST /api/auth/login`: Valid credentials test verifying `Set-Cookie` generation and `userDto` payload.
   - `POST /api/auth/login`: Invalid password verification (401 `INVALID_CREDENTIALS`).
   - `POST /api/auth/login`: Non-existent user email verification (401 `INVALID_CREDENTIALS`).
   - `POST /api/auth/logout`: Verification that session cookie is deleted (`Max-Age=0`).
   - `GET /api/auth/me`: Verification that valid cookie returns authenticated user.
   - `POST /api/auth/signup`: Duplicate email registration returning 409 `EMAIL_EXISTS`.
   - `POST /api/auth/verify`: Valid verification token consumption and DB timestamp update.
   - `POST /api/auth/reset-password`: Valid password reset consuming token and updating bcrypt hash.
2. **Account Deletion Flow**:
   - `DELETE /api/settings/account`: Successful deletion with valid password and cascade verification.
   - `DELETE /api/settings/account`: Rejection with wrong password (401 `INVALID_CREDENTIALS`).

### Priority 2: Core Course & Learning Workflows
1. **Course Approval Gating & Overload**:
   - `POST /api/courses/:id/approve` when weekly study required > budget:
     - Rejection with 409 `PLAN_OVER_BUDGET` when `acceptOverload: false`.
     - Acceptance and task generation when `acceptOverload: true`.
   - Double-approval rejection: Calling approve on an already approved course returning 409 `COURSE_NOT_PROPOSAL`.
2. **Course & Lesson Fetching**:
   - `GET /api/courses/:id`: Detailed view with nested modules and lessons.
   - `PUT /api/courses/:id`: Editing title and summary.
   - `PUT /api/modules/:id`: Editing module title and objective.
   - `GET /api/lessons/:id`: Fetching individual lesson details.
3. **Task State Lifecycle**:
   - `POST /api/tasks/:id/start`: Transition from upcoming to `in_progress`.
   - `POST /api/tasks/:id/reschedule`: Successful rescheduling with valid timestamp.
   - `GET /api/tasks`: Auto-overdue status update for tasks older than 1 day.

### Priority 3: Cross-Entity Validation & Spaced Repetition
1. **Mismatch Validations**:
   - `POST /api/notes` with mismatched `courseId` and `lessonId` (400 `COURSE_LESSON_MISMATCH`).
   - `POST /api/flashcards` with mismatched `courseId` and `lessonId` (400 `COURSE_LESSON_MISMATCH`).
   - `POST /api/practice` with mismatched `taskId` and `lessonId` (400 `TASK_LESSON_MISMATCH`).
2. **Spaced Repetition Algorithm Variants**:
   - Rating `Again` (due in 10 mins, interval 0).
   - Rating `Hard` (1.2x interval).
   - Rating `Easy` (2.5x interval, min 3 days, ease increase).

### Priority 4: Concurrency & Lock Verification
1. **Study Room Concurrency**:
   - Conflicting timer transitions: starting while running, pausing while paused, skipping while idle.
   - Simultaneous joins and timer transitions verifying row-level lock serialization (`FOR UPDATE`).
2. **Course Approval Concurrency**:
   - Simultaneous approval calls ensuring tasks are generated exactly once.
3. **Spaced Review Concurrency**:
   - Simultaneous review submissions on the same card verifying serialized updates.

---

## 7. Architectural Observations & Insights

1. **Pure Serverless Architecture**:
   `api/[...path].js` is a unified catch-all Vercel serverless function (`maxDuration: 60s`). This means cold-start performance is critical. Database connection pooling is configured with `max: 3` connections per instance, perfectly suited for Vercel's ephemeral function lifecycles.
2. **Deterministic Time Machine in Study Rooms**:
   Study rooms compute their phase on-demand via `advanceRoom(room, now)` during snapshot queries rather than relying on active background timers or cron jobs. This is a resilient, elegant serverless pattern.
3. **Zero-Seed Design**:
   Both database schema defaults and frontend rendering enforce that fresh accounts have 0 fictional demo items. All course and learning items must originate from learner goals and actions.
4. **Resilient AI Pipeline**:
   The multi-agent course planner splits the workload between curriculum, lesson content, and assessment specialists, validates schema rigor (acyclic prerequisites, bounded counts), and attempts self-repair before giving up, all within a strictly capped wall-clock budget.
