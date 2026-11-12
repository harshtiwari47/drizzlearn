# Handoff Report: Route Parameter & Query Validation (Milestone 1 Explorer 1)

## 1. Observation
1. **`api/[...path].js:12`**: Defines `idPattern = /^[0-9a-f-]{36}$/i;` for UUID matching across the API router.
2. **`api/[...path].js:233`**:
   ```javascript
   if(parts.length===1&&methodName==="GET") {
     const from=url.searchParams.get("from"),to=url.searchParams.get("to");
     await query("UPDATE study_tasks SET status='overdue' WHERE user_id=$1 AND status IN ('upcoming','due','rescheduled') AND scheduled_at<NOW()-INTERVAL '1 day'",[user.id]);
     const r=await query(`SELECT t.*,l.objective,c.title AS course_title FROM study_tasks t LEFT JOIN lessons l ON l.id=t.lesson_id JOIN courses c ON c.id=t.course_id WHERE t.user_id=$1 AND ($2::timestamptz IS NULL OR t.scheduled_at >= $2) AND ($3::timestamptz IS NULL OR t.scheduled_at < $3) ORDER BY t.scheduled_at NULLS LAST LIMIT 200`,[user.id,from,to]);
     return sendJson(res,200,{tasks:r.rows});
   }
   ```
   Neither `from` nor `to` is validated prior to execution. If either contains an invalid date, PostgreSQL throws `22007: invalid input syntax for type timestamp with time zone`, caught at line 287 by `safeError()`, returning `500 INTERNAL_ERROR` (`"The request could not be completed."`).
3. **`api/[...path].js:248–249`**:
   - Line 248: `if(parts.length===2&&methodName==="PUT") { const b=await bodyOf(req),r=await query('UPDATE notes SET ... WHERE id=$3 AND user_id=$4 RETURNING *',[...,parts[1],user.id]); ... }`
   - Line 249: `if(parts.length===2&&methodName==="DELETE") { const r=await query("DELETE FROM notes WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]); ... }`
   - Missing: `GET /api/notes/:id` is omitted; neither `PUT` nor `DELETE` validates `idPattern.test(parts[1])`.
4. **`api/[...path].js:255–256`**:
   - Line 255: `if(parts.length===3&&parts[2]==="review"&&methodName==="POST") { ... const found=await client.query("SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE",[parts[1],user.id]); ... }`
   - Line 256: `if(parts.length===2&&methodName==="DELETE") { const r=await query("DELETE FROM flashcards WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]); ... }`
   - Neither route validates `idPattern.test(parts[1])`.
5. **`db/schema.sql:126,140`**: `notes.id` and `flashcards.id` are defined as native `UUID PRIMARY KEY DEFAULT gen_random_uuid()`. Non-UUID parameters throw PostgreSQL error `22P02: invalid input syntax for type uuid`, bubbling to HTTP 500.
6. **`tests/api-authenticated.test.js:226,229`**:
   ```javascript
   const invalid = await callApi({ path: "flashcards/card-1/review", method: "POST", body: { rating: "Maybe" } });
   const valid = await callApi({ path: "flashcards/card-1/review", method: "POST", body: { rating: "Good" } });
   ```
   The existing test suite passes a 6-character non-UUID `"card-1"` to `/api/flashcards/:id/review`.

---

## 2. Logic Chain
1. **From Observation 2**: Calling `GET /api/tasks?from=invalid` or `GET /api/tasks?to=invalid` passes raw strings to SQL `$2::timestamptz` and `$3::timestamptz`. In Postgres, invalid timestamp casts throw `22007`. Because no `try/catch` surrounds this in `route()`, line 287 catches the error and executes `safeError(res, error)`, returning HTTP 500. Validating `Date.parse(from)` and `Date.parse(to)` before `query()` intercepts malformed input and returns HTTP 400 `INVALID_DATE` with message `"Choose a valid date and time."` matching the existing convention in line 239.
2. **From Observations 3, 4, and 5**: In `courses` (lines 222–225), `goals` (line 212), `modules` (line 228), and `tasks` (line 236), `api/[...path].js` validates route IDs with `!idPattern.test(...)` and returns `notFound(res, "<Entity>")`. In `notes` and `flashcards`, this check is omitted. Because columns are typed `UUID`, passing non-UUID strings to PostgreSQL yields `22P02` (500). Adding `if(!idPattern.test(parts[1])) return notFound(res, "Note")` and `notFound(res, "Flashcard")` aligns these endpoints with the rest of the API and prevents database crashes. Adding `GET /api/notes/:id` fulfills Feature Inventory #23.
3. **From Observation 6**: Adding `if(!idPattern.test(parts[1])) return notFound(res, "Flashcard");` to `flashcards/:id/review` will cause `tests/api-authenticated.test.js` lines 226 and 229 to receive 404 instead of 400 and 200, breaking the existing test. Updating the test to pass a 36-character UUID (e.g. `cardId = "44444444-4444-4444-8444-444444444444"`) allows both the UUID validation fix and the test assertions to pass cleanly.

---

## 3. Caveats
1. **Existing Test Dependency**: The Worker MUST update `tests/api-authenticated.test.js` lines 226 and 229 to use a valid UUID constant when implementing the flashcard UUID check, or existing tests will fail.
2. **`Date.parse("")` behavior**: An empty query parameter like `?from=` results in `Date.parse("") === NaN`, which triggers the 400 `INVALID_DATE` error. This is intentional because PostgreSQL cannot cast empty string to `timestamptz`.
3. **Read-Only Explorer Scope**: In accordance with the Explorer archetype, no source files have been edited. All proposed changes are documented as concrete drop-in replacements in `analysis.md`.

---

## 4. Conclusion
The validation defects are localized to three blocks in `api/[...path].js`:
1. Line 233 (`GET /api/tasks`): Add `Date.parse()` checks for `from` and `to`.
2. Lines 248–250 (`/api/notes/:id`): Wrap `parts.length === 2` with `if(!idPattern.test(parts[1])) return notFound(res, "Note");` and handle GET, PUT, DELETE.
3. Lines 255–256 (`/api/flashcards/:id`): Add `if(!idPattern.test(parts[1])) return notFound(res, "Flashcard");` to review (POST) and DELETE.
4. `tests/api-authenticated.test.js`: Update lines 226 and 229 from `"card-1"` to a 36-character UUID constant.

---

## 5. Verification Method
1. **Command to run**:
   ```powershell
   node --test
   ```
2. **Test assertions to verify fix**:
   - `GET /api/tasks?from=invalid` returns status `400` and `error.code === "INVALID_DATE"`.
   - `GET /api/tasks?to=invalid` returns status `400` and `error.code === "INVALID_DATE"`.
   - `GET /api/tasks?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z` returns status `200`.
   - `GET /api/notes/non-uuid` returns status `404` and `error.code === "NOT_FOUND"`.
   - `PUT /api/notes/non-uuid` returns status `404` and `error.code === "NOT_FOUND"`.
   - `DELETE /api/notes/non-uuid` returns status `404` and `error.code === "NOT_FOUND"`.
   - `DELETE /api/flashcards/non-uuid` returns status `404` and `error.code === "NOT_FOUND"`.
   - `POST /api/flashcards/non-uuid/review` with valid rating returns status `404` and `error.code === "NOT_FOUND"`.
3. **Invalidation condition**: Any 500 status returned when passing malformed dates to `GET /api/tasks` or non-UUID strings to `/api/notes/:id` or `/api/flashcards/:id`.
