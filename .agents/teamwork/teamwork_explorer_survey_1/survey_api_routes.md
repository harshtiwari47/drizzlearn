# Comprehensive Backend Architecture and API Route Survey

## 1. Executive Summary & Architecture Overview

Drizzlearn's backend is implemented as a unified serverless API function deployed on Vercel at `api/[...path].js`, backed by PostgreSQL (`pg.Pool`), bcrypt password hashing, HMAC-SHA256 session management, and external integrations for NVIDIA AI (`server/ai.js`) and Resend email (`server/email.js`).

### Core Architectural Characteristics
- **Unified Catch-All Router**: Vercel routes all `/api/*` traffic via `vercel.json` (`api/[...path].js` with `maxDuration: 60`) into a single handler.
- **Pure Node.js HTTP Execution**: Written using native Node.js HTTP `req` and `res` objects (`sendJson`, `sendError`, `readJson` in `server/http.js`), eliminating heavy web framework overhead.
- **Strict Multi-Tenancy**: All learner operations require session authentication (except `/api/health` and public `/api/auth/*` routes) and enforce tenant data isolation by filtering by `user_id` or verifying ownership on foreign key relations.
- **Fail-Safe Service Boundaries**: External database and AI provider dependencies have explicit typed failure modes (`DATABASE_NOT_CONFIGURED` returning 503, `AI_*` returning 429/502/503/504) ensuring no partial states or leaked secrets.

---

## 2. Server Initialization & Runtime Environment

### 2.1 File Map & Responsibilities
- `api/[...path].js`: Top-level request routing, parameter extraction, route-level authorization, validation, and endpoint execution.
- `server/http.js`: HTTP serialization utilities (`sendJson`, `sendError`, `readJson`, `methodNotAllowed`, `safeError`).
- `server/auth.js`: Session creation, HMAC signing/verification, cookie generation/clearing, session extraction (`sessionUserId`, `requireUser`).
- `server/auth-validation.js`: Email normalization and signup schema validation (`validateSignup`).
- `server/db.js`: PostgreSQL connection pool lifecycle, `query()`, and `withTransaction()`.
- `server/plan-service.js`: Domain service for course proposal generation, AI plan normalization, proposal improvement, and schedule assignment.
- `server/ai.js`: Multi-agent LLM client with timeout budgets, retries, exponential backoff, JSON schema normalization, DAG prerequisite validation, and single-pass repair.
- `server/retrieval.js`: Learner-scoped PostgreSQL full-text search (`to_tsvector`, `to_tsquery`, `ts_rank`) over learner notes, lessons, and practice attempts.
- `server/email.js`: Resend API client with development preview logging fallback.
- `db/schema.sql`: PostgreSQL relational schema with 10 tables, cascades, and indexes.

### 2.2 Database Pool Management (`server/db.js`)
- Lazy initialization of `pg.Pool` on first `getPool()` call.
- Connection limits: `max: 3` connections per serverless container, `idleTimeoutMillis: 20000`, `connectionTimeoutMillis: 10000`.
- SSL enforcement: `{ rejectUnauthorized: false }` enabled when `NODE_ENV === "production"`.
- Fast failure check: If `DATABASE_URL` is absent, throws `DATABASE_NOT_CONFIGURED` immediately without hanging.
- Safe transactions: `withTransaction(async (client) => { ... })` guarantees `BEGIN`, `COMMIT`, and `ROLLBACK` on error, with release in a `finally` block.

---

## 3. Middleware, Request Handling, & Cross-Cutting Concerns

### 3.1 Routing Dispatcher Logic
In `api/[...path].js` (lines 148–154):
```javascript
const url = new URL(req.url, "http://localhost");
const parts = url.pathname.split("/").filter(Boolean).slice(1);
const methodName = req.method;
```
- `parts[0]` identifies the resource group (e.g., `health`, `auth`, `home`, `study-rooms`, `goals`, `courses`, `modules`, `lessons`, `tasks`, `notes`, `flashcards`, `practice`, `tutor`, `progress`, `search`, `settings`).
- `slice(1)` assumes `/api/...` prefix.

### 3.2 Response & Header Serialization (`server/http.js`)
All responses go through `sendJson(res, status, payload, headers)`:
- `Content-Type: application/json; charset=utf-8`
- `Cache-Control: no-store` (prevents caching of private learner data)
- Merges optional headers (e.g., `Set-Cookie`).

### 3.3 Body Parsing & JSON Validation
`bodyOf(req)` wraps `readJson(req)`:
- Handles object bodies, JSON strings, and streaming chunks.
- If JSON parsing fails (`SyntaxError`), throws `{ status: 400, code: "INVALID_JSON" }`.

