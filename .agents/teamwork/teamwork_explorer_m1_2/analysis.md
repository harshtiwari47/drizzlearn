# Technical Analysis: Database Transaction Safety & Atomicity

**Target Files**: `server/db.js`, `api/[...path].js`  
**Milestone**: Milestone 1 (Defect Resolution & Data Integrity)  
**Author**: Milestone 1 Explorer 2 (Transaction Safety & Atomicity)  
**Date**: 2026-11-11  

---

## 1. Executive Summary

This investigation analyzed transaction boundaries, atomicity guarantees, and error handling across Drizzlearn's database layer (`server/db.js`) and API router (`api/[...path].js`).

Four critical defects were identified:
1. **Rollback Error Masking & Pool Contamination (`server/db.js:32-45`)**: An unhandled rejection during `ROLLBACK` completely masks the root-cause exception thrown by the application logic, and returns broken connections back into the pool.
2. **Non-Atomic Token Consumption in Email Verification (`api/[...path].js:39-45`)**: Token consumption and email verification run in separate queries. A failure in query 2 burns the token and permanently locks the learner out from verifying their email.
3. **Non-Atomic Token Consumption & Password Reset (`api/[...path].js:51-58`)**: Token consumption and user password updates run in separate queries. A failure in query 2 burns the token while leaving the old password unchanged. Furthermore, CPU-intensive bcrypt hashing is currently executed within query value evaluation, threatening connection pool starvation if placed inside a transaction.
4. **Non-Atomic Course & Goal Status Desynchronization (`api/[...path].js:225`)**: Updating course title/summary/status occurs in query 1, while updating the linked `learning_goals` status occurs in query 2. A failure in query 2 leaves the course in the new status while the goal remains in the old status, violating relational domain invariants.

All other routes in `api/[...path].js` either perform single atomic queries, read-only operations, or already wrap their mutations in `withTransaction` (such as `study-rooms` creation, `studyRoomSnapshot`, and `flashcard review`).

---

## 2. Deep Dive: Rollback Error Masking in `server/db.js`

