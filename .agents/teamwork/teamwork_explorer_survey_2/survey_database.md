# Backend Database Layer & Data Integrity Survey

**Explorer**: Database Operations Explorer  
**Date**: 2026-11-11  
**Scope**: PostgreSQL schema, connection management, queries, transactions, concurrency hazards, constraints, and migration mechanisms in Drizzlearn (`db/schema.sql`, `scripts/migrate.js`, `server/db.js`, `server/plan-service.js`, `server/retrieval.js`, `server/auth.js`, `api/[...path].js`).

---

## 1. Executive Summary

Drizzlearn uses **PostgreSQL** via the native `pg` (`node-postgres` v8.16.3) driver. The application manages state across **14 relational tables** defining users, authentication tokens, learning goals, courses, modules, lessons, study tasks, practice attempts, notes, flashcards, review events, study rooms, study room memberships, and AI jobs.

### Key Strengths:
1. **Explicit Foreign Key Cascades & Data Preservation**: Learner-created learning evidence (`practice_attempts`, `notes`, `flashcards`, `study_tasks`) uses `ON DELETE SET NULL` on lesson and course references, preventing learner data loss when courses or lessons are deleted or updated. User deletion cleanly cascades (`ON DELETE CASCADE`) across all tables.
2. **Targeted Pessimistic Concurrency Control (`FOR UPDATE`)**: Critical concurrent state machines—specifically **Study Room Pomodoro timer synchronization** (`study_rooms`), **flashcard spaced repetition review** (`flashcards`), **course proposal improvement** (`courses`), and **course approval** (`courses JOIN learning_goals`)—use explicit row-level locking (`FOR UPDATE`) inside `withTransaction()` to prevent race conditions and double-approval.
3. **Idempotent DDL Migration**: `db/schema.sql` and `scripts/migrate.js` are fully idempotent, using `IF NOT EXISTS` constructs across extensions, tables, columns, and secondary indexes.
4. **Information Leakage Prevention**: Database errors are caught and sanitized via `safeError()` in `server/http.js`, returning typed 503 (`DATABASE_NOT_CONFIGURED`) or generic 500 (`INTERNAL_ERROR`) responses to avoid leaking database connection strings, credentials, or internal schema details to clients.

### Key Risks & Integrity Vulnerabilities:
1. **Un-transactioned Multi-Step Token Consumptions**: In `authRoutes` (`verify` and `reset-password`), the token is marked consumed (`UPDATE auth_tokens SET consumed_at=NOW()`) in one query, and the user record is updated (`UPDATE users SET ...`) in a separate, non-transactional query. If the second query fails, the token is permanently consumed while the user is left unverified or with their old password.
2. **Un-transactioned Multi-Table Course Updates**: `PUT /api/courses/:id` updates `courses` and conditionally updates `learning_goals` as two independent queries without a transaction wrapper. If the second update fails, course and goal statuses become desynchronized.
3. **Secondary Exception Masking in `withTransaction`**: In `server/db.js`, if a query fails and the subsequent `await client.query("ROLLBACK")` throws (e.g., due to a broken connection), the rollback error replaces the original error, concealing the actual root cause.
4. **Missing Foreign Key & Query Indexes**: Foreign keys such as `lessons(course_id)`, `study_tasks(course_id)`, `ai_jobs(user_id)`, and `practice_attempts(lesson_id)` lack dedicated secondary indexes, causing sequential scans on joins, aggregates, and cascading deletes.
5. **Dynamic Full-Text Search without GIN Indexes**: Full-text context retrieval in `server/retrieval.js` computes `to_tsvector('simple', ...)` on every query over `notes`, `lessons`, and `practice_attempts` without GIN indexes.
6. **Side-Effecting Database Write on `GET /api/tasks`**: Reading tasks triggers an `UPDATE study_tasks SET status='overdue' ...`, introducing write contention during read operations.

---

## 2. Database Engine & Connection Management