### 3.4 Authentication & Session Management
- **Cookie Name**: `learnos_session`
- **Format**: `<base64url_payload>.<hmac_signature>`
- **Signing Algorithm**: HMAC-SHA256 with `SESSION_SECRET` (minimum 32 characters required).
- **Verification**: Constant-time verification using `crypto.timingSafeEqual`.
- **Payload**: `{ sub: userId, exp: timestamp }` (valid for 7 days = 604,800 seconds).
- **Cookie Attributes**: `HttpOnly; Path=/; SameSite=Lax; Max-Age=604800` (plus `; Secure` in production).
- **Session Revocation**: `clearSessionCookie()` sets `Max-Age=0`.

### 3.5 Global Error Handling & Safe Error Mapping
The top-level `handler(req, res)` catches all errors:
- If `error.status`: returns `sendError(res, error.status, error.code, error.message)`.
- If `error.code === "COURSE_NOT_PROPOSAL"`: returns 409 Conflict.
- Otherwise delegates to `safeError(res, error)`:
  - `DATABASE_NOT_CONFIGURED` -> 503 Service Unavailable
  - `AI_RATE_LIMIT` -> 429 Too Many Requests
  - `AI_TIMEOUT` -> 504 Gateway Timeout
  - Upstream AI errors (`AI_PROVIDER_AUTH`, `AI_PROVIDER_ERROR`, `AI_PROVIDER_RESPONSE`, `AI_EMPTY_RESPONSE`, `AI_INVALID_JSON`, `AI_INVALID_PLAN`, `AI_INVALID_LESSON`, `AI_INVALID_CHECKPOINT`, `AI_INVALID_PREREQUISITE`) -> 502 Bad Gateway
  - Other AI errors (`AI_NOT_CONFIGURED`, `AI_NETWORK_ERROR`) -> 503 Service Unavailable
  - Unhandled errors -> 500 `INTERNAL_ERROR` with generic user message `"The request could not be completed."` (logs error code/message on server console without leaking SQL or stack traces to client).

---

## 4. Complete API Route Catalog

### Summary Table

