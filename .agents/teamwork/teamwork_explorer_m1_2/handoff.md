# Handoff Report: Milestone 1 Explorer 2 (Transaction Safety & Atomicity)

**Target Files**: `server/db.js`, `api/[...path].js`  
**Working Directory**: `c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_2\`  
**Milestone**: Milestone 1 (Defect Resolution & Data Integrity)  
**Recipient**: Orchestrator (`fbfa4fd3-1899-40dc-8ab0-b3bbf9741dd8`) / Milestone 1 Implementer  

---

## 1. Observation

### Observation 1: `server/db.js` lines 32–45
```javascript
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
- In lines 39–41, `catch (error) { await client.query("ROLLBACK"); throw error; }` awaits `client.query("ROLLBACK")` directly.
- If `client.query("ROLLBACK")` throws (e.g. socket connection severed or client in fatal error state), the unhandled rejection in the catch block overwrites and discards `error`.
- In line 43, `client.release()` is called with no arguments. In `node_modules/pg-pool/index.js:384-398`, `_release(client, idleListener, err)` only evicts the connection from the pool if `err` is truthy. Releasing without arguments returns a dead/broken client back into the pool.

### Observation 2: `api/[...path].js` lines 39–45 (`POST /api/auth/verify`)
```javascript
  if(action==="verify"&&verb==="POST") {
    const token=String((await bodyOf(req)).token||""); if(token.length<20)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    const result=await query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
    if(!result.rows[0])return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    await query("UPDATE users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1",[result.rows[0].user_id]);
    return sendJson(res,200,{verified:true});
  }
```
- Line 41 executes Query 1 using pool-level `query(...)`, marking `auth_tokens.consumed_at = NOW()`.
- Line 43 executes Query 2 using pool-level `query(...)`, setting `users.email_verified_at = NOW()`.
- Neither query runs within a transaction block (`withTransaction`).

### Observation 3: `api/[...path].js` lines 51–58 (`POST /api/auth/reset-password`)
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
- Line 54 executes Query 1 consuming the token.
- Line 56 hashes the password and executes Query 2 updating `users.password_hash`.
- The two queries run independently without `withTransaction`.
- `await bcrypt.hash(password, 12)` is invoked inline within the query parameters.

### Observation 4: `api/[...path].js` line 225 (`PUT /api/courses/:id`)
```javascript
    if(parts.length===2&&methodName==="PUT") { if(!idPattern.test(parts[1]))return notFound(res,"Course"); const b=await bodyOf(req),title=String(b.title||"").trim().slice(0,120),summary=String(b.summary||"").trim().slice(0,1000); if(!title||!summary)return sendError(res,400,"INVALID_COURSE","Course title and outcome are required."); const status=["proposal","active","paused","completed","archived"].includes(b.status)?b.status:null; const r=await query(`UPDATE courses SET title=$1,summary=$2,status=COALESCE($3,status),updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *`,[title,summary,status,parts[1],user.id]); if(!r.rows[0])return notFound(res,"Course"); if(status)await query("UPDATE learning_goals SET status=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3",[status==="proposal"?"draft":status,r.rows[0].goal_id,user.id]); return sendJson(res,200,{course:r.rows[0]}); }
```
- Query 1 updates `courses`.
- Query 2 updates `learning_goals.status` when `status` is provided.
- The two statements run as independent autocommit queries without `withTransaction`.

### Observation 5: Existing Test Harness Mocks
- `tests/api-authenticated.test.js:47-50`:
  ```javascript
  if (mock === "db") return `
    export async function query(...args) { return globalThis.__learnosApiTest.query(...args); }
    export async function withTransaction(work) { return work({ query: (...args) => globalThis.__learnosApiTest.query(...args) }); }
  `;
  ```
- Current tests pass 98/98 tests (`node --test`), but do not assert rollback failure resilience or multi-query failure atomicity.

---

## 2. Logic Chain