### 2.1 Engine & Drivers
- **Database Engine**: PostgreSQL 14+ (requires `pgcrypto` extension for `gen_random_uuid()`).
- **Client Driver**: `pg` (v8.16.3).
- **Environment Configuration**: `DATABASE_URL` (supports Postgres connection strings, e.g., Neon Postgres / Vercel Marketplace Postgres).

### 2.2 Connection Pooling (`server/db.js`)
Connection pooling is implemented as a singleton `pg.Pool` instance created lazily upon the first database call:

```javascript
// server/db.js
export function getPool() {
  if (!databaseConfigured()) {
    const error = new Error("Database is not configured. Connect a Postgres database in Vercel Marketplace and set DATABASE_URL.");
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}
```

#### Pool Properties:
- `max: 3`: Low pool ceiling tailored for serverless execution environments (e.g., Vercel Functions) to prevent connection saturation when multiple container instances scale horizontally.
- `idleTimeoutMillis: 20_000`: Closes idle connections after 20 seconds.
- `connectionTimeoutMillis: 10_000`: 10-second timeout when acquiring a connection from the pool before throwing a timeout error.
- `ssl`: Set to `{ rejectUnauthorized: false }` in `production`, supporting SSL connections with cloud-managed databases (e.g. Neon, Supabase, RDS).

### 2.3 Query & Transaction Abstractions
- **`query(text, values)`**: Directly delegates to `getPool().query(text, values)`. Automatically acquires a client from the pool, executes the query, and releases the client.
- **`withTransaction(work)`**: 
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
  - Isolates execution within an explicit transaction block (`BEGIN` / `COMMIT` / `ROLLBACK`).
  - Guarantees `client.release()` in `finally`.
  - **Identified Hazard**: If the database connection drops or resets while `work(client)` is executing, `client.query("ROLLBACK")` throws a new error, replacing the original error and obscuring the root cause from caller logging.

---

## 3. Migration Architecture & Schema Definitions

### 3.1 Migration Mechanism (`scripts/migrate.js`)
- Executed via `npm run db:migrate` (`node scripts/migrate.js`).
- Reads the entire `db/schema.sql` file and executes it via a single-connection pool (`max: 1`).
- Outputs: `LearnOS database schema is ready.` (Note: Product guidelines recommend "Drizzlearn").
- **Migration Properties**:
  - Entirely idempotent DDL script.
  - No migration version tracking table (e.g., `schema_migrations`).
  - Additions to existing schemas are handled via idempotent statements, e.g.:
    `ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;`
    `ALTER TABLE lessons ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;`

---

## 4. Comprehensive Schema, Constraints & Indexes Catalog

### Table 1: `users`
Core user profile and global learning configuration.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `email` (TEXT, NOT NULL, UNIQUE)
  - `full_name` (TEXT, NOT NULL)
  - `password_hash` (TEXT, NOT NULL)
  - `email_verified_at` (TIMESTAMPTZ, nullable)
  - `timezone` (TEXT, NOT NULL, default `'UTC'`)
  - `preferred_study_days` (INTEGER[], NOT NULL, default `ARRAY[1,3,5]`)
  - `session_minutes` (INTEGER, NOT NULL, default `120`, CHECK `15 BETWEEN 240`)
  - `weekly_minutes` (INTEGER, NOT NULL, default `360`, CHECK `30 BETWEEN 2400`)
  - `notification_preferences` (JSONB, NOT NULL, default `'{"study":false,"review":false,"quietStart":"22:00","quietEnd":"08:00"}'::jsonb`)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `updated_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `users_pkey` (PRIMARY KEY `id`), `users_email_key` (UNIQUE `email`).
- **Foreign Keys**: None (Root entity).

### Table 2: `auth_tokens`
Tokens for email verification and password reset flows.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `purpose` (TEXT, NOT NULL, CHECK `purpose IN ('verify_email','reset_password')`)
  - `token_hash` (TEXT, NOT NULL, UNIQUE)
  - `expires_at` (TIMESTAMPTZ, NOT NULL)
  - `consumed_at` (TIMESTAMPTZ, nullable)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `auth_tokens_pkey`, `auth_tokens_token_hash_key`, `auth_tokens_user_purpose_idx` on `(user_id, purpose)`.

### Table 3: `learning_goals`
Top-level learner objectives.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `topic` (TEXT, NOT NULL)
  - `desired_outcome` (TEXT, NOT NULL)
  - `current_level` (TEXT, NOT NULL)
  - `purpose` (TEXT, NOT NULL, default `''`)
  - `target_date` (DATE, nullable)
  - `target_weeks` (INTEGER, nullable)
  - `weekly_minutes` (INTEGER, NOT NULL)
  - `status` (TEXT, NOT NULL, default `'draft'`, CHECK `status IN ('draft','active','paused','completed','archived')`)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `updated_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `learning_goals_pkey`, `learning_goals_user_status_idx` on `(user_id, status)`.