| Category | Route | Method | Auth | Body / Query | Success Status | Error Codes |
|---|---|---|---|---|---|---|
| **Health** | `/api/health` | ANY | Public | None | 200 | None |
| **Auth** | `/api/auth/signup` | POST | Public | `{ fullName, email, password }` | 201 | `INVALID_SIGNUP`, `EMAIL_EXISTS`, `INVALID_JSON` |
| **Auth** | `/api/auth/login` | POST | Public | `{ email, password }` | 200 | `INVALID_CREDENTIALS`, `INVALID_JSON` |
| **Auth** | `/api/auth/logout` | POST | Public | None | 200 | None |
| **Auth** | `/api/auth/me` | GET | Protected | Cookie | 200 | `UNAUTHENTICATED` |
| **Auth** | `/api/auth/verify` | POST | Public | `{ token }` | 200 | `INVALID_TOKEN`, `INVALID_JSON` |
| **Auth** | `/api/auth/forgot-password` | POST | Public | `{ email }` | 200 | `INVALID_JSON` |
| **Auth** | `/api/auth/reset-password` | POST | Public | `{ token, password }` | 200 | `INVALID_PASSWORD`, `INVALID_TOKEN`, `INVALID_JSON` |
| **Home** | `/api/home` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Study Rooms** | `/api/study-rooms` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Study Rooms** | `/api/study-rooms` | POST | Protected | `{ title, topic, focusMinutes, breakMinutes, longBreakMinutes, longBreakEvery }` | 201 | `ROOM_TITLE_REQUIRED`, `INVALID_POMODORO`, `INVALID_JSON` |
| **Study Rooms** | `/api/study-rooms/:code` | GET | Protected | `:code` (8 alphanumeric) | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Study Rooms** | `/api/study-rooms/:code` | POST | Protected | `:code` (8 alphanumeric) | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Study Rooms** | `/api/study-rooms/:code/join` | POST | Protected | `:code` (8 alphanumeric) | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Study Rooms** | `/api/study-rooms/:code/timer` | POST | Protected | `:code`, `{ action }` | 200 | `INVALID_TIMER_ACTION`, `TIMER_STATE_CONFLICT`, `NOT_FOUND` |
| **Goals** | `/api/goals` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Goals** | `/api/goals` | POST | Protected | `{ topic, desiredOutcome, currentLevel, purpose, weeklyMinutes, targetWeeks, targetDate }` | 201 | `INVALID_GOAL`, `INVALID_SCHEDULE`, `INVALID_DURATION` |
| **Goals** | `/api/goals/:id/proposal` | POST | Protected | `:id` (UUID) | 201 | `NOT_FOUND`, `AI_*` |
| **Goals** | `/api/goals/:id/approve` | POST | Protected | `:id` (UUID), `{ acceptOverload }` | 200 | `PLAN_OVER_BUDGET`, `COURSE_NOT_PROPOSAL`, `NOT_FOUND` |
| **Courses** | `/api/courses` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Courses** | `/api/courses/:id` | GET | Protected | `:id` (UUID) | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Courses** | `/api/courses/:id` | PUT | Protected | `:id`, `{ title, summary, status }` | 200 | `INVALID_COURSE`, `NOT_FOUND` |
| **Courses** | `/api/courses/:id/approve` | POST | Protected | `:id`, `{ acceptOverload }` | 200 | `PLAN_OVER_BUDGET`, `COURSE_NOT_PROPOSAL`, `NOT_FOUND` |
| **Courses** | `/api/courses/:id/improve` | POST | Protected | `:id`, `{ feedback }` | 200 | `IMPROVEMENT_FEEDBACK_REQUIRED`, `COURSE_NOT_PROPOSAL`, `NOT_FOUND`, `AI_*` |
| **Modules** | `/api/modules/:id` | PUT | Protected | `:id`, `{ title, objective }` | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Lessons** | `/api/lessons/:id` | GET | Protected | `:id` (UUID) | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Tasks** | `/api/tasks` | GET | Protected | Query: `from`, `to` (ISO dates) | 200 | `UNAUTHENTICATED` |
| **Tasks** | `/api/tasks/:id/:action` | POST | Protected | `:id`, `:action` (`start`, `reschedule`, `complete`) | 200 | `TASK_ID_REQUIRED`, `INVALID_DATE`, `EVIDENCE_REQUIRED`, `NOT_FOUND` |
| **Notes** | `/api/notes` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Notes** | `/api/notes` | POST | Protected | `{ title, body, courseId, lessonId, sourceRef }` | 201 | `TITLE_REQUIRED`, `COURSE_LESSON_MISMATCH`, `NOT_FOUND` |
| **Notes** | `/api/notes/:id` | PUT | Protected | `:id`, `{ title, body }` | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Notes** | `/api/notes/:id` | DELETE | Protected | `:id` | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Flashcards** | `/api/flashcards` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Flashcards** | `/api/flashcards` | POST | Protected | `{ front, back, courseId, lessonId }` | 201 | `CARD_REQUIRED`, `COURSE_LESSON_MISMATCH`, `NOT_FOUND` |
| **Flashcards** | `/api/flashcards/:id/review` | POST | Protected | `:id`, `{ rating: Again\|Hard\|Good\|Easy }` | 200 | `INVALID_RATING`, `NOT_FOUND` |
| **Flashcards** | `/api/flashcards/:id` | DELETE | Protected | `:id` | 200 | `NOT_FOUND`, `UNAUTHENTICATED` |
| **Practice** | `/api/practice` | POST | Protected | `{ answer, taskId, lessonId, selectedIndex, concept, prompt }` | 201 | `ANSWER_REQUIRED`, `TASK_LESSON_MISMATCH`, `NOT_FOUND` |
| **Tutor** | `/api/tutor` | POST | Protected | `{ mode, prompt, lessonId, attempt }` | 200 | `INVALID_MODE`, `NOT_FOUND`, `AI_*` |
| **Progress** | `/api/progress` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Search** | `/api/search` | GET | Protected | Query: `q` (<=100 chars) | 200 | `UNAUTHENTICATED` |
| **Settings** | `/api/settings` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Settings** | `/api/settings` | PUT | Protected | `{ fullName, timezone, preferredStudyDays, sessionMinutes, weeklyMinutes, notificationPreferences }` | 200 | `INVALID_SETTINGS`, `UNAUTHENTICATED` |
| **Settings** | `/api/settings/export` | GET | Protected | None | 200 | `UNAUTHENTICATED` |
| **Settings** | `/api/settings/account` | DELETE | Protected | `{ password }` | 200 | `INVALID_CREDENTIALS`, `UNAUTHENTICATED` |

---

## 5. Detailed Route Analysis by Domain

### 5.1 Authentication (`/api/auth/*`)
- **Signup (`POST /api/auth/signup`)**:
  - Validation: Full name (2..100 chars), valid email regex (`^[^\s@]+@[^\s@]+\.[^\s@]+$`), password (10..200 chars).
  - Storage: User created with `bcrypt.hash(password, 12)` and `email_verified_at = NOW()` (active immediately).
  - Returns `201 Created` with `user` DTO and `Set-Cookie`.
  - Conflict: Returns `409 EMAIL_EXISTS` on duplicate email via `ON CONFLICT(email) DO NOTHING`.
