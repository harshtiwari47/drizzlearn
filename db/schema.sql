CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  preferred_study_days INTEGER[] NOT NULL DEFAULT ARRAY[1,3,5],
  session_minutes INTEGER NOT NULL DEFAULT 120 CHECK (session_minutes BETWEEN 15 AND 240),
  weekly_minutes INTEGER NOT NULL DEFAULT 360 CHECK (weekly_minutes BETWEEN 30 AND 2400),
  notification_preferences JSONB NOT NULL DEFAULT '{"study":false,"review":false,"quietStart":"22:00","quietEnd":"08:00"}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON auth_tokens(user_id, purpose);

CREATE TABLE IF NOT EXISTS learning_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  desired_outcome TEXT NOT NULL,
  current_level TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  target_date DATE,
  target_weeks INTEGER,
  weekly_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS learning_goals_user_status_idx ON learning_goals(user_id, status);

CREATE TABLE IF NOT EXISTS courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES learning_goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'proposal' CHECK (status IN ('proposal','active','paused','completed','archived')),
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS courses_user_status_idx ON courses(user_id, status);
CREATE INDEX IF NOT EXISTS courses_goal_idx ON courses(goal_id);

CREATE TABLE IF NOT EXISTS course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  rationale TEXT NOT NULL DEFAULT '',
  prerequisite_positions INTEGER[] NOT NULL DEFAULT '{}',
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','completed','deferred')),
  UNIQUE(course_id, position)
);

CREATE TABLE IF NOT EXISTS lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  module_id UUID NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  prerequisites TEXT[] NOT NULL DEFAULT '{}',
  content_markdown TEXT NOT NULL DEFAULT '',
  worked_example TEXT NOT NULL DEFAULT '',
  checkpoint JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  estimated_minutes INTEGER NOT NULL DEFAULT 25,
  reading_only BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(module_id, position)
);
ALTER TABLE course_modules ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS source_refs JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS lessons_course_idx ON lessons(course_id);

CREATE TABLE IF NOT EXISTS study_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL DEFAULT 'lesson' CHECK (task_type IN ('lesson','practice','review','project')),
  title TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','due','in_progress','completed','rescheduled','overdue')),
  estimated_minutes INTEGER NOT NULL DEFAULT 25,
  actual_minutes INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS study_tasks_user_schedule_idx ON study_tasks(user_id, scheduled_at, status);
CREATE INDEX IF NOT EXISTS study_tasks_course_status_idx ON study_tasks(course_id, status);
CREATE INDEX IF NOT EXISTS study_tasks_lesson_idx ON study_tasks(lesson_id);

CREATE TABLE IF NOT EXISTS practice_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES study_tasks(id) ON DELETE SET NULL,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  concept TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  submitted_answer TEXT NOT NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  score NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS practice_attempts_user_created_idx ON practice_attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS practice_attempts_task_idx ON practice_attempts(task_id);
CREATE INDEX IF NOT EXISTS practice_attempts_lesson_idx ON practice_attempts(lesson_id);

CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'learner' CHECK (origin IN ('learner','ai_draft','imported_source')),
  source_ref TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notes_user_updated_idx ON notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_course_idx ON notes(course_id);
CREATE INDEX IF NOT EXISTS notes_lesson_idx ON notes(lesson_id);

CREATE TABLE IF NOT EXISTS flashcards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  interval_days INTEGER NOT NULL DEFAULT 0,
  ease NUMERIC(4,2) NOT NULL DEFAULT 2.50,
  repetitions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS flashcards_user_due_idx ON flashcards(user_id, due_at);
CREATE INDEX IF NOT EXISTS flashcards_course_idx ON flashcards(course_id);
CREATE INDEX IF NOT EXISTS flashcards_lesson_idx ON flashcards(lesson_id);

CREATE TABLE IF NOT EXISTS review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flashcard_id UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('Again','Hard','Good','Easy')),
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_due_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS review_events_user_reviewed_idx ON review_events(user_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS review_events_flashcard_idx ON review_events(flashcard_id);

CREATE TABLE IF NOT EXISTS study_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code VARCHAR(8) NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(80) NOT NULL,
  topic VARCHAR(120) NOT NULL DEFAULT '',
  focus_minutes SMALLINT NOT NULL DEFAULT 25 CHECK (focus_minutes BETWEEN 5 AND 90),
  break_minutes SMALLINT NOT NULL DEFAULT 5 CHECK (break_minutes BETWEEN 3 AND 30),
  long_break_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (long_break_minutes BETWEEN 5 AND 60),
  long_break_every SMALLINT NOT NULL DEFAULT 4 CHECK (long_break_every BETWEEN 2 AND 8),
  phase TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle','focus','short_break','long_break','paused')),
  paused_phase TEXT CHECK (paused_phase IN ('focus','short_break','long_break')),
  completed_focuses INTEGER NOT NULL DEFAULT 0 CHECK (completed_focuses >= 0),
  paused_remaining_seconds INTEGER NOT NULL DEFAULT 0 CHECK (paused_remaining_seconds >= 0),
  phase_started_at TIMESTAMPTZ,
  phase_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS study_rooms_owner_updated_idx ON study_rooms(owner_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS study_room_members (
  room_id UUID NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS study_room_members_user_seen_idx ON study_room_members(user_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
  input_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_ref JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ai_jobs_user_status_idx ON ai_jobs(user_id, status);

CREATE TABLE IF NOT EXISTS rag_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('note','lesson','flashcard','practice_attempt')),
  source_id TEXT NOT NULL,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT '',
  chunk_index INTEGER NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding JSONB,
  embedding_model TEXT NOT NULL DEFAULT 'local-hash-v1',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, source_type, source_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS rag_chunks_user_type_idx ON rag_chunks(user_id, source_type);
CREATE INDEX IF NOT EXISTS rag_chunks_user_source_idx ON rag_chunks(user_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS rag_chunks_user_course_idx ON rag_chunks(user_id, course_id);
CREATE INDEX IF NOT EXISTS rag_chunks_user_lesson_idx ON rag_chunks(user_id, lesson_id);


