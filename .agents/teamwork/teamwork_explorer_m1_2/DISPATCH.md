# Task Assignment: Milestone 1 Explorer 2 — Transaction Safety & Atomicity

## Mission
Analyze and specify the precise fix strategy for database transaction safety and error handling in `api/[...path].js` and `server/db.js`:
1. Multi-step un-transactioned token consumption in `POST /api/auth/verify` and `POST /api/auth/reset-password`. Tokens are consumed in query 1 while user is updated in query 2. If query 2 fails, token is wasted and user is locked out.
2. Multi-step un-transactioned update in `PUT /api/courses/:id` where course is updated in query 1 and goal is updated in query 2.
3. Rollback error masking in `server/db.js:withTransaction()`: `catch (error) { await client.query("ROLLBACK"); throw error; }` can throw an unhandled rollback error, masking the original root cause error.

## Mandatory Reading
Read the original request verbatim before starting:
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\ORIGINAL_REQUEST.md`

## Project Scope
Read project scope and contracts:
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\orchestrator\PROJECT.md`

## Working Directory
`c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_2\`

## Objectives
1. Inspect `server/db.js` `withTransaction` implementation.
2. Inspect `api/[...path].js` auth verify, reset-password, and course update routes.
3. Formulate an exact fix strategy for wrapping multi-step queries in `withTransaction(async (client) => { ... })` and safely catching `ROLLBACK` errors in `server/db.js` so original errors are re-thrown.
4. DO NOT modify any code directly.
5. Write your findings to `analysis.md` and deliver `handoff.md`.


## 2026-11-11T06:54:20Z
You are Milestone 1 Explorer 2 (Transaction Safety & Atomicity).
Your working directory: c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\teamwork_explorer_m1_2\
Read DISPATCH.md in your working directory, ORIGINAL_REQUEST.md at c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\ORIGINAL_REQUEST.md, and PROJECT.md at c:\Users\HARSH TIWARI\Desktop\buildathon\.agents\teamwork\orchestrator\PROJECT.md.
Investigate transaction boundaries in api/[...path].js and rollback error handling in server/db.js. Provide a concrete fix strategy for wrapping multi-step queries in withTransaction and defensive rollback handling.
Write analysis.md and handoff.md in your working directory, and message back when complete.
