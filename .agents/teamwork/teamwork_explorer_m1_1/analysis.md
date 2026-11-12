# Analysis: Route Parameter & Query Validation Defects in `api/[...path].js`

## Executive Summary
This investigation analyzes two specific serverless API defects in `api/[...path].js`:
1. **Missing UUID validation** on note routes (`/api/notes/:id` across GET, PUT, DELETE) and flashcard routes (`/api/flashcards/:id` on DELETE and `/api/flashcards/:id/review` on POST). Without pre-validation, non-UUID identifiers are passed directly to PostgreSQL SQL queries expecting `UUID`, triggering PostgreSQL syntax error `22P02` (`invalid_text_representation`), which surfaces as an unhandled `500 INTERNAL_ERROR` via `safeError()`.
2. **Missing date parameter validation** on `GET /api/tasks?from=...&to=...`. Unvalidated query strings are passed to PostgreSQL queries casting `$2::timestamptz` and `$3::timestamptz`. Malformed date strings trigger PostgreSQL error `22007` (`invalid_datetime_format`), resulting in an unhandled `500 INTERNAL_ERROR` instead of a client-side `400 INVALID_DATE`.

A concrete fix strategy is specified below, including exact line numbers, code snippets, test reproduction cases, and a critical dependency warning regarding `"card-1"` in `tests/api-authenticated.test.js`.

---

## 1. Defect Analysis: Route Parameter UUID Validation

### 1.1 Affected Code Locations
In `api/[...path].js`:
- **Line 12**: Definition of `const idPattern = /^[0-9a-f-]{36}$/i;`
- **Lines 245–250 (Notes)**:
  - Line 248 (`PUT /api/notes/:id`):
    `const r=await query('UPDATE notes SET ... WHERE id=$3 AND user_id=$4 RETURNING *', [..., parts[1], user.id]);`
    `parts[1]` is passed directly to `$3` without `idPattern.test(parts[1])`.
  - Line 249 (`DELETE /api/notes/:id`):
    `const r=await query('DELETE FROM notes WHERE id=$1 AND user_id=$2 RETURNING id', [parts[1], user.id]);`
    `parts[1]` is passed directly to `$1` without `idPattern.test(parts[1])`.
  - Missing: `GET /api/notes/:id` route handler is omitted entirely; requests to `/api/notes/:id` fall through to 404 "API route was not found" rather than querying the note or returning standard `notFound(res, "Note")`.
- **Lines 252–257 (Flashcards)**:
  - Line 255 (`POST /api/flashcards/:id/review`):
    `client.query('SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE', [parts[1], user.id]);`
    `parts[1]` is passed directly to `$1` without `idPattern.test(parts[1])`.
  - Line 256 (`DELETE /api/flashcards/:id`):
    `const r=await query('DELETE FROM flashcards WHERE id=$1 AND user_id=$2 RETURNING id', [parts[1], user.id]);`
    `parts[1]` is passed directly to `$1` without `idPattern.test(parts[1])`.

### 1.2 Comparison with Other Protected Routes
Other entities in `api/[...path].js` already enforce `idPattern.test(id)` consistently:
- `goals`: Line 212: `if(!idPattern.test(parts[1])) return notFound(res,"Goal");`
- `courses`: Lines 213, 222, 223, 224, 225: `if(!idPattern.test(parts[1])) return notFound(res,"Course");`
- `course_modules`: Line 228: `if(!idPattern.test(parts[1])) return notFound(res,"Module");`
- `study_tasks`: Line 236: `if(!idPattern.test(taskId)) return notFound(res,"Task");`

Notes and flashcards are the only entities lacking this check.

