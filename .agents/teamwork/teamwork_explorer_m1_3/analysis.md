# Database Schema Integrity, Foreign Key Indexes, & Cascades Analysis

**Author:** Milestone 1 Explorer 3 (Schema Integrity & Indexes)  
**Target:** `db/schema.sql`, `scripts/migrate.js`, and data access layer (`server/`, `api/`)  
**Date:** 2026-11-11  

---

## 1. Executive Summary

A comprehensive investigation was conducted on `db/schema.sql`, `scripts/migrate.js`, and database access patterns across `api/[...path].js` and `server/` (`plan-service.js`, `retrieval.js`, `auth.js`, `db.js`).

### Key Findings
1. **Pervasive Missing Foreign Key Indexes**:
   - The Drizzlearn schema defines **14 tables** and **25 foreign key relationships**.
   - **12 out of 25 foreign keys (48%) lack index coverage**.
   - While foreign keys referencing `users(id)` generally have composite indexes with `user_id` as the leading column, almost **all foreign keys referencing other domain entities** (`courses`, `lessons`, `learning_goals`, `study_tasks`, `flashcards`) are completely unindexed.
2. **Cascading Delete & Nullification Performance Vulnerabilities**:
   - In PostgreSQL, foreign keys do NOT automatically create indexes.
   - When a parent row is deleted:
     - `ON DELETE CASCADE` requires PostgreSQL to find all matching child rows.
     - `ON DELETE SET NULL` requires PostgreSQL to find all matching child rows to set their foreign key column to `NULL`.
     - Without an index on the child table's foreign key column, PostgreSQL must perform a **full sequential table scan** on the child table.
   - Deleting a course, lesson, flashcard, or user account triggers multiple sequential scans across large tables (`lessons`, `study_tasks`, `practice_attempts`, `notes`, `flashcards`, `review_events`, `ai_jobs`).
   - In `improveCourseProposal` (`server/plan-service.js:53`), every proposal regeneration calls `DELETE FROM course_modules WHERE course_id=$1`, which cascades to delete all lessons and subsequently forces full sequential scans on `notes`, `flashcards`, `study_tasks`, and `practice_attempts` to set their `lesson_id` to `NULL`.
3. **API Query Bottlenecks**:
   - Correlated subqueries and joins in `/api/home`, `/api/courses`, `/api/tasks`, `/api/progress`, and `server/retrieval.js` frequently filter or join on unindexed foreign keys (e.g. `lessons.course_id`, `study_tasks.course_id`, `courses.goal_id`).
4. **Data Integrity & Cascade Semantics**:
   - The dual cascade strategy (`CASCADE` for ownership hierarchy, `SET NULL` for learner-created knowledge artifacts like notes and flashcards) is architecturally sound and aligns with Drizzlearn's core principles: learner work is preserved even if courses or lessons are deleted.
   - However, without indexes, executing these cascade and SET NULL actions incurs severe locking overhead and latency.

---

## 2. Comprehensive Foreign Key & Index Inventory

Below is an exhaustive catalog of all foreign key relationships in `db/schema.sql` and their index status:

| # | Child Table | Foreign Key Column | Parent Table(Column) | Cascade Action | Existing Index Covering FK? | Index Name (if covered) | Status |
|---|---|---|---|---|---|---|---|
| 1 | `auth_tokens` | `user_id` | `users(id)` | `CASCADE` | **YES** | `auth_tokens_user_purpose_idx (user_id, purpose)` | Covered |
| 2 | `learning_goals` | `user_id` | `users(id)` | `CASCADE` | **YES** | `learning_goals_user_status_idx (user_id, status)` | Covered |
| 3 | `courses` | `user_id` | `users(id)` | `CASCADE` | **YES** | `courses_user_status_idx (user_id, status)` | Covered |
| 4 | `courses` | `goal_id` | `learning_goals(id)` | `CASCADE` | **NO** | None | **MISSING** |
| 5 | `course_modules` | `course_id` | `courses(id)` | `CASCADE` | **YES** | `UNIQUE(course_id, position)` (btree index) | Covered |
| 6 | `lessons` | `course_id` | `courses(id)` | `CASCADE` | **NO** | None | **MISSING** |
| 7 | `lessons` | `module_id` | `course_modules(id)` | `CASCADE` | **YES** | `UNIQUE(module_id, position)` (btree index) | Covered |
| 8 | `study_tasks` | `user_id` | `users(id)` | `CASCADE` | **YES** | `study_tasks_user_schedule_idx (user_id, scheduled_at, status)` | Covered |
| 9 | `study_tasks` | `course_id` | `courses(id)` | `CASCADE` | **NO** | None | **MISSING** |
| 10 | `study_tasks` | `lesson_id` | `lessons(id)` | `SET NULL` | **NO** | None | **MISSING** |
| 11 | `practice_attempts` | `user_id` | `users(id)` | `CASCADE` | **YES** | `practice_attempts_user_created_idx (user_id, created_at DESC)` | Covered |
| 12 | `practice_attempts` | `task_id` | `study_tasks(id)` | `SET NULL` | **NO** | None | **MISSING** |
| 13 | `practice_attempts` | `lesson_id` | `lessons(id)` | `SET NULL` | **NO** | None | **MISSING** |
| 14 | `notes` | `user_id` | `users(id)` | `CASCADE` | **YES** | `notes_user_updated_idx (user_id, updated_at DESC)` | Covered |
| 15 | `notes` | `course_id` | `courses(id)` | `SET NULL` | **NO** | None | **MISSING** |
| 16 | `notes` | `lesson_id` | `lessons(id)` | `SET NULL` | **NO** | None | **MISSING** |
| 17 | `flashcards` | `user_id` | `users(id)` | `CASCADE` | **YES** | `flashcards_user_due_idx (user_id, due_at)` | Covered |
| 18 | `flashcards` | `course_id` | `courses(id)` | `SET NULL` | **NO** | None | **MISSING** |
| 19 | `flashcards` | `lesson_id` | `lessons(id)` | `SET NULL` | **NO** | None | **MISSING** |
| 20 | `review_events` | `user_id` | `users(id)` | `CASCADE` | **YES** | `review_events_user_reviewed_idx (user_id, reviewed_at DESC)` | Covered |
| 21 | `review_events` | `flashcard_id` | `flashcards(id)` | `CASCADE` | **NO** | None | **MISSING** |
| 22 | `study_rooms` | `owner_user_id` | `users(id)` | `CASCADE` | **YES** | `study_rooms_owner_updated_idx (owner_user_id, updated_at DESC)` | Covered |
| 23 | `study_room_members` | `room_id` | `study_rooms(id)` | `CASCADE` | **YES** | `PRIMARY KEY (room_id, user_id)` (leading column `room_id`) | Covered |
| 24 | `study_room_members` | `user_id` | `users(id)` | `CASCADE` | **YES** | `study_room_members_user_seen_idx (user_id, last_seen_at DESC)` | Covered |
| 25 | `ai_jobs` | `user_id` | `users(id)` | `CASCADE` | **NO** | None | **MISSING** |

**Summary Metrics**:
- Total tables: 14
- Total foreign keys: 25
- Indexed foreign keys: 13 (52%)
- **Missing foreign key indexes: 12 (48%)**

---

## 3. Data Integrity & Cascade Flow Analysis

### 3.1 Hard Cascades (`ON DELETE CASCADE`)
Hard cascading is used where child records have no independent semantic existence without the parent:
1. **Account Deletion (`users` -> All Tables)**:
   - When a user deletes their account (`DELETE /api/account` at `api/[...path].js:275`), the delete cascades to all 13 user-scoped tables.
   - Because `ai_jobs` lacks any index on `user_id`, PostgreSQL must scan the entire `ai_jobs` table.
2. **Goal Deletion (`learning_goals` -> `courses`)**:
   - `courses.goal_id REFERENCES learning_goals(id) ON DELETE CASCADE`.
   - Without an index on `courses(goal_id)`, deleting a goal triggers a full table scan on `courses`.
3. **Course Deletion (`courses` -> `course_modules`, `lessons`, `study_tasks`)**:
   - `course_modules` is indexed via composite `(course_id, position)`.
   - `lessons` has **no index on `course_id`**, forcing a full scan on `lessons`.
   - `study_tasks` has **no index on `course_id`**, forcing a full scan on `study_tasks`.
4. **Flashcard Deletion (`flashcards` -> `review_events`)**:
   - When a flashcard is deleted (`DELETE /api/flashcards/:id` at `api/[...path].js:256`), Postgres cascades to `review_events`.
   - `review_events` can contain thousands of spaced repetition review logs per learner.
   - Because `review_events.flashcard_id` is unindexed, every card deletion triggers an $O(N)$ sequential scan across all review events of all learners!