- **Login (`POST /api/auth/login`)**:
  - Validates credentials using `bcrypt.compare`.
  - Returns `200 OK` with user DTO and session cookie on match; `401 INVALID_CREDENTIALS` on mismatch.
- **Password Reset Flow**:
  - `forgot-password`: Generates 32-byte cryptographically random token, hashes with SHA-256 for DB storage (`auth_tokens`), expires in 1 hour. Sends link via Resend email client. Returns timing-safe uniform message to prevent user enumeration.
  - `reset-password`: Consumes unused token atomically, updates `users.password_hash`.

### 5.2 Home Overview (`GET /api/home`)
Executes 5 parallel queries returning a unified dashboard snapshot:
1. Active course details (status, current level, lesson count, completed tasks count).
2. Up to 8 study tasks prioritized by status (`in_progress` -> `due` -> `overdue` -> `upcoming`) then scheduled time.
3. Due flashcards count (`due_at <= NOW()`).
4. Aggregate totals (notes, flashcards, attempts, completed tasks, total tasks).
5. Mastery count: distinct concepts with score >= 70% in last 30 days.

### 5.3 Study Rooms & Shared Pomodoro (`/api/study-rooms/*`)
- **Room Code Format**: 8-character string from a 32-character base alphabet (`A-HJ-NP-Z2-9`, omitting confusing characters like 0, O, 1, I).
- **Online Presence**: Members marked `isOnline: true` if `last_seen_at > NOW() - INTERVAL '30 seconds'`.
- **Timer Synchronization**:
  - Transitions automatically through phases (`focus` -> `short_break` -> `long_break` every N intervals) on read or action via `advanceRoom(room, now)`.
  - Actions supported: `start`, `pause`, `resume`, `reset`, `skip`.
  - State conflicts (e.g., trying to pause an already paused or idle timer) return `409 TIMER_STATE_CONFLICT`.
  - Concurrency safety: locked via `SELECT ... FOR UPDATE` inside `withTransaction`.

### 5.4 Goals, Courses, & AI Generation (`/api/goals`, `/api/courses`)
- **Goal Creation**: Validates topic (2..120), desired outcome (8..1000), weekly minutes (30..2400), target weeks (1..104).
- **Course Proposal Generation (`POST /api/goals/:id/proposal`)**:
  - Retrieves learner-owned context via full-text search (`retrieveLearnerContext`).
  - Executes multi-agent AI pipeline (curriculum designer, lesson content designer, assessment designer).
  - Validates full DAG: modules ordered 1..N, module prerequisites point to earlier modules, lesson prerequisites point to earlier lesson titles, checkpoints have valid single correct answer index.
  - Records job execution in `ai_jobs` table.
  - Saves course in `proposal` status and returns feasibility assessment (`fits: neededPerWeek <= weeklyMinutes`).
- **Course Approval (`POST /api/courses/:id/approve`)**:
  - Row locked `FOR UPDATE`.
  - Enforces weekly budget: if `perWeek > weeklyMinutes` and `!acceptOverload`, rejects with `409 PLAN_OVER_BUDGET`.
  - Automatically schedules all lessons into `study_tasks` across learner's `preferred_study_days` respecting session length constraints.
- **Proposal Improvement (`POST /api/courses/:id/improve`)**:
  - Re-runs plan generation incorporating learner feedback (min 8 chars) and previous plan.
  - Atomic replacement of modules and lessons within transaction.

### 5.5 Tasks & Evidence-Based Completion (`/api/tasks/*`)
- **Auto-Overdue Sweep**: On every `GET /api/tasks`, automatically updates overdue tasks (`scheduled_at < NOW() - INTERVAL '1 day'`) to `'overdue'`.
- **Gated Completion**:
  - Task completion requires evidence: if `lesson_id` is set, queries `practice_attempts` for passing score (`score >= 70`).
  - If no passing attempt exists: rejects with `409 EVIDENCE_REQUIRED`.

### 5.6 Flashcards & Spaced Repetition (`/api/flashcards/*`)
- Algorithm: Modified SM-2:
  - `Again`: interval reset to 0 (due in 10 minutes), ease reduced by 0.2.
  - `Hard`: interval = `round(interval * 1.2)`, ease unchanged.
  - `Good`: interval = `round(interval * 2.0)`, ease unchanged.
  - `Easy`: interval = `round(interval * 2.5)` (min 3 days), ease increased by 0.15.
  - Ease floored at `1.3`.
  - Writes audit record to `review_events`.