1. **Rollback Resilience**:
   - From Observation 1, if `work(client)` fails due to a network break or connection error, `client.query("ROLLBACK")` will also fail.
   - Because the rollback attempt is not wrapped in an inner try-catch, the rollback error replaces `error`.
   - Furthermore, calling `client.release()` without error argument leaves a broken connection in the idle pool (`max: 3`).
   - Therefore, wrapping `client.query("ROLLBACK")` in a defensive try-catch that captures `releaseError`, sets `error.cause = rollbackError`, re-throws `error`, and calls `client.release(releaseError)` guarantees both error transparency and pool health.

2. **Email Verification Atomicity**:
   - From Observation 2, Query 1 updates `auth_tokens.consumed_at` to `NOW()`. Query 2 updates `users.email_verified_at`.
   - If Query 2 throws, Query 1 has already committed.
   - On retry, Query 1 fails with `INVALID_TOKEN` because `consumed_at IS NULL` is false.
   - Therefore, wrapping Query 1 and Query 2 in `withTransaction` ensures that if Query 2 fails, Query 1 is rolled back and the token remains unconsumed for subsequent retries.

3. **Password Reset Atomicity & Connection Safety**:
   - From Observation 3, if Query 2 fails, the reset token is consumed while the user's password remains unchanged, locking the user out.
   - Wrapping both queries in `withTransaction` ensures atomicity.
   - Computing `bcrypt.hash(password, 12)` takes ~100–300ms. Computing it before calling `withTransaction` prevents holding one of the 3 pool connections during CPU-bound hashing.

4. **Course & Goal Synchronization**:
   - From Observation 4, `courses` and `learning_goals` have corresponding status values (`proposal` <-> `draft`, `active` <-> `active`, `completed` <-> `completed`, etc.).
   - If the course update succeeds but the goal update fails, the entities are desynchronized.
   - Wrapping both operations in `withTransaction` guarantees that course and goal status are updated atomically or not at all.

---

## 3. Caveats

1. **Database URL in Development/Test**: In test suites running with Vite SSR mocks, `withTransaction` invokes `work({ query: ... })`. Full integration testing against real Postgres connections requires `DATABASE_URL` configured or a dedicated mock simulating transaction rollback.
2. **Cascading Account Deletion**: `DELETE /api/settings/account` performs a password check followed by `DELETE FROM users WHERE id=$1`. In Postgres, child records (`courses`, `goals`, `notes`, `flashcards`, etc.) are deleted via foreign key `ON DELETE CASCADE` defined in `db/schema.sql`. This is already single-query atomic in Postgres and does not require an explicit transaction wrapper.
3. **No Code Modified**: As required by the Explorer role, no changes have been committed directly to `server/db.js` or `api/[...path].js`.

---

## 4. Conclusion & Proposed Code Changes

The implementer should apply the following precise, non-breaking modifications:

### Patch 1: `server/db.js` (Defensive Rollback & Pool Eviction)
**Target**: `server/db.js:32-45`
```javascript
<<<<
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
====
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
        try { error.cause = rollbackError; } catch {}
      }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}
>>>>
```

### Patch 2: `api/[...path].js` (Atomic Email Verification)
**Target**: `api/[...path].js:39-45`
```javascript
<<<<
  if(action==="verify"&&verb==="POST") {
    const token=String((await bodyOf(req)).token||""); if(token.length<20)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    const result=await query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
    if(!result.rows[0])return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    await query("UPDATE users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1",[result.rows[0].user_id]);
    return sendJson(res,200,{verified:true});
  }
====
  if(action==="verify"&&verb==="POST") {
    const token=String((await bodyOf(req)).token||""); if(token.length<20)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    const verified = await withTransaction(async (client) => {
      const result = await client.query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
      if(!result.rows[0]) return false;
      await client.query("UPDATE users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1",[result.rows[0].user_id]);
      return true;
    });
    if(!verified)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    return sendJson(res,200,{verified:true});
  }
>>>>
```

