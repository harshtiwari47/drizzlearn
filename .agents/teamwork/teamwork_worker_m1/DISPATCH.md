# Task Assignment: Milestone 1 Worker — Defect Resolution & Data Integrity Implementation

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Mandatory Reading
Read the original request verbatim before starting:
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\ORIGINAL_REQUEST.md`

## Project Scope & Code Layout
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\orchestrator\PROJECT.md`

## Explorer Findings (Your Specifications)
1. Route Parameter & Query Validation:
   `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_1\handoff.md`
   `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_1\analysis.md`
2. Database Transaction Safety & Atomicity:
   `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_2\handoff.md`
   `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_2\analysis.md`
3. Schema Integrity & Foreign Key Indexes:
   `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_3\handoff.md`
   `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_3\analysis.md`

## Working Directory
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_worker_m1\`

## Exclusive File Ownership
You own and may edit ONLY the following files:
- `api/[...path].js`
- `server/db.js`
- `db/schema.sql`
- `scripts/migrate.js`
- `tests/api-authenticated.test.js` (updating lines 226, 229 from `"card-1"` to a valid UUID)

## Implementation Tasks
1. **`server/db.js`**: Update `withTransaction(work)` with defensive rollback handling so that if `client.query("ROLLBACK")` throws, `releaseError` is set, `error.cause = rollbackError`, the original `error` is rethrown, and `client.release(releaseError)` is invoked.
2. **`api/[...path].js`**:
   - In `GET /api/tasks` (line 233): validate `from` and `to` query parameters with `Date.parse()`. If either is non-empty and `isNaN(Date.parse(...))`, return `sendError(res, 400, "INVALID_DATE", "Choose a valid date and time.")`.
   - In `/api/notes/:id` (lines 248-250): enforce `if(!idPattern.test(parts[1])) return notFound(res, "Note");` for GET, PUT, and DELETE. Implement `GET /api/notes/:id` returning `{ note: r.rows[0] }` if found.
   - In `/api/flashcards/:id` (lines 255-256): enforce `if(!idPattern.test(parts[1])) return notFound(res, "Flashcard");` for POST review and DELETE.
   - In `POST /api/auth/verify`: wrap token consumption and user `email_verified_at` update inside `withTransaction(async (client) => { ... })`.
   - In `POST /api/auth/reset-password`: compute `bcrypt.hash(password, 12)` upfront, then wrap token consumption and user `password_hash` update inside `withTransaction(async (client) => { ... })`.
   - In `PUT /api/courses/:id`: wrap course update and learning goal update inside `withTransaction(async (client) => { ... })`.
3. **`db/schema.sql`**: Add the 12 idempotent foreign key indexes specified in `teamwork_explorer_m1_3/handoff.md § 4.1`.
4. **`scripts/migrate.js`**: Harden migration error logging.
5. **`tests/api-authenticated.test.js`**: Update lines 226 and 229 to use a 36-char UUID constant so the test suite passes with the new UUID check.
6. **Build & Test Verification**: Run `node --test` and verify that all 98 tests pass with 0 failures.
7. Write `handoff.md` and report completion to parent orchestrator.

## 2026-11-11T07:07:38Z
You are Milestone 1 Worker (Defect Resolution & Data Integrity).

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your working directory: c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_worker_m1\
Read DISPATCH.md in your working directory and ORIGINAL_REQUEST.md at c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\ORIGINAL_REQUEST.md.
Also read the 3 Explorer handoff reports:
- c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_1\handoff.md
- c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_2\handoff.md
- c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_3\handoff.md

Apply the specified fixes to api/[...path].js, server/db.js, db/schema.sql, scripts/migrate.js, and tests/api-authenticated.test.js.
Run node --test to verify that all existing tests pass with 0 failures.
Write handoff.md in your working directory, and message back when complete.