### Table 4: `courses`
Curriculum generated from a learning goal.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `goal_id` (UUID, NOT NULL, REFERENCES `learning_goals(id)` ON DELETE CASCADE)
  - `title` (TEXT, NOT NULL)
  - `summary` (TEXT, NOT NULL, default `''`)
  - `status` (TEXT, NOT NULL, default `'proposal'`, CHECK `status IN ('proposal','active','paused','completed','archived')`)
  - `estimated_minutes` (INTEGER, NOT NULL, default `0`)
  - `assumptions` (JSONB, NOT NULL, default `'[]'::jsonb`)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `approved_at` (TIMESTAMPTZ, nullable)
  - `updated_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `courses_pkey`, `courses_user_status_idx` on `(user_id, status)`.

### Table 5: `course_modules`
Structured modules within a course.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `course_id` (UUID, NOT NULL, REFERENCES `courses(id)` ON DELETE CASCADE)
  - `position` (INTEGER, NOT NULL)
  - `title` (TEXT, NOT NULL)
  - `objective` (TEXT, NOT NULL)
  - `rationale` (TEXT, NOT NULL, default `''`)
  - `prerequisite_positions` (INTEGER[], NOT NULL, default `'{}'`)
  - `estimated_minutes` (INTEGER, NOT NULL, default `0`)
  - `source_refs` (JSONB, NOT NULL, default `'[]'::jsonb`)
  - `status` (TEXT, NOT NULL, default `'planned'`, CHECK `status IN ('planned','active','completed','deferred')`)
- **Constraints**: `UNIQUE(course_id, position)`.
- **Indexes**: `course_modules_pkey`, `course_modules_course_id_position_key`.

### Table 6: `lessons`
Individual units of learning within a module.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `course_id` (UUID, NOT NULL, REFERENCES `courses(id)` ON DELETE CASCADE)
  - `module_id` (UUID, NOT NULL, REFERENCES `course_modules(id)` ON DELETE CASCADE)
  - `position` (INTEGER, NOT NULL)
  - `title` (TEXT, NOT NULL)
  - `objective` (TEXT, NOT NULL)
  - `prerequisites` (TEXT[], NOT NULL, default `'{}'`)
  - `content_markdown` (TEXT, NOT NULL, default `''`)
  - `worked_example` (TEXT, NOT NULL, default `''`)
  - `checkpoint` (JSONB, NOT NULL, default `'{}'::jsonb`)
  - `source_refs` (JSONB, NOT NULL, default `'[]'::jsonb`)
  - `estimated_minutes` (INTEGER, NOT NULL, default `25`)
  - `reading_only` (BOOLEAN, NOT NULL, default `FALSE`)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Constraints**: `UNIQUE(module_id, position)`.
- **Indexes**: `lessons_pkey`, `lessons_module_id_position_key`.

### Table 7: `study_tasks`
Scheduled learning, practice, and review commitments.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `course_id` (UUID, NOT NULL, REFERENCES `courses(id)` ON DELETE CASCADE)
  - `lesson_id` (UUID, nullable, REFERENCES `lessons(id)` ON DELETE SET NULL)
  - `task_type` (TEXT, NOT NULL, default `'lesson'`, CHECK `task_type IN ('lesson','practice','review','project')`)
  - `title` (TEXT, NOT NULL)
  - `scheduled_at` (TIMESTAMPTZ, nullable)
  - `status` (TEXT, NOT NULL, default `'upcoming'`, CHECK `status IN ('upcoming','due','in_progress','completed','rescheduled','overdue')`)
  - `estimated_minutes` (INTEGER, NOT NULL, default `25`)
  - `actual_minutes` (INTEGER, nullable)
  - `started_at` (TIMESTAMPTZ, nullable)
  - `completed_at` (TIMESTAMPTZ, nullable)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `study_tasks_pkey`, `study_tasks_user_schedule_idx` on `(user_id, scheduled_at, status)`.

### Table 8: `practice_attempts`
Learner evidence and quiz evaluations.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `task_id` (UUID, nullable, REFERENCES `study_tasks(id)` ON DELETE SET NULL)
  - `lesson_id` (UUID, nullable, REFERENCES `lessons(id)` ON DELETE SET NULL)
  - `concept` (TEXT, NOT NULL, default `''`)
  - `prompt` (TEXT, NOT NULL)
  - `submitted_answer` (TEXT, NOT NULL)
  - `result` (JSONB, NOT NULL, default `'{}'::jsonb`)
  - `score` (NUMERIC(5,2), nullable)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `practice_attempts_pkey`, `practice_attempts_user_created_idx` on `(user_id, created_at DESC)`.

### Table 9: `notes`
Learner personal notes, summaries, and source imports.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `course_id` (UUID, nullable, REFERENCES `courses(id)` ON DELETE SET NULL)
  - `lesson_id` (UUID, nullable, REFERENCES `lessons(id)` ON DELETE SET NULL)
  - `title` (TEXT, NOT NULL)
  - `body` (TEXT, NOT NULL, default `''`)
  - `origin` (TEXT, NOT NULL, default `'learner'`, CHECK `origin IN ('learner','ai_draft','imported_source')`)
  - `source_ref` (TEXT, NOT NULL, default `''`)
  - `updated_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `notes_pkey`, `notes_user_updated_idx` on `(user_id, updated_at DESC)`.