### 5.7 Practice & Tutor AI (`/api/practice`, `/api/tutor`)
- **Practice Scoring**: Automatically scores multiple choice checkpoints (100% or 0%) against lesson checkpoint definition; open responses recorded with `score = null`.
- **Tutor Grounding**: Grounded only in retrieved learner memory (notes, completed lessons, practice attempts); citations verified against retrieved IDs; external URLs stripped; prompt injection guarded by treating memory as data.

### 5.8 Account Data Management & GDPR-Style Export (`/api/settings/*`)
- **Export (`GET /api/settings/export`)**: Full JSON dump of user profile, goals, courses, notes, flashcards, tasks, and practice attempts.
- **Account Deletion (`DELETE /api/settings/account`)**: Requires current password verification; executes cascading delete (`ON DELETE CASCADE` across all 9 related tables); clears session cookie.

---

## 6. Route-Level Edge Cases, Vulnerabilities, & Defect Risk Analysis

### Defect 1: Unvalidated UUIDs Bubble Up as 500 Internal Errors
- **Location**:
  - `PUT /api/notes/:id` (line 248)
  - `DELETE /api/notes/:id` (line 249)
  - `POST /api/flashcards/:id/review` (line 255)
  - `DELETE /api/flashcards/:id` (line 256)
  - Foreign key body parameters: `courseId`, `lessonId` in `POST /api/notes`, `POST /api/flashcards`, `POST /api/practice`, `POST /api/tutor`.
- **Mechanism**: Other routes explicitly check `if (!idPattern.test(parts[1])) return notFound(res, ...);`. In the routes above, `idPattern.test` is omitted. If an invalid UUID string (e.g. `/api/notes/non-existent-id`) is supplied, PostgreSQL throws an `invalid input syntax for type uuid` error, which `safeError` converts to HTTP 500 instead of HTTP 404 or 400.
- **Severity**: Low to Medium (Unhygienic error reporting; should be 404/400).

### Defect 2: Malformed Date Query Parameters in `/api/tasks` Trigger 500
- **Location**: `GET /api/tasks` (line 233)
- **Mechanism**: Query parameters `from` and `to` are passed directly into the SQL query:
  `($2::timestamptz IS NULL OR t.scheduled_at >= $2) AND ($3::timestamptz IS NULL OR t.scheduled_at < $3)`.
  If a caller passes `?from=invalid-date`, PostgreSQL throws `invalid input syntax for type timestamp with time zone: "invalid-date"`, resulting in a 500 `INTERNAL_ERROR`.
- **Severity**: Low to Medium (Should validate with `Date.parse()` or regex before querying and return 400 or ignore invalid dates).

### Defect 3: Duplicate Endpoint Alias
- **Location**: `POST /api/goals/:id/approve` (line 213) and `POST /api/courses/:id/approve` (line 222)
- **Mechanism**: Line 213 handles `parts[0] === "goals" && parts[2] === "approve"`, but passes `parts[1]` into `approveCourse(user.id, parts[1], ...)`. It expects `parts[1]` to be a `courseId`, not a `goalId`. While harmless, it is an undocumented route alias that can cause confusion.

### Defect 4: Inconsistent Method Not Allowed (405 vs 404)
- **Mechanism**: `/api/study-rooms` returns 405 `METHOD_NOT_ALLOWED` when non-GET/POST verbs are used. However, `/api/home`, `/api/goals`, `/api/courses`, etc. fall through to 404 `NOT_FOUND` if called with invalid HTTP methods (e.g. `DELETE /api/home`). `/api/health` accepts any HTTP verb (POST/DELETE/PUT) and always returns 200.

---

## 7. Synthesis and Verification Plan

1. **Automated Unit & Integration Tests**:
   - `tests/api.test.js`: Verifies public routes, health check, unauthenticated rejections, and DB failure handling.
   - `tests/api-authenticated.test.js`: Verifies authenticated workflows using Vite stubbed server.
   - All 98 existing automated tests run and pass cleanly via `node --test`.
2. **Recommended New Verification Tests for Test Specialist**:
   - Test non-UUID strings on `/api/notes/:id` and `/api/flashcards/:id` to verify 404 behavior.
   - Test invalid `from`/`to` parameters on `/api/tasks`.
   - Test concurrency on shared study room timer actions and flashcard reviews.
   - Test study room pomodoro phase wrapping with expired timestamps.
   - Test course approval budget enforcement and overload override flag.