### 3.2 Soft-Preservation Semantics (`ON DELETE SET NULL`)
In accordance with Drizzlearn product requirements:
- Learner-created notes and flashcards must survive course and lesson modifications.
- Practice history must remain intact even if the associated study task is rescheduled or deleted.
- Relationships configured as `ON DELETE SET NULL`:
  - `study_tasks.lesson_id`
  - `practice_attempts.task_id`
  - `practice_attempts.lesson_id`
  - `notes.course_id`
  - `notes.lesson_id`
  - `flashcards.course_id`
  - `flashcards.lesson_id`

**Cascade Execution Mechanics**:
When a parent record (e.g. `lessons`) is deleted, PostgreSQL must locate every child row where `child.lesson_id = deleted_id` and update it to `NULL`.
Because `study_tasks.lesson_id`, `practice_attempts.lesson_id`, `notes.lesson_id`, and `flashcards.lesson_id` all lack indexes:
Deleting a **single lesson** triggers **four concurrent full table scans** on `study_tasks`, `practice_attempts`, `notes`, and `flashcards`!

### 3.3 Course Proposal Improvement Cascade
In `server/plan-service.js:53`:
```javascript
await client.query("DELETE FROM course_modules WHERE course_id=$1", [courseId]);
```
During course proposal improvement:
1. `course_modules` are deleted.
2. `lessons` are cascade-deleted via `lessons.module_id ON DELETE CASCADE`.
3. For each deleted lesson, Postgres executes four unindexed sequential scans across `study_tasks`, `practice_attempts`, `notes`, and `flashcards` to set `lesson_id = NULL`.
Adding indexes to these columns eliminates this overhead completely.

---

## 4. Query Acceleration in API Routes

The missing indexes directly accelerate key API routes:

| API Route | Query Location | Query Pattern | Missing Index | Performance Gain |
|---|---|---|---|---|
| `GET /api/courses` | `api/[...path].js:218-221` | `JOIN learning_goals g ON g.id = c.goal_id`<br>`SELECT COUNT(*) FROM lessons WHERE course_id = c.id`<br>`SELECT COUNT(*) FROM study_tasks WHERE course_id = c.id AND status='completed'` | `courses(goal_id)`<br>`lessons(course_id)`<br>`study_tasks(course_id, status)` | Eliminates 3 correlated sequential scans per course |
| `GET /api/home` | `api/[...path].js:65-67` | `JOIN learning_goals g ON g.id = c.goal_id`<br>`SELECT COUNT(*) FROM lessons WHERE course_id = c.id`<br>`SELECT COUNT(*) FROM study_tasks WHERE course_id = c.id AND status='completed'` | `courses(goal_id)`<br>`lessons(course_id)`<br>`study_tasks(course_id, status)` | Accelerates dashboard initial load |
| `POST /api/courses/:id/approve` | `server/plan-service.js:65, 78` | `FROM courses c JOIN learning_goals g ON g.id=c.goal_id`<br>`SELECT ... FROM lessons WHERE course_id = $1` | `courses(goal_id)`<br>`lessons(course_id)` | Speeds up approval and task generation |
| `POST /api/tasks/:id/complete` | `api/[...path].js:240` | `SELECT id FROM practice_attempts WHERE user_id=$1 AND lesson_id=$2 AND score>=70` | `practice_attempts(lesson_id)` | Direct index lookup for completion checkpoint evidence |
| `GET /api/tasks` | `api/[...path].js:233` | `LEFT JOIN lessons l ON l.id = t.lesson_id JOIN courses c ON c.id = t.course_id` | `study_tasks(course_id)`<br>`study_tasks(lesson_id)` | Nested loop join speedup |
| `GET /api/notes` | `api/[...path].js:246` | `LEFT JOIN courses c ON c.id=n.course_id LEFT JOIN lessons l ON l.id=n.lesson_id` | `notes(course_id)`<br>`notes(lesson_id)` | Eliminates hash join builds |
| `GET /api/flashcards` | `api/[...path].js:253` | `LEFT JOIN lessons l ON l.id = f.lesson_id` | `flashcards(lesson_id)` | Direct index join |
| Context Retrieval | `server/retrieval.js:19` | `FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.user_id=$1` | `lessons(course_id)` | Accelerates AI tutor and planning semantic retrieval |

---

## 5. Concrete Migration & Index Strategy

### 5.1 SQL DDL Additions for `db/schema.sql`

All index statements must follow the existing naming conventions, use `IF NOT EXISTS` for idempotency, and be positioned immediately after their table definitions:

```sql
-- 1. Courses: index on goal_id
CREATE INDEX IF NOT EXISTS courses_goal_idx ON courses(goal_id);

-- 2. Lessons: index on course_id
CREATE INDEX IF NOT EXISTS lessons_course_idx ON lessons(course_id);

-- 3. Study Tasks: composite index on course_id and status, plus index on lesson_id
CREATE INDEX IF NOT EXISTS study_tasks_course_status_idx ON study_tasks(course_id, status);
CREATE INDEX IF NOT EXISTS study_tasks_lesson_idx ON study_tasks(lesson_id);

-- 4. Practice Attempts: indexes on task_id and lesson_id
CREATE INDEX IF NOT EXISTS practice_attempts_task_idx ON practice_attempts(task_id);
CREATE INDEX IF NOT EXISTS practice_attempts_lesson_idx ON practice_attempts(lesson_id);

-- 5. Notes: indexes on course_id and lesson_id
CREATE INDEX IF NOT EXISTS notes_course_idx ON notes(course_id);
CREATE INDEX IF NOT EXISTS notes_lesson_idx ON notes(lesson_id);

-- 6. Flashcards: indexes on course_id and lesson_id
CREATE INDEX IF NOT EXISTS flashcards_course_idx ON flashcards(course_id);
CREATE INDEX IF NOT EXISTS flashcards_lesson_idx ON flashcards(lesson_id);

-- 7. Review Events: index on flashcard_id
CREATE INDEX IF NOT EXISTS review_events_flashcard_idx ON review_events(flashcard_id);

-- 8. AI Jobs: index on user_id and status
CREATE INDEX IF NOT EXISTS ai_jobs_user_status_idx ON ai_jobs(user_id, status);
```

### 5.2 Migration Execution Script (`scripts/migrate.js`) Review

`scripts/migrate.js` reads `db/schema.sql` and executes `await pool.query(sql)`.
- **Protocol**: `pg` sends multi-statement strings through PostgreSQL's simple query protocol, executing all statements in sequence.
- **Idempotency**: Because all statements use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `migrate.js` can be executed safely multiple times on both fresh and established databases.
- **Limitation**: `CREATE INDEX CONCURRENTLY` cannot be executed in a multi-statement simple query batch. Therefore, standard `CREATE INDEX IF NOT EXISTS` is the correct approach for `db/schema.sql`.
- **Recommended Hardening**: Ensure `scripts/migrate.js` catches execution errors explicitly, logs the offending message, and exits with non-zero exit code:
  ```javascript
  try {
    await pool.query(sql);
    console.log("LearnOS database schema is ready.");
  } catch (error) {
    console.error("LearnOS migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
  ```

---

## 6. Automated Verification Strategy

To guarantee data integrity and index coverage going forward, the following test strategies should be incorporated into the verification test suite:

### 6.1 Programmatic Schema Catalog Audit (Zero Unindexed Foreign Keys)
A verification test should query PostgreSQL's system catalogs to verify that **every** foreign key constraint in the schema has an index where the foreign key column is the leading key:

```sql
SELECT
  conrelid::regclass AS child_table,
  conname AS foreign_key_name,
  attname AS fk_column,
  confrelid::regclass AS parent_table
FROM (
  SELECT
    c.conrelid,
    c.conname,
    c.confrelid,
    a.attname,
    c.conkey,
    array_position(c.conkey, a.attnum) AS key_pos
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.contype = 'f'
) fk
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_index i
  WHERE i.indrelid = fk.conrelid
    AND i.indkey[0] = fk.conkey[fk.key_pos - 1]
)
ORDER BY child_table, foreign_key_name;
```
*Expected test assertion:* Returns 0 rows.

### 6.2 Data Integrity Cascade Verification Tests
1. **User Account Cascade (`ON DELETE CASCADE`)**:
   - Seed complete account tree (user, goal, course, module, lesson, task, attempt, note, card, review, room, member, ai_job).
   - Execute `DELETE FROM users WHERE id = $1`.
   - Assert count across all 14 tables for that user is exactly 0.
2. **Flashcard Review Cascade (`ON DELETE CASCADE`)**:
   - Seed card with multiple reviews.
   - Delete card.
   - Assert all reviews for that card are deleted.
3. **Learner Artifact Preservation (`ON DELETE SET NULL`)**:
   - Seed course with lessons, notes, flashcards, tasks, and practice attempts.
   - Delete course.
   - Assert:
     - Notes and flashcards remain in database.
     - `notes.course_id` and `flashcards.course_id` are `NULL`.
4. **Lesson Deletion Preservation (`ON DELETE SET NULL`)**:
   - Seed lesson with linked task, practice attempt, note, and card.
   - Delete lesson.
   - Assert:
     - All four child records persist.
     - Their `lesson_id` fields are updated to `NULL`.