### 2.1 Current Implementation
```javascript
// server/db.js: lines 32-45
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

### 2.2 The Mechanism of Failure
1. **Root-Cause Error Masking**:
   When `work(client)` encounters a failure (e.g., query error, socket timeout, database restart, or killed backend process), the `catch (error)` block is entered.
   Inside the catch block, `await client.query("ROLLBACK")` is executed.
   If the failure in `work(client)` was due to a severed connection (e.g. `ECONNRESET`, client not queryable, termination by admin), the `ROLLBACK` query will immediately reject with an error such as:
   `Error: Client has encountered a connection error and is not queryable` or `Error: Connection terminated unexpectedly`.
   Because this rejection is unhandled inside `catch`, JavaScript throws the rollback error. The original `error` that initiated the failure is completely discarded. Downstream error logging and API responses will report that `ROLLBACK` failed, obscuring the genuine application or database error.

2. **Connection Pool Contamination**:
   In `node-postgres` (`pg-pool/index.js:384`), `client.release(err)` behaves differently based on whether an argument is passed:
   - `client.release()` (no argument / falsy): The pool marks the client as idle and returns it to the available connection queue.
   - `client.release(err)` (with truthy error): The pool discards the connection (`this._remove(client)`) and creates a fresh connection on subsequent requests.
   When `client.query("ROLLBACK")` fails, the client is in a corrupted state. If released without an error argument, this damaged connection is returned to the pool (which has a strict limit of `max: 3` connections), causing subsequent incoming requests to fail immediately.

### 2.3 Proposed Fix
```javascript
export async function withTransaction(work) {
  const client = await getPool().connect();
  let releaseError;
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      releaseError = rollbackError;
      if (error && typeof error === "object" && !error.cause) {
        try {
          error.cause = rollbackError;
        } catch {
          // Object may be non-extensible
        }
      }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
```

**Key Improvements**:
- If `ROLLBACK` succeeds, `releaseError` is `undefined`, and `client.release(undefined)` safely returns the healthy connection to the pool.
- If `ROLLBACK` fails, the rollback failure is recorded in `releaseError` and attached to `error.cause` without replacing the original `error`.
- In `finally`, `client.release(releaseError)` passes the truthy error, prompting `pg-pool` to evict and destroy the dead client.
- The original `error` is guaranteed to be rethrown to the caller.

---

## 3. Deep Dive: Non-Atomic Token Operations in `api/[...path].js`

### 3.1 `POST /api/auth/verify`

#### Current Implementation (lines 39-45)
```javascript
  if(action==="verify"&&verb==="POST") {
    const token=String((await bodyOf(req)).token||""); if(token.length<20)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    const result=await query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
    if(!result.rows[0])return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    await query("UPDATE users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1",[result.rows[0].user_id]);
    return sendJson(res,200,{verified:true});
  }
```

#### Vulnerability Analysis
- Query 1 sets `consumed_at = NOW()` on `auth_tokens`.
- Query 2 sets `email_verified_at = NOW()` on `users`.
- If Query 2 throws an error (transient network disruption, database lock, schema check constraint), Query 1 has already committed.
- The learner's email address remains unverified (`email_verified_at IS NULL`).
- When the learner clicks the verification link again or retries, Query 1 matches 0 rows because `consumed_at IS NULL` is no longer true.
- The learner receives 400 `INVALID_TOKEN` ("This verification link is invalid or expired") and cannot verify their email without generating a new token.

#### Proposed Fix
```javascript
  if(action==="verify"&&verb==="POST") {
    const token=String((await bodyOf(req)).token||""); if(token.length<20)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    const verified = await withTransaction(async (client) => {
      const result = await client.query(
        "UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",
        [hashToken(token)]
      );
      if(!result.rows[0]) return false;
      await client.query("UPDATE users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1",[result.rows[0].user_id]);
      return true;
    });
    if(!verified)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    return sendJson(res,200,{verified:true});
  }
```

---

### 3.2 `POST /api/auth/reset-password`

#### Current Implementation (lines 51-58)
```javascript
  if(action==="reset-password"&&verb==="POST") {
    const b=await bodyOf(req),token=String(b.token||""),password=String(b.password||"");
    if(password.length<10||password.length>200)return sendError(res,400,"INVALID_PASSWORD","Use a password between 10 and 200 characters.");
    const result=await query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
    if(!result.rows[0])return sendError(res,400,"INVALID_TOKEN","This reset link is invalid or expired.");
    await query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2",[await bcrypt.hash(password,12),result.rows[0].user_id]);
    return sendJson(res,200,{ok:true});
  }
```

#### Vulnerability & Performance Analysis
1. **Atomicity Defect**:
   - Query 1 consumes the token.
   - Query 2 updates the password.
   - If Query 2 fails, the reset token is consumed, but the user's password was not updated. The learner cannot log in with the new password, nor can they retry using the reset link.
2. **Connection Pool Starvation Risk**:
   - `bcrypt.hash(password, 12)` is computationally expensive (~100–300ms of synchronous CPU work).
   - If placed inside `withTransaction`, an active client from the connection pool (limited to `max: 3`) is held idle while hashing completes. Under concurrent password resets, this would quickly exhaust the pool.
   - **Resolution**: Compute `const passwordHash = await bcrypt.hash(password, 12);` *before* acquiring the transaction client.

#### Proposed Fix
```javascript
  if(action==="reset-password"&&verb==="POST") {
    const b=await bodyOf(req),token=String(b.token||""),password=String(b.password||"");
    if(password.length<10||password.length>200)return sendError(res,400,"INVALID_PASSWORD","Use a password between 10 and 200 characters.");
    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await withTransaction(async (client) => {
      const result = await client.query(
        "UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",
        [hashToken(token)]
      );
      if(!result.rows[0]) return false;
      await client.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2",[passwordHash,result.rows[0].user_id]);
      return true;
    });
    if(!updated)return sendError(res,400,"INVALID_TOKEN","This reset link is invalid or expired.");
    return sendJson(res,200,{ok:true});
  }
```

---

## 4. Deep Dive: Non-Atomic Course & Goal Status in `PUT /api/courses/:id`

### 4.1 Current Implementation (line 225)
```javascript
    if(parts.length===2&&methodName==="PUT") {
      if(!idPattern.test(parts[1]))return notFound(res,"Course");
      const b=await bodyOf(req),title=String(b.title||"").trim().slice(0,120),summary=String(b.summary||"").trim().slice(0,1000);
      if(!title||!summary)return sendError(res,400,"INVALID_COURSE","Course title and outcome are required.");
      const status=["proposal","active","paused","completed","archived"].includes(b.status)?b.status:null;
      const r=await query(`UPDATE courses SET title=$1,summary=$2,status=COALESCE($3,status),updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *`,[title,summary,status,parts[1],user.id]);
      if(!r.rows[0])return notFound(res,"Course");
      if(status)await query("UPDATE learning_goals SET status=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3",[status==="proposal"?"draft":status,r.rows[0].goal_id,user.id]);
      return sendJson(res,200,{course:r.rows[0]});
    }
```

### 4.2 Vulnerability Analysis
- When updating a course's status (e.g. from `proposal` to `active`, or `active` to `completed` or `paused`), Drizzlearn maintains a 1-to-1 status correspondence with its parent `learning_goals` entry (`draft`, `active`, `paused`, `completed`, `archived`).
- Query 1 updates `courses`. Query 2 updates `learning_goals`.
- If Query 1 succeeds and Query 2 fails:
  - The course status change is permanently committed.
  - The goal remains in its prior status.
  - The UI and dashboard aggregate queries (which join `courses` and `learning_goals` on `c.goal_id = g.id` and filter by status) will encounter inconsistent states.
  - The client receives an error (500 Internal Error) even though partial mutations were persisted.

### 4.3 Proposed Fix
```javascript
    if(parts.length===2&&methodName==="PUT") {
      if(!idPattern.test(parts[1]))return notFound(res,"Course");
      const b=await bodyOf(req),title=String(b.title||"").trim().slice(0,120),summary=String(b.summary||"").trim().slice(0,1000);
      if(!title||!summary)return sendError(res,400,"INVALID_COURSE","Course title and outcome are required.");
      const status=["proposal","active","paused","completed","archived"].includes(b.status)?b.status:null;
      const course = await withTransaction(async (client) => {
        const r = await client.query(
          `UPDATE courses SET title=$1,summary=$2,status=COALESCE($3,status),updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *`,
          [title,summary,status,parts[1],user.id]
        );
        if(!r.rows[0]) return null;
        if(status) {
          await client.query(
            "UPDATE learning_goals SET status=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3",
            [status==="proposal"?"draft":status,r.rows[0].goal_id,user.id]
          );
        }
        return r.rows[0];
      });
      if(!course)return notFound(res,"Course");
      return sendJson(res,200,{course});
    }
```

---

## 5. Audit of Other Routes in `api/[...path].js`

| Route | Multi-step Writes? | Current Transaction State | Status / Recommendation |
|---|---|---|---|
| `POST /api/auth/signup` | No | Single `INSERT ... ON CONFLICT DO NOTHING RETURNING` | Safe |
| `POST /api/auth/login` | No | Single `SELECT` | Safe |
| `POST /api/auth/verify` | Yes | Un-transactioned | **Defect — Wrap in withTransaction** |
| `POST /api/auth/forgot-password` | No | Single `SELECT` then single `INSERT` (email is non-transactional) | Safe |
| `POST /api/auth/reset-password` | Yes | Un-transactioned | **Defect — Wrap in withTransaction** |
| `POST /api/study-rooms` | Yes | Uses `withTransaction` (lines 168-173) | Safe |
| `POST /api/study-rooms/:code/timer` | Yes | Uses `withTransaction` in `studyRoomSnapshot` | Safe |
| `POST /api/goals` | No | Single `INSERT` | Safe |
| `POST /api/goals/:id/proposal` | Yes | Uses `withTransaction` in `generateCourseProposal` | Safe |
| `POST /api/courses/:id/approve` | Yes | Uses `withTransaction` in `approveCourse` | Safe |
| `POST /api/courses/:id/improve` | Yes | Uses `withTransaction` in `improveCourseProposal` | Safe |
| `PUT /api/courses/:id` | Yes | Un-transactioned | **Defect — Wrap in withTransaction** |
| `PUT /api/modules/:id` | No | Single `UPDATE` | Safe |
| `GET /api/tasks` | No | `UPDATE overdue` then `SELECT` (idempotent maintenance) | Safe |
| `POST /api/tasks/:id/complete` | No | Read checks then single `UPDATE` | Safe |
| `POST /api/flashcards/:id/review` | Yes | Uses `withTransaction` (line 255) | Safe |
| `DELETE /api/settings/account` | No | Verify password then single `DELETE FROM users` (schema CASCADE handles dependents) | Safe |

---

## 6. Test Suite & Mock Compatibility

### Current Mock Analysis
In `tests/api-authenticated.test.js:47-50`:
```javascript
if (mock === "db") return `
  export async function query(...args) { return globalThis.__learnosApiTest.query(...args); }
  export async function withTransaction(work) { return work({ query: (...args) => globalThis.__learnosApiTest.query(...args) }); }
`;
```
Because the Vite test mock implements `withTransaction` by delegating directly to `work({ query: ... })`, moving `verify`, `reset-password`, and `PUT /api/courses/:id` into `withTransaction` will integrate seamlessly without breaking existing test harnesses.

### Verification Test Suite for Milestone 2
A new dedicated test suite `tests/backend-verification.test.js` should be created in Milestone 2 with tests for:
1. **Defensive Rollback**: A unit test with a mock client whose `query("ROLLBACK")` rejects. Verify that `withTransaction` re-throws the original error, populates `error.cause`, and passes the error to `client.release(err)`.
2. **Atomic Verification**: When `UPDATE users` rejects, verify `auth_tokens.consumed_at` was not committed.
3. **Atomic Password Reset**: When `UPDATE users` rejects, verify `auth_tokens.consumed_at` was not committed.
4. **Atomic Course Status**: When `UPDATE learning_goals` rejects, verify `courses.status` was not modified.