### Table 10: `flashcards`
Spaced repetition flashcards.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `course_id` (UUID, nullable, REFERENCES `courses(id)` ON DELETE SET NULL)
  - `lesson_id` (UUID, nullable, REFERENCES `lessons(id)` ON DELETE SET NULL)
  - `front` (TEXT, NOT NULL)
  - `back` (TEXT, NOT NULL)
  - `due_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `interval_days` (INTEGER, NOT NULL, default `0`)
  - `ease` (NUMERIC(4,2), NOT NULL, default `2.50`)
  - `repetitions` (INTEGER, NOT NULL, default `0`)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `flashcards_pkey`, `flashcards_user_due_idx` on `(user_id, due_at)`.

### Table 11: `review_events`
Historical event log for spaced repetition answers.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `flashcard_id` (UUID, NOT NULL, REFERENCES `flashcards(id)` ON DELETE CASCADE)
  - `rating` (TEXT, NOT NULL, CHECK `rating IN ('Again','Hard','Good','Easy')`)
  - `reviewed_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `next_due_at` (TIMESTAMPTZ, NOT NULL)
- **Indexes**: `review_events_pkey`, `review_events_user_reviewed_idx` on `(user_id, reviewed_at DESC)`.

### Table 12: `study_rooms`
Collaborative Pomodoro rooms.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `room_code` (VARCHAR(8), NOT NULL, UNIQUE)
  - `owner_user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `title` (VARCHAR(80), NOT NULL)
  - `topic` (VARCHAR(120), NOT NULL, default `''`)
  - `focus_minutes` (SMALLINT, NOT NULL, default `25`, CHECK `5 BETWEEN 90`)
  - `break_minutes` (SMALLINT, NOT NULL, default `5`, CHECK `3 BETWEEN 30`)
  - `long_break_minutes` (SMALLINT, NOT NULL, default `15`, CHECK `5 BETWEEN 60`)
  - `long_break_every` (SMALLINT, NOT NULL, default `4`, CHECK `2 BETWEEN 8`)
  - `phase` (TEXT, NOT NULL, default `'idle'`, CHECK `phase IN ('idle','focus','short_break','long_break','paused')`)
  - `paused_phase` (TEXT, nullable, CHECK `paused_phase IN ('focus','short_break','long_break')`)
  - `completed_focuses` (INTEGER, NOT NULL, default `0`, CHECK `>= 0`)
  - `paused_remaining_seconds` (INTEGER, NOT NULL, default `0`, CHECK `>= 0`)
  - `phase_started_at` (TIMESTAMPTZ, nullable)
  - `phase_ends_at` (TIMESTAMPTZ, nullable)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `updated_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Indexes**: `study_rooms_pkey`, `study_rooms_room_code_key` (UNIQUE `room_code`), `study_rooms_owner_updated_idx` on `(owner_user_id, updated_at DESC)`.