### Patch 3: `api/[...path].js` (Atomic Password Reset with Upfront Bcrypt)
**Target**: `api/[...path].js:51-58`
```javascript
<<<<
  if(action==="reset-password"&&verb==="POST") {
    const b=await bodyOf(req),token=String(b.token||""),password=String(b.password||"");
    if(password.length<10||password.length>200)return sendError(res,400,"INVALID_PASSWORD","Use a password between 10 and 200 characters.");
    const result=await query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
    if(!result.rows[0])return sendError(res,400,"INVALID_TOKEN","This reset link is invalid or expired.");
    await query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2",[await bcrypt.hash(password,12),result.rows[0].user_id]);
    return sendJson(res,200,{ok:true});
  }
====
  if(action==="reset-password"&&verb==="POST") {
    const b=await bodyOf(req),token=String(b.token||""),password=String(b.password||"");
    if(password.length<10||password.length>200)return sendError(res,400,"INVALID_PASSWORD","Use a password between 10 and 200 characters.");
    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await withTransaction(async (client) => {
      const result = await client.query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
      if(!result.rows[0]) return false;
      await client.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2",[passwordHash,result.rows[0].user_id]);
      return true;
    });
    if(!updated)return sendError(res,400,"INVALID_TOKEN","This reset link is invalid or expired.");
    return sendJson(res,200,{ok:true});
  }
>>>>
```

### Patch 4: `api/[...path].js` (Atomic Course & Goal Status Update)
**Target**: `api/[...path].js:225`
```javascript
<<<<
    if(parts.length===2&&methodName==="PUT") { if(!idPattern.test(parts[1]))return notFound(res,"Course"); const b=await bodyOf(req),title=String(b.title||"").trim().slice(0,120),summary=String(b.summary||"").trim().slice(0,1000); if(!title||!summary)return sendError(res,400,"INVALID_COURSE","Course title and outcome are required."); const status=["proposal","active","paused","completed","archived"].includes(b.status)?b.status:null; const r=await query(`UPDATE courses SET title=$1,summary=$2,status=COALESCE($3,status),updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *`,[title,summary,status,parts[1],user.id]); if(!r.rows[0])return notFound(res,"Course"); if(status)await query("UPDATE learning_goals SET status=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3",[status==="proposal"?"draft":status,r.rows[0].goal_id,user.id]); return sendJson(res,200,{course:r.rows[0]}); }
====
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
>>>>
```

---

## 5. Verification Method

1. **Automated Test Run**:
   Execute the test suite:
   ```powershell
   npm test
   ```
   Confirm all 98 tests pass with 0 failures.

2. **Rollback Error Preservation Unit Test Specification**:
   Verify `server/db.js:withTransaction` with a unit test using a mocked client:
   ```javascript
   test("withTransaction preserves root cause error when ROLLBACK also throws", async () => {
     const mockClient = {
       query: async (sql) => {
         if (sql === "BEGIN") return;
         if (sql === "ROLLBACK") throw new Error("Connection dead");
       },
       release: (err) => {
         assert.equal(err.message, "Connection dead");
       }
     };
     // Run with mock client
     await assert.rejects(
       async () => withTransaction(async () => { throw new Error("Original root cause"); }),
       (err) => {
         assert.equal(err.message, "Original root cause");
         assert.equal(err.cause?.message, "Connection dead");
         return true;
       }
     );
   });
   ```

3. **Atomic Verification Unit Test Specification**:
   Verify that when `UPDATE users` fails during `POST /api/auth/verify`, `auth_tokens.consumed_at` is rolled back:
   ```javascript
   test("email verification rolls back token consumption when user update fails", async () => {
     let rolledBack = false;
     // Verify with transaction mock recording ROLLBACK
   });
   ```

4. **Invalidation Conditions**:
   - If any change causes `npm test` pass count to fall below 98.
   - If `ROLLBACK` failure masks the original error or rethrows `rollbackError`.
   - If `bcrypt.hash` is called inside `withTransaction`, risking pool exhaustion under load.