### 1.3 Database Schema Evidence
In `db/schema.sql`:
- Line 126: `notes.id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- Line 140: `flashcards.id UUID PRIMARY KEY DEFAULT gen_random_uuid()`

PostgreSQL column types for `notes.id` and `flashcards.id` are native `UUID`. When non-UUID text (e.g. `"not-a-uuid"`, `"123"`) is bound to a UUID parameter in a prepared statement or parameterized query, PostgreSQL immediately throws `22P02`.

### 1.4 Failure Mode
1. Client sends `DELETE /api/notes/invalid-uuid` with authenticated session.
2. `parts[1]` is `"invalid-uuid"`.
3. `query("DELETE FROM notes WHERE id=$1...", ["invalid-uuid", user.id])` executes.
4. PostgreSQL engine fails with `error: invalid input syntax for type uuid: "invalid-uuid"`.
5. Error is unhandled inside `route()`, caught at line 287 by `safeError(res, error)`.
6. Client receives HTTP 500:
   ```json
   { "error": { "code": "INTERNAL_ERROR", "message": "The request could not be completed." } }
   ```
7. Expected behavior per REST API specification and `PROJECT.md` line 67:
   HTTP 404:
   ```json
   { "error": { "code": "NOT_FOUND", "message": "Note was not found." } }
   ```

---

## 2. Defect Analysis: Task Query Date Validation

### 2.1 Affected Code Location
In `api/[...path].js`:
- **Line 233 (`GET /api/tasks`)**:
  ```javascript
  if(parts.length===1&&methodName==="GET") {
    const from=url.searchParams.get("from"),to=url.searchParams.get("to");
    await query("UPDATE study_tasks SET status='overdue' WHERE user_id=$1 AND status IN ('upcoming','due','rescheduled') AND scheduled_at<NOW()-INTERVAL '1 day'",[user.id]);
    const r=await query(`SELECT t.*,l.objective,c.title AS course_title FROM study_tasks t LEFT JOIN lessons l ON l.id=t.lesson_id JOIN courses c ON c.id=t.course_id WHERE t.user_id=$1 AND ($2::timestamptz IS NULL OR t.scheduled_at >= $2) AND ($3::timestamptz IS NULL OR t.scheduled_at < $3) ORDER BY t.scheduled_at NULLS LAST LIMIT 200`,[user.id,from,to]);
    return sendJson(res,200,{tasks:r.rows});
  }
  ```

### 2.2 Failure Mode
1. Client sends `GET /api/tasks?from=not-a-date` or `GET /api/tasks?to=invalid`.
2. `from` is `"not-a-date"`.
3. Parameterized query casts `$2::timestamptz` and `$3::timestamptz`.
4. PostgreSQL engine fails with `error: invalid input syntax for type timestamp with time zone: "not-a-date"` (code `22007`).
5. Error bubbles to `safeError(res, error)`, returning HTTP 500 `INTERNAL_ERROR`.
6. Expected behavior per `PROJECT.md` line 66:
   HTTP 400:
   ```json
   { "error": { "code": "INVALID_DATE", "message": "Choose a valid date and time." } }
   ```

### 2.3 Existing Pattern in Codebase
In `api/[...path].js` line 239 (`POST /api/tasks/:id/reschedule`):
```javascript
if(action==="reschedule") {
  if(!b.scheduledAt||Number.isNaN(Date.parse(b.scheduledAt)))
    return sendError(res,400,"INVALID_DATE","Choose a valid date and time.");
  ...
}
```
The exact error code `"INVALID_DATE"` and message `"Choose a valid date and time."` are already used here and verified in `tests/api-authenticated.test.js` line 316.

---

## 3. Concrete Fix Strategy

### 3.1 Proposed Code Modifications in `api/[...path].js`

#### Modification A: Date Validation in `GET /api/tasks` (Line 233)
**Target location**: `api/[...path].js`, line 233.
**Logic**: Check `from` and `to` query parameters immediately before running database operations. If `from !== null` and `Number.isNaN(Date.parse(from))`, or `to !== null` and `Number.isNaN(Date.parse(to))`, return HTTP 400 with `sendError(res, 400, "INVALID_DATE", "Choose a valid date and time.")`.

```javascript
// BEFORE (line 233):
if(parts.length===1&&methodName==="GET") { const from=url.searchParams.get("from"),to=url.searchParams.get("to"); await query("UPDATE study_tasks SET status='overdue' WHERE user_id=$1 AND status IN ('upcoming','due','rescheduled') AND scheduled_at<NOW()-INTERVAL '1 day'",[user.id]); const r=await query(`SELECT t.*,l.objective,c.title AS course_title FROM study_tasks t LEFT JOIN lessons l ON l.id=t.lesson_id JOIN courses c ON c.id=t.course_id WHERE t.user_id=$1 AND ($2::timestamptz IS NULL OR t.scheduled_at >= $2) AND ($3::timestamptz IS NULL OR t.scheduled_at < $3) ORDER BY t.scheduled_at NULLS LAST LIMIT 200`,[user.id,from,to]); return sendJson(res,200,{tasks:r.rows}); }