### Table 13: `study_room_members`
Room participants and online heartbeats.
- **Columns**:
  - `room_id` (UUID, NOT NULL, REFERENCES `study_rooms(id)` ON DELETE CASCADE)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `role` (TEXT, NOT NULL, default `'member'`, CHECK `role IN ('owner','member')`)
  - `joined_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `last_seen_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
- **Constraints**: `PRIMARY KEY (room_id, user_id)`.
- **Indexes**: `study_room_members_pkey` on `(room_id, user_id)`, `study_room_members_user_seen_idx` on `(user_id, last_seen_at DESC)`.

### Table 14: `ai_jobs`
Audit record for background or synchronous AI generation requests.
- **Columns**:
  - `id` (UUID, PK, default `gen_random_uuid()`)
  - `user_id` (UUID, NOT NULL, REFERENCES `users(id)` ON DELETE CASCADE)
  - `job_type` (TEXT, NOT NULL)
  - `status` (TEXT, NOT NULL, default `'pending'`, CHECK `status IN ('pending','running','succeeded','failed')`)
  - `input_ref` (JSONB, NOT NULL, default `'{}'::jsonb`)
  - `output_ref` (JSONB, nullable)
  - `error_code` (TEXT, nullable)
  - `created_at` (TIMESTAMPTZ, NOT NULL, default `NOW()`)
  - `finished_at` (TIMESTAMPTZ, nullable)
- **Indexes**: `ai_jobs_pkey`.

---

## 5. Operations & Query Matrix

