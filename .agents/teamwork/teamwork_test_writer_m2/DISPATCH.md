# Task Assignment: Milestone 2 Test Writer — Automated Backend Verification Test Suite

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Mandatory Reading
Read the original request verbatim before starting:
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\ORIGINAL_REQUEST.md`

## Project Scope & Feature Inventory
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\orchestrator\PROJECT.md`

## Working Directory
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_test_writer_m2\`

## Exclusive File Ownership
You own and may create/edit:
- `tests/backend-verification.test.js`

## Objectives
Implement a comprehensive, hermetic automated backend verification test suite in `tests/backend-verification.test.js` that executes under `node --test` alongside all existing test suites.

The test suite MUST cover:
1. **API Routes Verification**:
   - `GET /api/health`
   - `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, `POST /api/auth/change-password`
   - `GET /api/home`
   - `POST /api/goals`, `GET /api/goals/:id`
   - `POST /api/courses/generate`, `GET /api/courses`, `GET /api/courses/:id`, `PUT /api/courses/:id`
   - `GET /api/modules/:id`, `GET /api/lessons/:id`
   - `GET /api/tasks` (with and without valid ISO `from`/`to` filters), `POST /api/tasks`, `PUT /api/tasks/:id`, `POST /api/tasks/:id/complete` (evidence requirement), `DELETE /api/tasks/:id`
   - `GET /api/notes`, `POST /api/notes`, `GET /api/notes/:id`, `PUT /api/notes/:id`, `DELETE /api/notes/:id`
   - `GET /api/flashcards`, `POST /api/flashcards`, `POST /api/flashcards/:id/review`, `DELETE /api/flashcards/:id`
   - `POST /api/practice`
   - `POST /api/tutor`
   - `GET /api/progress`
   - `GET /api/search`
   - `GET /api/study-rooms/:code`, `POST /api/study-rooms/:code/join`, `POST /api/study-rooms/:code/pomodoro`, `POST /api/study-rooms/:code/heartbeat`, `leave`
   - `GET /api/settings`, `PUT /api/settings`

2. **Database Operations & Transactions**:
   - Verification of transactional atomicity in `withTransaction`
   - Verification of email token verification and password reset in transactions
   - Course & goal status atomic update
   - Data preservation verification: `ON DELETE SET NULL` on notes, flashcards, practice attempts, study tasks when courses/lessons are deleted

3. **Error Handling Architecture**:
   - `safeError` sanitization (ensuring no stack traces or database internals leak to clients, returning 500 `INTERNAL_ERROR`)
   - 400 Bad Request error codes and messages for input validation
   - 401 Unauthenticated for protected routes
   - 404 Not Found for non-existent entities and non-UUID parameters
   - 409 Conflict for invalid state transitions (e.g. `COURSE_NOT_PROPOSAL`, `EVIDENCE_REQUIRED`)
   - 503 `DATABASE_NOT_CONFIGURED` handling
   - AI provider error taxonomy (429, 504, 502, 503)

4. **Concurrency & Row Locking**:
   - Concurrency synchronization with `FOR UPDATE` row locking on study room Pomodoro timer
   - Concurrency synchronization on flashcard review repetitions
   - Concurrency prevention of double course approval

## Execution & Verification
1. Run `node --test` to verify that both existing tests (112 tests) AND new verification tests pass with 0 failures.
2. Ensure tests run hermetically using the same Vite SSR in-memory harness pattern as `tests/api-authenticated.test.js`.
3. Write `handoff.md` and report completion to parent orchestrator.

## 2026-11-11T13:51:36Z
You are Milestone 2 Test Writer.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your working directory: c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_test_writer_m2\
Read DISPATCH.md in your working directory, ORIGINAL_REQUEST.md at c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\ORIGINAL_REQUEST.md, and PROJECT.md at c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\orchestrator\PROJECT.md.
Also inspect existing tests in tests/api-authenticated.test.js for the Vite SSR test harness pattern.

Implement comprehensive automated verification tests in tests/backend-verification.test.js covering API routes, database operations & transactions, error handling paths, and concurrency.
Run node --test to verify that both existing tests and your new tests pass with 0 failures.
Write handoff.md in your working directory, and message back when complete.

