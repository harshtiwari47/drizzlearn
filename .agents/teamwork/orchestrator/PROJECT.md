# Project: Drizzlearn Backend Production Readiness Verification & Defect Resolution

## Architecture
- **Runtime**: Node.js ES Modules (`"type": "module"`), Vercel serverless function router (`api/[...path].js`).
- **Data Layer**: PostgreSQL (`pg` connection pool with max: 3, transactions via `withTransaction`), `db/schema.sql`.
- **Security & Auth**: HMAC-SHA256 session cookie (`learnos_session`), timing-safe verification, tenant isolation (`WHERE user_id = $1`).
- **Error Handling**: Typed error codes, HTTP status mapping, safe error sanitizer (`safeError` suppressing sensitive SQL/stacks), AI provider error taxonomy.
- **Concurrency**: Row-level pessimistic locking (`FOR UPDATE`) for synchronized state machines (Study Room Pomodoro, Flashcard SM-2 review, Course approvals).
- **Test Infrastructure**: Standard Node.js test runner (`node --test`), Vite SSR in-memory test harness with mock plugins.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Health Check | `GET /api/health` reports status, runtime, and timestamp | M2 | Survey 1 & 3 |
| 2 | Auth Signup | `POST /api/auth/signup` validates credentials and creates user | M2 | Survey 1 & 3 |
| 3 | Auth Login | `POST /api/auth/login` checks password and issues session cookie | M2 | Survey 1 & 3 |
| 4 | Auth Logout | `POST /api/auth/logout` clears session cookie | M2 | Survey 1 & 3 |
| 5 | Auth Session Me | `GET /api/auth/me` returns current user profile | M2 | Survey 1 & 3 |
| 6 | Email Verification Request | `POST /api/auth/request-verification` generates token | M2 | Survey 1 & 3 |
| 7 | Email Verification Token | `POST /api/auth/verify` consumes token and verifies email | M1, M2 | Survey 1 & 2 |
| 8 | Password Reset Request | `POST /api/auth/forgot-password` generates reset token | M2 | Survey 1 & 3 |
| 9 | Password Reset Token | `POST /api/auth/reset-password` updates password and consumes token | M1, M2 | Survey 1 & 2 |
| 10 | Password Change | `POST /api/auth/change-password` requires current password | M2 | Survey 1 & 3 |
| 11 | Home Dashboard | `GET /api/home` aggregates goals, courses, tasks, and streaks | M2 | Survey 1 & 3 |
| 12 | Goal Management | `POST /api/goals`, `GET /api/goals/:id` | M2 | Survey 1 & 3 |
| 13 | Course Generation | `POST /api/courses/generate` via multi-agent planner | M2 | Survey 1 & 3 |
| 14 | Course List & Detail | `GET /api/courses`, `GET /api/courses/:id` | M2 | Survey 1 & 3 |
| 15 | Course Improvement | `POST /api/courses/:id/improve` with lock | M2 | Survey 1 & 2 |
| 16 | Course Approval | `POST /api/courses/:id/approve` schedules tasks with lock | M2 | Survey 1 & 2 |
| 17 | Course Status Sync | `PUT /api/courses/:id` synchronizes goal status | M1, M2 | Survey 1 & 2 |
| 18 | Module Detail | `GET /api/modules/:id` | M2 | Survey 1 & 3 |
| 19 | Lesson Detail | `GET /api/lessons/:id` | M2 | Survey 1 & 3 |
| 20 | Task Query & Date Filter | `GET /api/tasks?from=...&to=...` | M1, M2 | Survey 1 |
| 21 | Task Management | `POST /api/tasks`, `PUT /api/tasks/:id`, `DELETE /api/tasks/:id` | M2 | Survey 1 & 3 |
| 22 | Task Completion | `POST /api/tasks/:id/complete` with evidence enforcement | M2 | Survey 1 & 3 |
| 23 | Note Management | `GET /api/notes`, `POST /api/notes`, `GET/PUT/DELETE /api/notes/:id` | M1, M2 | Survey 1 & 3 |
| 24 | Flashcard Management | `GET /api/flashcards`, `POST /api/flashcards`, `DELETE /api/flashcards/:id` | M1, M2 | Survey 1 & 3 |
| 25 | Flashcard Review | `POST /api/flashcards/:id/review` SM-2 interval update with lock | M1, M2 | Survey 1 & 2 |
| 26 | Practice Record | `POST /api/practice` records attempt score and feedback | M2 | Survey 1 & 3 |
| 27 | Socratic AI Tutor | `POST /api/tutor` answers learner questions with budget | M2 | Survey 1 & 3 |
| 28 | Progress Analytics | `GET /api/progress` returns retention, cards, completions | M2 | Survey 1 & 3 |
| 29 | Full-Text Search | `GET /api/search` searches notes, lessons, attempts | M2 | Survey 1 & 3 |
| 30 | Study Room Snapshot | `GET /api/study-rooms/:code`, `POST /api/study-rooms/:code/join` | M2 | Survey 1 & 2 |
| 31 | Study Room Pomodoro | `POST /api/study-rooms/:code/pomodoro` state machine with lock | M2 | Survey 1 & 2 |
| 32 | Study Room Presence | `POST /api/study-rooms/:code/heartbeat`, `leave` | M2 | Survey 1 & 2 |
| 33 | Learner Settings | `GET /api/settings`, `PUT /api/settings` | M2 | Survey 1 & 3 |
| 34 | Error Sanitizer | `server/http.js:safeError` returns sanitized 500 without stack | M1, M2 | Survey 1 & 3 |
| 35 | Defensive Rollback | `server/db.js:withTransaction` prevents secondary rollback masking | M1, M2 | Survey 2 |
| 36 | Atomic Token Operations | `api/[...path].js` atomic token verification and password reset | M1, M2 | Survey 2 |
| 37 | UUID Path Validation | Validate UUIDs on `/api/notes/:id` and `/api/flashcards/:id` returning 404 | M1, M2 | Survey 1 |
| 38 | Task Date Validation | Validate `from` and `to` ISO date parameters returning 400 | M1, M2 | Survey 1 |
| 39 | Schema Performance Indexes | Add foreign key indexes in `db/schema.sql` | M1, M2 | Survey 2 |
| 40 | Final Test Suite Verification | All existing and new automated tests pass (`node --test`) with 0 failures | M3 | Original Request R3 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Defect Resolution & Data Integrity | Resolve UUID validation, date query validation, atomic token transactions, rollback safety, and schema indexes | none | DONE |
| 2 | Automated Backend Verification Suite | Implement comprehensive `tests/backend-verification.test.js` covering routes, DB, errors, and concurrency | M1 | DONE |
| 3 | Final Milestone & 100% Test Pass | Run full `node --test` suite, execute adversarial challenger verification and forensic integrity audit | M2 | DONE |

## Interface Contracts
### `server/db.js`
- `withTransaction(async (client) => { ... })`: Guarantees transaction atomicity. If work fails, rolls back safely without masking original error.
### `api/[...path].js`
- `GET /api/tasks?from=...&to=...`: Returns 400 `INVALID_DATE` if `from` or `to` are invalid date strings.
- `/api/notes/:id` & `/api/flashcards/:id`: Returns 404 `NOT_FOUND` if `:id` fails `idPattern.test(id)`.
- `/api/auth/verify` & `/api/auth/reset-password`: Executes token consumption and user update inside `withTransaction()`.

## Code Layout
- `api/[...path].js`: Primary serverless API router and endpoint handlers.
- `server/db.js`: PostgreSQL connection pool and transaction helper.
- `server/http.js`: HTTP request/response serialization and error sanitizer.
- `server/auth.js`: Session management and cryptographic token verification.
- `db/schema.sql`: Database table, constraint, and index definitions.
- `tests/`: Automated test suites executed via `node --test`.