| Operation Category | Route / Handler | SQL Operations Executed | Transactional? | Locks / Concurrency Mechanisms |
|---|---|---|---|---|
| **Auth Signup** | `POST /api/auth/signup` | `INSERT INTO users ... ON CONFLICT(email) DO NOTHING RETURNING ...` | Single statement | Unique constraint index handles duplicate registrations without error. |
| **Auth Login** | `POST /api/auth/login` | `SELECT ... FROM users WHERE email=$1` | Read-only | None needed. |
| **Auth Verify** | `POST /api/auth/verify` | 1. `UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 ... RETURNING user_id`<br>2. `UPDATE users SET email_verified_at=NOW() WHERE id=$1` | **No** (2 independent queries) | ⚠️ **Vulnerability**: Token is consumed even if user update fails. |
| **Auth Reset Password** | `POST /api/auth/reset-password` | 1. `UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 ... RETURNING user_id`<br>2. `UPDATE users SET password_hash=$1 WHERE id=$2` | **No** (2 independent queries) | ⚠️ **Vulnerability**: Token is consumed even if password update fails. |
| **Home Dashboard** | `GET /api/home` | 5 parallel queries (`Promise.all`): active course, study tasks, flashcards due count, aggregate counts, understanding evidence count | Read-only | None needed. |
| **Goal Creation** | `POST /api/goals` | `INSERT INTO learning_goals ... RETURNING *` | Single statement | Validated before insert. |
| **Course Proposal Gen** | `POST /api/goals/:id/proposal` | 1. `SELECT ... FROM learning_goals`<br>2. `retrieveLearnerContext` (3 parallel tsvector queries)<br>3. `INSERT INTO ai_jobs ...`<br>4. `INSERT INTO courses ...`<br>5. Loop: `INSERT INTO course_modules`<br>6. Loop: `INSERT INTO lessons` | **Yes** (`withTransaction` wraps steps 3-6) | AI generation (`generatePlan`) is performed outside DB transaction to avoid connection holding. |
| **Course Proposal Improve** | `POST /api/courses/:id/improve` | 1. `SELECT courses JOIN learning_goals`<br>2. `SELECT course_modules LEFT JOIN lessons`<br>3. `retrieveLearnerContext`<br>4. In `withTransaction`: `SELECT courses ... FOR UPDATE`, `UPDATE courses`, `DELETE course_modules`, `INSERT course_modules`, `INSERT lessons`, `INSERT ai_jobs` | **Yes** (`withTransaction` with `FOR UPDATE`) | Safe against concurrent approvals: checks `status === 'proposal'` with row lock. |
| **Course Approval** | `POST /api/courses/:id/approve` | In `withTransaction`: `SELECT courses JOIN learning_goals ... FOR UPDATE`, `UPDATE courses SET status='active'`, `UPDATE learning_goals SET status='active'`, `SELECT lessons`, loop `INSERT INTO study_tasks` | **Yes** (`withTransaction` with `FOR UPDATE`) | Safe against double-approval race. |
| **Study Room Create** | `POST /api/study-rooms` | In `withTransaction`: `INSERT INTO study_rooms ... RETURNING *`, `INSERT INTO study_room_members(role='owner')` | **Yes** (`withTransaction`) | Guaranteed atomic creation. |
| **Study Room Snapshot / Timer** | `GET/POST /api/study-rooms/:code[/timer]` | In `withTransaction`: `SELECT ... FROM study_rooms FOR UPDATE`, `UPSERT study_room_members`, `UPDATE study_rooms SET ...`, `SELECT study_room_members JOIN users` | **Yes** (`withTransaction` with `FOR UPDATE`) | Strict serialization of Pomodoro timer mutations across concurrent room members. |
| **Task Completion** | `POST /api/tasks/:id/complete` | 1. `SELECT * FROM study_tasks`<br>2. `SELECT id FROM practice_attempts WHERE score>=70`<br>3. `UPDATE study_tasks SET status='completed' ...` | **No** (3 separate queries) | Low risk, but non-transactional. |
| **Flashcard Review** | `POST /api/flashcards/:id/review` | In `withTransaction`: `SELECT * FROM flashcards FOR UPDATE`, `INSERT INTO review_events`, `UPDATE flashcards SET due_at=$1 ...` | **Yes** (`withTransaction` with `FOR UPDATE`) | Strict serialization of spaced repetition calculations. |
| **Account Deletion** | `DELETE /api/settings/account` | 1. Verify password hash<br>2. `DELETE FROM users WHERE id=$1` | Single cascade statement | PostgreSQL foreign key cascades automatically wipe all 11 child tables. |

---

## 6. Concurrency Risks, Rollback Safety & Performance Audit

### 6.1 Transaction Boundaries & Rollback Hazards
1. **Rollback Error Masking in `withTransaction` (`server/db.js:32-45`)**:
   ```javascript
   export async function withTransaction(work) {
     const client = await getPool().connect();
     try {
       await client.query("BEGIN");
       const value = await work(client);
       await client.query("COMMIT");
       return value;
     } catch (error) {
       await client.query("ROLLBACK"); // If this throws, original error is lost!
       throw error;
     } finally {
       client.release();
     }
   }
   ```
   *Impact*: If the database connection drops or resets while `work(client)` is executing, `client.query("ROLLBACK")` throws a new error, replacing the original error and obscuring the root cause from caller logging.
   *Fix*: Guard the rollback with `try { await client.query("ROLLBACK"); } catch (e) { /* ignore rollback failure */ } throw error;`.

2. **Non-Transactional Token Consumption (`api/[...path].js:41-43, 54-56`)**:
   In `auth/verify` and `auth/reset-password`, the token is consumed in statement 1, and the user updated in statement 2. An interruption leaves the token consumed and the user blocked.
   *Fix*: Wrap token consumption and user update in `withTransaction(async client => { ... })`.