// AFTER:
if(parts.length===1&&methodName==="GET") {
  const from=url.searchParams.get("from"),to=url.searchParams.get("to");
  if(from!==null&&Number.isNaN(Date.parse(from))) return sendError(res,400,"INVALID_DATE","Choose a valid date and time.");
  if(to!==null&&Number.isNaN(Date.parse(to))) return sendError(res,400,"INVALID_DATE","Choose a valid date and time.");
  await query("UPDATE study_tasks SET status='overdue' WHERE user_id=$1 AND status IN ('upcoming','due','rescheduled') AND scheduled_at<NOW()-INTERVAL '1 day'",[user.id]);
  const r=await query(`SELECT t.*,l.objective,c.title AS course_title FROM study_tasks t LEFT JOIN lessons l ON l.id=t.lesson_id JOIN courses c ON c.id=t.course_id WHERE t.user_id=$1 AND ($2::timestamptz IS NULL OR t.scheduled_at >= $2) AND ($3::timestamptz IS NULL OR t.scheduled_at < $3) ORDER BY t.scheduled_at NULLS LAST LIMIT 200`,[user.id,from,to]);
  return sendJson(res,200,{tasks:r.rows});
}
```

#### Modification B: UUID Validation on Notes (Lines 245–250)
**Target location**: `api/[...path].js`, lines 248–250.
**Logic**: Enforce `idPattern.test(parts[1])` on all `/api/notes/:id` endpoints (GET, PUT, DELETE). Add the missing `GET /api/notes/:id` handler to return `{ note: r.rows[0] }` or 404.

```javascript
// BEFORE (lines 248-249):
if(parts.length===2&&methodName==="PUT") { const b=await bodyOf(req),r=await query(`UPDATE notes SET title=$1,body=$2,updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`,[String(b.title||"").trim().slice(0,160),String(b.body||"").slice(0,30000),parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); return sendJson(res,200,{note:r.rows[0]}); }
if(parts.length===2&&methodName==="DELETE") { const r=await query("DELETE FROM notes WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); return sendJson(res,200,{deleted:true}); }

// AFTER:
if(parts.length===2) {
  if(!idPattern.test(parts[1])) return notFound(res,"Note");
  if(methodName==="GET") { const r=await query(`SELECT n.*,c.title course_title,l.title lesson_title FROM notes n LEFT JOIN courses c ON c.id=n.course_id LEFT JOIN lessons l ON l.id=n.lesson_id WHERE n.id=$1 AND n.user_id=$2`,[parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); return sendJson(res,200,{note:r.rows[0]}); }
  if(methodName==="PUT") { const b=await bodyOf(req),r=await query(`UPDATE notes SET title=$1,body=$2,updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`,[String(b.title||"").trim().slice(0,160),String(b.body||"").slice(0,30000),parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); return sendJson(res,200,{note:r.rows[0]}); }
  if(methodName==="DELETE") { const r=await query("DELETE FROM notes WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); return sendJson(res,200,{deleted:true}); }
}
```

#### Modification C: UUID Validation on Flashcards (Lines 252–257)
**Target location**: `api/[...path].js`, lines 255–256.
**Logic**: Enforce `idPattern.test(parts[1])` on both `/api/flashcards/:id/review` and `DELETE /api/flashcards/:id`.

```javascript
// BEFORE (lines 255-256):
if(parts.length===3&&parts[2]==="review"&&methodName==="POST") { const b=await bodyOf(req),rating=String(b.rating||""); if(!["Again","Hard","Good","Easy"].includes(rating))return sendError(res,400,"INVALID_RATING","Choose Again, Hard, Good, or Easy."); const out=await withTransaction(async(client)=>{const found=await client.query("SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE",[parts[1],user.id]); ...
if(parts.length===2&&methodName==="DELETE") { const r=await query("DELETE FROM flashcards WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]); if(!r.rows[0])return notFound(res,"Flashcard"); return sendJson(res,200,{deleted:true}); }

// AFTER:
if(parts.length===3&&parts[2]==="review"&&methodName==="POST") {
  if(!idPattern.test(parts[1])) return notFound(res,"Flashcard");
  const b=await bodyOf(req),rating=String(b.rating||"");
  if(!["Again","Hard","Good","Easy"].includes(rating))return sendError(res,400,"INVALID_RATING","Choose Again, Hard, Good, or Easy.");
  const out=await withTransaction(async(client)=>{const found=await client.query("SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE",[parts[1],user.id]); if(!found.rows[0])return null; const card=found.rows[0],days=rating==="Again"?0:rating==="Hard"?Math.max(1,Math.round((Number(card.interval_days)||1)*1.2)):rating==="Easy"?Math.max(3,Math.round((Number(card.interval_days)||1)*2.5)):Math.max(1,Math.round((Number(card.interval_days)||1)*2)); const due=days===0?new Date(Date.now()+10*60*1000):new Date(Date.now()+days*86400000); await client.query("INSERT INTO review_events(user_id,flashcard_id,rating,next_due_at) VALUES($1,$2,$3,$4)",[user.id,card.id,rating,due]); const updated=await client.query("UPDATE flashcards SET due_at=$1,interval_days=$2,repetitions=repetitions+1,ease=GREATEST(1.3,ease+$3) WHERE id=$4 RETURNING *",[due,days,rating==="Easy"?0.15:rating==="Again"?-0.2:0,card.id]); return updated.rows[0];});
  if(!out)return notFound(res,"Flashcard");
  return sendJson(res,200,{flashcard:out});
}
if(parts.length===2&&methodName==="DELETE") {
  if(!idPattern.test(parts[1])) return notFound(res,"Flashcard");
  const r=await query("DELETE FROM flashcards WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]);
  if(!r.rows[0])return notFound(res,"Flashcard");
  return sendJson(res,200,{deleted:true});
}
```

---

## 4. Critical Investigation Finding: Existing Test Incompatibility

### 4.1 Discovery in `tests/api-authenticated.test.js`
In `tests/api-authenticated.test.js`:
- Line 226:
  `const invalid = await callApi({ path: "flashcards/card-1/review", method: "POST", body: { rating: "Maybe" } });`
- Line 229:
  `const valid = await callApi({ path: "flashcards/card-1/review", method: "POST", body: { rating: "Good" } });`

Notice that the existing test passed `"card-1"` as the flashcard ID.
`"card-1"` has 6 characters and fails `idPattern = /^[0-9a-f-]{36}$/i`.

### 4.2 Impact of Fix on Existing Test
If the Worker introduces `if(!idPattern.test(parts[1])) return notFound(res,"Flashcard");` to line 255:
- `invalid` at line 226 will receive 404 `NOT_FOUND` instead of reaching rating validation and returning 400 `INVALID_RATING`.
- `valid` at line 229 will receive 404 `NOT_FOUND` instead of 200.
- `node --test` will FAIL on `tests/api-authenticated.test.js`!

### 4.3 Resolution Strategy for Worker
In `tests/api-authenticated.test.js`:
Define a valid UUID constant near line 22:
```javascript
const cardId = "44444444-4444-4444-8444-444444444444";
```
Update lines 226 and 229 to use `cardId`:
```javascript
const invalid = await callApi({ path: `flashcards/${cardId}/review`, method: "POST", body: { rating: "Maybe" } });
assert.equal(invalid.status, 400);
assert.equal(invalid.json.error.code, "INVALID_RATING");
const valid = await callApi({ path: `flashcards/${cardId}/review`, method: "POST", body: { rating: "Good" } });
assert.equal(valid.status, 200);
assert.equal(valid.json.flashcard.interval_days, 4);
```
In `queryStub` (lines 116–119), `SELECT * FROM flashcards WHERE id=$1` matches regardless of the parameter value, so this change immediately satisfies both the UUID validation requirement and keeps existing tests green.

---

## 5. Verification Plan

### 5.1 Automated Test Assertions to Add
The Worker should add the following targeted test assertions:
```javascript
test("route parameter and query validation enforces UUIDs and dates", async (t) => {
  await t.test("rejects malformed task date filters with 400 INVALID_DATE", async () => {
    const resFrom = await callApi({ path: "tasks?from=not-a-date", method: "GET" });
    assert.equal(resFrom.status, 400);
    assert.equal(resFrom.json.error.code, "INVALID_DATE");

    const resTo = await callApi({ path: "tasks?to=not-a-date", method: "GET" });
    assert.equal(resTo.status, 400);
    assert.equal(resTo.json.error.code, "INVALID_DATE");
  });

  await t.test("accepts valid ISO date filters on GET /api/tasks", async () => {
    const res = await callApi({ path: "tasks?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z", method: "GET" });
    assert.equal(res.status, 200);
  });

  await t.test("rejects non-UUID note IDs with 404 NOT_FOUND", async () => {
    for (const method of ["GET", "PUT", "DELETE"]) {
      const res = await callApi({ path: "notes/not-a-uuid", method, body: { title: "T", body: "B" } });
      assert.equal(res.status, 404);
      assert.equal(res.json.error.code, "NOT_FOUND");
    }
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
```

### 5.2 Verification Command
```powershell
node --test
```
All existing tests (98 passed) plus new verification tests must pass with 0 failures.