3. **Non-Transactional Course & Goal Status Updates (`api/[...path].js:225`)**:
   `PUT /api/courses/:id` executes `UPDATE courses` followed by `UPDATE learning_goals` without a transaction wrapper. A network partition or timeout leaves the course in one status and the goal in another.

### 6.2 Serverless Connection Pool Limits
- `getPool()` sets `max: 3`. In serverless deployments (Vercel), each cold-started function instance creates its own pool.
- Under sudden traffic (e.g., 50 parallel requests activating 50 serverless function instances), the total connection count to PostgreSQL can reach 150.
- If the PostgreSQL instance has a default connection limit of 20 to 100 connections (typical for free/developer tiers on Neon, Supabase, or RDS), incoming requests will receive connection timeout errors (`connectionTimeoutMillis: 10_000`).
- *Recommendation*: Use a transaction-mode connection pooler URL (e.g. Neon connection pooler with `-pooler` host suffix) when setting `DATABASE_URL` in production.

### 6.3 Missing Database Indexes
A query performance audit reveals several unindexed foreign keys and filter fields that cause sequential scans under production load:
1. `lessons(course_id)`: Unindexed. Queried in `getHome` (`SELECT COUNT(*) FROM lessons WHERE course_id=c.id`), `approveCourse` (`SELECT ... FROM lessons WHERE course_id=$1`), and `retrieveLearnerContext` (`JOIN courses c ON c.id=l.course_id`).
2. `study_tasks(course_id)`: Unindexed. Queried in `getHome` (`SELECT COUNT(*) FROM study_tasks WHERE course_id=c.id`) and `progress` (`LEFT JOIN study_tasks t ON t.course_id=c.id`).
3. `ai_jobs(user_id)`: Unindexed foreign key to `users(id)`. When a user account is deleted, PostgreSQL must sequentially scan `ai_jobs` to cascade deletes.
4. `practice_attempts(lesson_id)`: Queried when validating lesson checkpoint completion in task completion (`tasks/:id/complete`).
5. **Full-Text Search GIN Indexes**: `server/retrieval.js` executes full-text searches using `to_tsvector('simple', ...)` on `notes`, `lessons`, and `practice_attempts`. Without functional GIN indexes, PostgreSQL must perform sequential scans and compute `to_tsvector` on the fly for every search.

---

## 7. Actionable Recommendations for Engineering

1. **Wrap Multi-Step Auth Operations in Transactions**:
   Update `api/[...path].js` to wrap `auth/verify` and `auth/reset-password` in `withTransaction()` so token consumption and user state updates are strictly atomic.
2. **Defensive Rollback in `server/db.js`**:
   In `server/db.js`, ensure `await client.query("ROLLBACK")` is wrapped in a nested `try/catch` so the original error is always preserved and propagated.
3. **Add Missing Indexes to `db/schema.sql`**:
   Add the following indexes:
   ```sql
   CREATE INDEX IF NOT EXISTS lessons_course_id_idx ON lessons(course_id);
   CREATE INDEX IF NOT EXISTS study_tasks_course_id_idx ON study_tasks(course_id);
   CREATE INDEX IF NOT EXISTS ai_jobs_user_id_idx ON ai_jobs(user_id);
   CREATE INDEX IF NOT EXISTS practice_attempts_user_lesson_idx ON practice_attempts(user_id, lesson_id);
   ```
4. **Separate Read Path from Status Mutation in `GET /api/tasks`**:
   Move the `UPDATE study_tasks SET status='overdue' ...` out of the GET handler into a dedicated scheduled cron job or explicit background task so GET requests remain strictly read-only.
5. **Add Comprehensive Concurrency & Database Failure Tests**:
   Augment the automated test suite with targeted tests verifying:
   - Atomic rollback behavior when multi-step database operations fail mid-flight.
   - Proper pessimistic locking (`FOR UPDATE`) behavior during simulated simultaneous requests.
   - Safe error handling when `DATABASE_URL` is unavailable or malformed.
