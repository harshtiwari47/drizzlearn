import crypto from "node:crypto";
import { getMongoDb } from "./mongo.js";
import { logger } from "./logger.js";

let customDbProvider = null;
export function setDbProvider(provider) {
  customDbProvider = provider;
}

function uuid() {
  return crypto.randomUUID();
}

function parseJsonField(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === "object") return val;
  try { return JSON.parse(val); } catch { return fallback; }
}

function safeDoc(res) {
  if (!res) return null;
  return res.value !== undefined ? res.value : res;
}

export function normalizeSql(sql) {
  return String(sql || "")
    .replace(/\s+/g, " ")
    .replace(/\s*([=,();])\s*/g, "$1")
    .replace(/\s*(>=|<=|<>|!=)\s*/g, "$1")
    .trim();
}

function normalizeUserDoc(user) {
  if (!user) return null;
  return {
    ...user,
    timezone: user.timezone || "UTC",
    preferred_study_days: user.preferred_study_days || [1, 3, 5],
    session_minutes: Number(user.session_minutes ?? 120),
    weekly_minutes: Number(user.weekly_minutes ?? 360),
    notification_preferences: parseJsonField(user.notification_preferences, {
      study: false,
      review: false,
      quietStart: "22:00",
      quietEnd: "08:00",
    }),
  };
}

function parseTsQueryWords(queryStr) {
  return (String(queryStr || "").match(/[a-z0-9]+/gi) || []).filter(w => w !== "simple");
}

function logWarning(msg, data = {}) {
  if (typeof globalThis.logger?.warn === "function") {
    globalThis.logger.warn({ msg, ...data });
  } else if (typeof globalThis.logger?.info === "function") {
    globalThis.logger.info({ msg, ...data });
  } else {
    logger.warn(msg, "drizzlearn:mongo", data);
  }
}

function logError(msg, err, data = {}) {
  if (typeof globalThis.logger?.error === "function") {
    globalThis.logger.error({ msg, error: err?.message || err, code: err?.code, ...data });
  } else {
    logger.error(msg, "drizzlearn:mongo", { error: err?.message || err, code: err?.code, ...data });
  }
}

function inferCollectionAndAction(sql) {
  const upper = String(sql || "").toUpperCase();
  let action = "query";
  if (upper.startsWith("INSERT")) action = "insert";
  else if (upper.startsWith("SELECT") || upper.startsWith("WITH")) action = "find";
  else if (upper.startsWith("UPDATE")) action = "update";
  else if (upper.startsWith("DELETE")) action = "delete";
  else if (upper.startsWith("BEGIN") || upper.startsWith("COMMIT") || upper.startsWith("ROLLBACK")) action = "transaction";

  const collections = [
    "users", "auth_tokens", "learning_goals", "courses", "course_modules",
    "lessons", "study_tasks", "practice_attempts", "notes", "flashcards",
    "review_events", "study_rooms", "study_room_members", "ai_jobs", "rag_chunks"
  ];
  let collection = "unknown";
  for (const c of collections) {
    if (sql.includes(c)) {
      collection = c;
      break;
    }
  }
  return { collection, action };
}

async function _executeMongoQueryInner(norm, sqlText, values, opts) {

  try {
    const db = customDbProvider ? await customDbProvider() : await getMongoDb();

    // 2. USERS table operations
    if (norm.includes("INSERT INTO users")) {
      const [email, fullName, passwordHash] = values;
      const users = db.collection("users");
      const existing = await users.findOne({ email }, opts);
      if (existing) {
        if (norm.includes("ON CONFLICT")) return { rows: [] };
        const err = new Error("User already exists");
        err.code = "23505";
        throw err;
      }
      const doc = {
        id: uuid(),
        email,
        full_name: fullName,
        password_hash: passwordHash,
        email_verified_at: new Date().toISOString(),
        timezone: "UTC",
        preferred_study_days: [1, 3, 5],
        session_minutes: 120,
        weekly_minutes: 360,
        notification_preferences: { study: false, review: false, quietStart: "22:00", quietEnd: "08:00" },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await users.insertOne(doc, opts);
      return { rows: [normalizeUserDoc(doc)] };
    }

    if (norm.includes("FROM users WHERE email=")) {
      const user = await db.collection("users").findOne({ email: values[0] }, opts);
      return { rows: user ? [normalizeUserDoc(user)] : [] };
    }

    if (norm.includes("FROM users WHERE id=") || norm.includes("SELECT password_hash FROM users WHERE id=")) {
      const user = await db.collection("users").findOne({ id: values[0] }, opts);
      return { rows: user ? [normalizeUserDoc(user)] : [] };
    }

    if (norm.includes("UPDATE users SET email_verified_at=NOW()")) {
      await db.collection("users").updateOne(
        { id: values[0] },
        { $set: { email_verified_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
        opts
      );
      return { rows: [] };
    }

    if (norm.includes("UPDATE users SET password_hash=$1")) {
      await db.collection("users").updateOne(
        { id: values[1] },
        { $set: { password_hash: values[0], updated_at: new Date().toISOString() } },
        opts
      );
      return { rows: [] };
    }

    if (norm.includes("UPDATE users SET full_name=$1")) {
      const [name, timezone, days, sessionMin, weeklyMin, prefsRaw, userId] = values;
      const prefs = parseJsonField(prefsRaw, {});
      const update = {
        full_name: name,
        timezone,
        preferred_study_days: days,
        session_minutes: sessionMin,
        weekly_minutes: weeklyMin,
        notification_preferences: prefs,
        updated_at: new Date().toISOString(),
      };
      const res = await db.collection("users").findOneAndUpdate(
        { id: userId },
        { $set: update },
        { returnDocument: "after", ...opts }
      );
      const updated = safeDoc(res);
      return { rows: updated ? [normalizeUserDoc(updated)] : [] };
    }

    if (norm.includes("DELETE FROM users WHERE id=")) {
      const userId = values[0];
      await db.collection("users").deleteOne({ id: userId }, opts);
      await db.collection("auth_tokens").deleteMany({ user_id: userId }, opts);
      await db.collection("learning_goals").deleteMany({ user_id: userId }, opts);
      await db.collection("courses").deleteMany({ user_id: userId }, opts);
      await db.collection("course_modules").deleteMany({ user_id: userId }, opts);
      await db.collection("lessons").deleteMany({ user_id: userId }, opts);
      await db.collection("notes").deleteMany({ user_id: userId }, opts);
      await db.collection("flashcards").deleteMany({ user_id: userId }, opts);
      await db.collection("practice_attempts").deleteMany({ user_id: userId }, opts);
      await db.collection("study_tasks").deleteMany({ user_id: userId }, opts);
      await db.collection("study_room_members").deleteMany({ user_id: userId }, opts);
      await db.collection("ai_jobs").deleteMany({ user_id: userId }, opts);
      await db.collection("rag_chunks").deleteMany({ user_id: userId }, opts);
      return { rows: [] };
    }

    // 3. AUTH_TOKENS table operations
    if (norm.includes("INSERT INTO auth_tokens")) {
      let userId, purpose, tokenHash;
      if (values.length === 2) {
        [userId, tokenHash] = values;
        purpose = norm.includes("'reset_password'") ? "reset_password" : "verify_email";
      } else {
        [userId, purpose, tokenHash] = values;
      }
      const doc = {
        id: uuid(),
        user_id: userId,
        purpose: purpose || "verify_email",
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        consumed_at: null,
        created_at: new Date().toISOString(),
      };
      await db.collection("auth_tokens").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("UPDATE auth_tokens SET consumed_at=NOW()")) {
      const [tokenHash] = values;
      const now = new Date().toISOString();
      const token = await db.collection("auth_tokens").findOneAndUpdate(
        { token_hash: tokenHash, consumed_at: null, expires_at: { $gt: now } },
        { $set: { consumed_at: now } },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(token);
      return { rows: doc ? [{ user_id: doc.user_id }] : [] };
    }

    // 4. LEARNING_GOALS table operations
    if (norm.includes("INSERT INTO learning_goals")) {
      const [userId, topic, desiredOutcome, currentLevel, purpose, targetDate, targetWeeks, weeklyMinutes] = values;
      const doc = {
        id: uuid(),
        user_id: userId,
        topic,
        desired_outcome: desiredOutcome,
        current_level: currentLevel,
        purpose: purpose || "",
        target_date: targetDate || null,
        target_weeks: targetWeeks || null,
        weekly_minutes: weeklyMinutes,
        status: "draft",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await db.collection("learning_goals").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("FROM learning_goals WHERE id=") && norm.includes("user_id=")) {
      const [goalId, userId] = values;
      const goal = await db.collection("learning_goals").findOne({ id: goalId, user_id: userId }, opts);
      return { rows: goal ? [goal] : [] };
    }

    if (norm === "SELECT * FROM learning_goals WHERE user_id=$1") {
      const goals = await db.collection("learning_goals").find({ user_id: values[0] }, opts).toArray();
      return { rows: goals };
    }

    if (norm.includes("FROM learning_goals WHERE user_id=")) {
      const query = db.collection("learning_goals").find({ user_id: values[0] }, opts);
      if (norm.includes("ORDER BY created_at DESC")) {
        query.sort({ created_at: -1 });
      }
      const goals = await query.toArray();
      return { rows: goals };
    }

    if (norm.includes("UPDATE learning_goals SET status=")) {
      if (norm.includes("status='active'")) {
        const [goalId, userId] = values;
        await db.collection("learning_goals").updateOne(
          { id: goalId, user_id: userId },
          { $set: { status: "active", updated_at: new Date().toISOString() } },
          opts
        );
      } else {
        const [status, goalId, userId] = values;
        await db.collection("learning_goals").updateOne(
          { id: goalId, user_id: userId },
          { $set: { status, updated_at: new Date().toISOString() } },
          opts
        );
      }
      return { rows: [] };
    }

    // 5. COURSES table operations
    if (norm.includes("INSERT INTO courses")) {
      const [id, userId, goalId, title, summary, estimatedMinutes, assumptionsRaw] = values;
      const assumptions = parseJsonField(assumptionsRaw, []);
      const doc = {
        id: id || uuid(),
        user_id: userId,
        goal_id: goalId,
        title,
        summary: summary || "",
        status: "proposal",
        estimated_minutes: estimatedMinutes || 0,
        assumptions,
        created_at: new Date().toISOString(),
        approved_at: null,
        updated_at: new Date().toISOString(),
      };
      await db.collection("courses").insertOne(doc, opts);
      return { rows: [doc] };
    }

    // Active course query for home dashboard
    if (norm.includes("FROM courses c JOIN learning_goals g ON g.id=c.goal_id") && norm.includes("c.status='active'")) {
      const course = await db.collection("courses").findOne({ user_id: values[0], status: "active" }, opts);
      if (!course) return { rows: [] };
      const goal = await db.collection("learning_goals").findOne({ id: course.goal_id }, opts);
      const lessonCount = await db.collection("lessons").countDocuments({ course_id: course.id }, opts);
      const completedTasks = await db.collection("study_tasks").countDocuments({ course_id: course.id, status: "completed" }, opts);
      return {
        rows: [{
          ...course,
          topic: goal?.topic || "",
          current_level: goal?.current_level || "",
          target_weeks: goal?.target_weeks || 4,
          lesson_count: lessonCount,
          completed_tasks: completedTasks,
        }],
      };
    }

    // Specific course details with learning goal info
    if (norm.includes("FROM courses c JOIN learning_goals g ON g.id=c.goal_id") && (norm.includes("c.id=$1") || norm.includes("c.id = $1"))) {
      const [courseId, userId] = values;
      const course = await db.collection("courses").findOne({ id: courseId, user_id: userId }, opts);
      if (!course) return { rows: [] };
      const goal = await db.collection("learning_goals").findOne({ id: course.goal_id }, opts);
      return {
        rows: [{
          ...course,
          topic: goal?.topic || "",
          desired_outcome: goal?.desired_outcome || "",
          current_level: goal?.current_level || "",
          purpose: goal?.purpose || "",
          weekly_minutes: goal?.weekly_minutes || 360,
          target_weeks: goal?.target_weeks || 4,
          target_date: goal?.target_date || null,
          goal_user_id: goal?.user_id || course.user_id,
        }],
      };
    }

    // All courses list with aggregates
    if (norm.includes("FROM courses c JOIN learning_goals g ON g.id=c.goal_id WHERE c.user_id=$1")) {
      const courses = await db.collection("courses").find({ user_id: values[0] }, opts).sort({ created_at: -1 }).toArray();
      const rows = [];
      for (const c of courses) {
        const goal = await db.collection("learning_goals").findOne({ id: c.goal_id }, opts);
        const moduleCount = await db.collection("course_modules").countDocuments({ course_id: c.id }, opts);
        const lessonCount = await db.collection("lessons").countDocuments({ course_id: c.id }, opts);
        const completedTasks = await db.collection("study_tasks").countDocuments({ course_id: c.id, status: "completed" }, opts);
        rows.push({
          ...c,
          topic: goal?.topic || "",
          current_level: goal?.current_level || "",
          weekly_minutes: goal?.weekly_minutes || 360,
          target_weeks: goal?.target_weeks || 4,
          module_count: moduleCount,
          lesson_count: lessonCount,
          completed_tasks: completedTasks,
        });
      }
      return { rows };
    }

    if (!norm.startsWith("DELETE") && norm.includes("FROM courses WHERE id=") && norm.includes("user_id=")) {
      const course = await db.collection("courses").findOne({ id: values[0], user_id: values[1] }, opts);
      return { rows: course ? [course] : [] };
    }

    if (norm === "SELECT * FROM courses WHERE user_id=$1") {
      const courses = await db.collection("courses").find({ user_id: values[0] }, opts).toArray();
      return { rows: courses };
    }

    if (!norm.startsWith("DELETE") && norm.includes("FROM courses WHERE user_id=") && !norm.includes("ILIKE")) {
      const courses = await db.collection("courses").find({ user_id: values[0] }, opts).sort({ updated_at: -1 }).toArray();
      return { rows: courses };
    }

    if (norm.includes("UPDATE courses SET title=$1")) {
      if (norm.includes("estimated_minutes=$3")) {
        const [title, summary, estimatedMinutes, assumptionsRaw, courseId, userId] = values;
        const update = {
          title,
          summary,
          estimated_minutes: estimatedMinutes,
          assumptions: parseJsonField(assumptionsRaw, []),
          updated_at: new Date().toISOString(),
        };
        const res = await db.collection("courses").findOneAndUpdate(
          { id: courseId, user_id: userId },
          { $set: update },
          { returnDocument: "after", ...opts }
        );
        const doc = safeDoc(res);
        return { rows: doc ? [doc] : [] };
      } else {
        const [title, summary, status, courseId, userId] = values;
        const update = {
          title,
          summary,
          updated_at: new Date().toISOString(),
        };
        if (status !== null && status !== undefined) update.status = status;
        const res = await db.collection("courses").findOneAndUpdate(
          { id: courseId, user_id: userId },
          { $set: update },
          { returnDocument: "after", ...opts }
        );
        const doc = safeDoc(res);
        return { rows: doc ? [doc] : [] };
      }
    }

    if (norm.includes("UPDATE courses SET status='active'")) {
      await db.collection("courses").updateOne(
        { id: values[0] },
        { $set: { status: "active", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
        opts
      );
      return { rows: [] };
    }

    if (norm.includes("DELETE FROM courses WHERE id=")) {
      const [courseId, userId] = values;
      const deleted = safeDoc(
        await db.collection("courses").findOneAndDelete({ id: courseId, user_id: userId }, opts)
      );
      if (!deleted) {
        return { rows: [] };
      }

      const lessonDocs = await db
        .collection("lessons")
        .find({ course_id: courseId }, opts)
        .project({ id: 1 })
        .toArray();
      const lessonIds = lessonDocs.map((lesson) => lesson.id).filter(Boolean);

      await db.collection("course_modules").deleteMany({ course_id: courseId }, opts);
      await db.collection("lessons").deleteMany({ course_id: courseId }, opts);
      await db.collection("study_tasks").deleteMany({ course_id: courseId }, opts);

      const unlinkFilter = {
        user_id: userId,
        $or: [
          { course_id: courseId },
          ...(lessonIds.length ? [{ lesson_id: { $in: lessonIds } }] : []),
        ],
      };
      await db.collection("notes").updateMany(unlinkFilter, { $set: { course_id: null, lesson_id: null } }, opts);
      await db.collection("flashcards").updateMany(unlinkFilter, { $set: { course_id: null, lesson_id: null } }, opts);

      await db.collection("rag_chunks").deleteMany(
        {
          user_id: userId,
          source_type: "lesson",
          $or: [
            { course_id: courseId },
            ...(lessonIds.length ? [{ source_id: { $in: lessonIds } }] : []),
          ],
        },
        opts
      );
      await db.collection("rag_chunks").updateMany(
        unlinkFilter,
        { $set: { course_id: null, lesson_id: null } },
        opts
      );
      return { rows: [deleted] };
    }

    // 6. MODULES & LESSONS
    if (norm.includes("INSERT INTO course_modules")) {
      const [id, courseId, position, title, objective, rationale, prereqPositions, estimatedMinutes, sourceRefsRaw] = values;
      const doc = {
        id: id || uuid(),
        course_id: courseId,
        position,
        title,
        objective,
        rationale: rationale || "",
        prerequisite_positions: prereqPositions || [],
        estimated_minutes: estimatedMinutes || 0,
        source_refs: parseJsonField(sourceRefsRaw, []),
        status: "planned",
      };
      await db.collection("course_modules").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("DELETE FROM course_modules WHERE course_id=")) {
      const courseId = values[0];
      await db.collection("course_modules").deleteMany({ course_id: courseId }, opts);
      await db.collection("lessons").deleteMany({ course_id: courseId }, opts);
      return { rows: [] };
    }

    if (norm.includes("INSERT INTO lessons")) {
      const [id, courseId, moduleId, position, title, objective, prerequisites, contentMarkdown, workedExample, checkpointRaw, sourceRefsRaw, estimatedMinutes] = values;
      const doc = {
        id: id || uuid(),
        course_id: courseId,
        module_id: moduleId,
        position,
        title,
        objective,
        prerequisites: prerequisites || [],
        content_markdown: contentMarkdown || "",
        worked_example: workedExample || "",
        checkpoint: parseJsonField(checkpointRaw, {}),
        source_refs: parseJsonField(sourceRefsRaw, []),
        estimated_minutes: estimatedMinutes || 25,
        reading_only: false,
        created_at: new Date().toISOString(),
      };
      await db.collection("lessons").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("DELETE FROM lessons WHERE course_id=")) {
      const courseId = values[0];
      await db.collection("lessons").deleteMany({ course_id: courseId }, opts);
      return { rows: [] };
    }

    if (norm.includes("FROM course_modules") && (norm.includes("ORDER BY position") || norm.includes("ORDER BY m.position") || norm.includes("GROUP BY m.id"))) {
      const modules = await db.collection("course_modules").find({ course_id: values[0] }, opts).sort({ position: 1 }).toArray();
      for (const mod of modules) {
        const lessons = await db.collection("lessons").find({ module_id: mod.id }, opts).sort({ position: 1 }).toArray();
        mod.lessons = lessons.map(l => ({
          ...l,
          sourceRefs: l.source_refs || l.sourceRefs || [],
        }));
      }
      return { rows: modules };
    }

    if (norm.includes("FROM lessons WHERE course_id=")) {
      const modules = await db.collection("course_modules").find({ course_id: values[0] }, opts).sort({ position: 1 }).toArray();
      const modPos = new Map(modules.map((m, idx) => [m.id, Number(m.position) || idx + 1]));
      const lessons = await db.collection("lessons").find({ course_id: values[0] }, opts).toArray();
      lessons.sort((a, b) => {
        const modDiff =
          (modPos.get(a.module_id) ?? Number.MAX_SAFE_INTEGER) -
          (modPos.get(b.module_id) ?? Number.MAX_SAFE_INTEGER);
        if (modDiff !== 0) return modDiff;
        return (Number(a.position) || 0) - (Number(b.position) || 0);
      });
      return { rows: lessons };
    }

    if (norm.includes("FROM lessons l JOIN courses c ON c.id=l.course_id") && (norm.includes("l.id=$1") || norm.includes("l.id = $1"))) {
      const [lessonId, userId] = values;
      const lesson = await db.collection("lessons").findOne({ id: lessonId }, opts);
      if (!lesson) return { rows: [] };
      const course = await db.collection("courses").findOne({ id: lesson.course_id, user_id: userId }, opts);
      if (!course) return { rows: [] };
      const mod = lesson.module_id ? await db.collection("course_modules").findOne({ id: lesson.module_id }, opts) : null;
      return {
        rows: [{
          ...lesson,
          course_title: course.title,
          module_title: mod?.title || "",
        }],
      };
    }

    if (norm.includes("UPDATE course_modules m SET title=$1,objective=$2")) {
      const [title, objective, moduleId, userId] = values;
      const mod = await db.collection("course_modules").findOne({ id: moduleId }, opts);
      if (!mod) return { rows: [] };
      const course = await db.collection("courses").findOne({ id: mod.course_id, user_id: userId }, opts);
      if (!course) return { rows: [] };
      const updated = await db.collection("course_modules").findOneAndUpdate(
        { id: moduleId },
        { $set: { title, objective } },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(updated);
      return { rows: doc ? [doc] : [] };
    }

    if (norm.includes("UPDATE lessons")) {
      const lessonId = values[values.length - 1];
      const setFields = {};
      if (norm.includes("worked_example=$1") && norm.includes("checkpoint=$2")) {
        setFields.worked_example = values[0];
        setFields.checkpoint = parseJsonField(values[1], {});
      } else if (norm.includes("worked_example=")) {
        setFields.worked_example = values[0];
      } else if (norm.includes("checkpoint=")) {
        setFields.checkpoint = parseJsonField(values[0], {});
      }
      const res = await db.collection("lessons").findOneAndUpdate(
        { id: lessonId },
        { $set: setFields },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(res);
      return { rows: doc ? [doc] : [] };
    }

    // 7. STUDY_TASKS
    if (norm.includes("INSERT INTO study_tasks")) {
      let id = uuid(), userId, courseId, lessonId = null, taskType = "lesson", title = "", scheduledAt = null, estimatedMinutes = 25;
      if (values.length === 6) {
        [userId, courseId, lessonId, title, scheduledAt, estimatedMinutes] = values;
      } else if (values.length === 7) {
        [userId, courseId, lessonId, taskType, title, scheduledAt, estimatedMinutes] = values;
      } else if (values.length === 8) {
        if (norm.includes("id,user_id") || norm.includes("id, user_id")) {
          [id, userId, courseId, lessonId, taskType, title, scheduledAt, estimatedMinutes] = values;
        } else {
          [userId, courseId, lessonId, taskType, title, scheduledAt, , estimatedMinutes] = values;
        }
      } else if (values.length >= 9) {
        [id, userId, courseId, lessonId, taskType, title, scheduledAt, , estimatedMinutes] = values;
      }
      if (norm.includes("'practice'")) taskType = "practice";
      if (norm.includes("'project'")) taskType = "project";
      if (norm.includes("'review'")) taskType = "review";
      if (norm.includes("'lesson'")) taskType = "lesson";

      const doc = {
        id: id || uuid(),
        user_id: userId,
        course_id: courseId,
        lesson_id: lessonId || null,
        task_type: taskType || "lesson",
        title,
        scheduled_at: scheduledAt || null,
        status: "upcoming",
        estimated_minutes: Number(estimatedMinutes) || 25,
        actual_minutes: null,
        started_at: null,
        completed_at: null,
        created_at: new Date().toISOString(),
      };
      await db.collection("study_tasks").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("UPDATE study_tasks SET status='overdue'")) {
      const userId = values[0];
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await db.collection("study_tasks").updateMany(
        {
          user_id: userId,
          status: { $in: ["upcoming", "due", "rescheduled"] },
          scheduled_at: { $lt: oneDayAgo },
        },
        { $set: { status: "overdue" } },
        opts
      );
      return { rows: [] };
    }

    if (norm.includes("FROM study_tasks t LEFT JOIN lessons l ON l.id=t.lesson_id JOIN courses c ON c.id=t.course_id WHERE t.user_id=$1")) {
      const userId = values[0];
      const fromDate = values[1];
      const toDate = values[2];
      const filter = { user_id: userId };
      if (fromDate || toDate) {
        filter.scheduled_at = {};
        if (fromDate) filter.scheduled_at.$gte = new Date(fromDate).toISOString();
        if (toDate) filter.scheduled_at.$lt = new Date(toDate).toISOString();
      }
      const tasks = await db.collection("study_tasks").find(filter, opts).sort({ scheduled_at: 1, created_at: 1 }).limit(200).toArray();
      const courseIds = [...new Set(tasks.map((t) => t.course_id).filter(Boolean))];
      const [coursesList, lessonsList, modulesList] = await Promise.all([
        courseIds.length ? db.collection("courses").find({ id: { $in: courseIds } }, opts).toArray() : [],
        courseIds.length ? db.collection("lessons").find({ course_id: { $in: courseIds } }, opts).toArray() : [],
        courseIds.length ? db.collection("course_modules").find({ course_id: { $in: courseIds } }, opts).toArray() : [],
      ]);
      const courseMap = new Map(coursesList.map((c) => [c.id, c]));
      const lessonMap = new Map(lessonsList.map((l) => [l.id, l]));
      const moduleMap = new Map(modulesList.map((m) => [m.id, m]));

      for (const t of tasks) {
        const lesson = t.lesson_id ? lessonMap.get(t.lesson_id) : null;
        const mod = lesson?.module_id ? moduleMap.get(lesson.module_id) : null;
        if (lesson) {
          t.objective = lesson.objective || "";
          t.lesson_position = Number(lesson.position) || 0;
          t.module_position = Number(mod?.position) || 0;
        }
        t.course_title = courseMap.get(t.course_id)?.title || "";
      }

      // Self-heal un-rescheduled upcoming/due lesson tasks whose scheduled_at slots were persisted in shuffled module UUID order
      if (!fromDate && !toDate) {
        const tasksByCourse = new Map();
        for (const t of tasks) {
          if (!t.course_id) continue;
          if (!tasksByCourse.has(t.course_id)) tasksByCourse.set(t.course_id, []);
          tasksByCourse.get(t.course_id).push(t);
        }
        for (const courseTasks of tasksByCourse.values()) {
          const autoLessonTasks = courseTasks.filter(
            (t) =>
              t.task_type === "lesson" &&
              t.lesson_id &&
              Number(t.module_position) > 0 &&
              (t.status === "upcoming" || t.status === "due")
          );
          if (autoLessonTasks.length < 2) continue;

          const byRoadmap = [...autoLessonTasks].sort((a, b) => {
            const modDiff = Number(a.module_position) - Number(b.module_position);
            if (modDiff !== 0) return modDiff;
            return (Number(a.lesson_position) || 0) - (Number(b.lesson_position) || 0);
          });

          const bySchedule = [...autoLessonTasks].sort(
            (a, b) => new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime()
          );

          const isOutOfOrder = byRoadmap.some((task, idx) => {
            if (idx === 0) return false;
            const prevTime = new Date(byRoadmap[idx - 1].scheduled_at || 0).getTime();
            const currTime = new Date(task.scheduled_at || 0).getTime();
            return currTime <= prevTime;
          });

          if (isOutOfOrder) {
            const baseTimes = bySchedule.map((t) => new Date(t.scheduled_at || Date.now()).getTime());
            const updatedLessonSchedule = new Map();
            for (let i = 0; i < byRoadmap.length; i++) {
              const targetTask = byRoadmap[i];
              const slotTime = i > 0 && baseTimes[i] <= baseTimes[i - 1] ? baseTimes[i - 1] + 1000 : baseTimes[i];
              baseTimes[i] = slotTime;
              const nextIso = new Date(slotTime).toISOString();
              if (targetTask.scheduled_at !== nextIso) {
                targetTask.scheduled_at = nextIso;
                updatedLessonSchedule.set(targetTask.lesson_id, slotTime);
                await db.collection("study_tasks").updateOne(
                  { id: targetTask.id, user_id: userId },
                  { $set: { scheduled_at: nextIso } },
                  opts
                );
              }
            }
            if (updatedLessonSchedule.size > 0) {
              for (const t of courseTasks) {
                if (
                  t.task_type === "practice" &&
                  (t.status === "upcoming" || t.status === "due") &&
                  updatedLessonSchedule.has(t.lesson_id)
                ) {
                  const baseMs = updatedLessonSchedule.get(t.lesson_id);
                  const mins = Number(lessonMap.get(t.lesson_id)?.estimated_minutes) || 25;
                  const practiceIso = new Date(baseMs + mins * 60_000).toISOString();
                  if (t.scheduled_at !== practiceIso) {
                    t.scheduled_at = practiceIso;
                    await db.collection("study_tasks").updateOne(
                      { id: t.id, user_id: userId },
                      { $set: { scheduled_at: practiceIso } },
                      opts
                    );
                  }
                }
              }
            }
          }
        }
      }

      const typeWeight = (type) => (type === "lesson" ? 0 : type === "practice" ? 1 : 2);
      tasks.sort((a, b) => {
        const timeDiff = new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime();
        if (timeDiff !== 0) return timeDiff;
        const modDiff = (Number(a.module_position) || 0) - (Number(b.module_position) || 0);
        if (modDiff !== 0) return modDiff;
        const lessonDiff = (Number(a.lesson_position) || 0) - (Number(b.lesson_position) || 0);
        if (lessonDiff !== 0) return lessonDiff;
        return typeWeight(a.task_type) - typeWeight(b.task_type);
      });

      return { rows: tasks };
    }

    if (norm.includes("FROM study_tasks") && norm.includes("WHERE user_id=$1") && norm.includes("status IN ('due','in_progress','upcoming','overdue')")) {
      const tasks = await db.collection("study_tasks").find({
        user_id: values[0],
        status: { $in: ["due", "in_progress", "upcoming", "overdue"] },
      }, opts).sort({ scheduled_at: 1 }).limit(8).toArray();
      return { rows: tasks };
    }

    if (norm.includes("FROM study_tasks WHERE id=$1 AND user_id=$2")) {
      const task = await db.collection("study_tasks").findOne({ id: values[0], user_id: values[1] }, opts);
      return { rows: task ? [task] : [] };
    }

    if (norm === "SELECT * FROM study_tasks WHERE user_id=$1") {
      const tasks = await db.collection("study_tasks").find({ user_id: values[0] }, opts).sort({ created_at: -1 }).toArray();
      return { rows: tasks };
    }

    if (norm.includes("FROM study_tasks") && !norm.includes("COUNT(*)") && !norm.includes("LEFT JOIN")) {
      const filter = {};
      if (norm.includes("user_id=$1")) filter.user_id = values[0];
      if (norm.includes("user_id=$2")) filter.user_id = values[1];
      if (norm.includes("course_id=$1")) filter.course_id = values[0];
      if (norm.includes("course_id=$2")) filter.course_id = values[1];
      if (norm.includes("lesson_id=$2")) filter.lesson_id = values[1];
      if (norm.includes("lesson_id=$3")) filter.lesson_id = values[2];
      if (norm.includes("task_type='lesson'")) filter.task_type = "lesson";
      else if (norm.includes("task_type='practice'")) filter.task_type = "practice";
      else if (norm.includes("task_type='project'")) filter.task_type = "project";
      if (norm.includes("title=$3")) filter.title = values[2];
      if (norm.includes("title=$4")) filter.title = values[3];
      const tasks = await db.collection("study_tasks").find(filter, opts).sort({ scheduled_at: 1, created_at: 1 }).toArray();
      return { rows: tasks };
    }

    if (norm.includes("UPDATE study_tasks SET status='completed'")) {
      const [actualMinutes, taskId] = values;
      const res = await db.collection("study_tasks").findOneAndUpdate(
        { id: taskId },
        { $set: { status: "completed", completed_at: new Date().toISOString(), actual_minutes: actualMinutes } },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(res);
      return { rows: doc ? [doc] : [] };
    }

    if (norm.includes("UPDATE study_tasks SET status='in_progress'")) {
      const res = await db.collection("study_tasks").findOneAndUpdate(
        { id: values[0] },
        { $set: { status: "in_progress", started_at: new Date().toISOString() } },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(res);
      return { rows: doc ? [doc] : [] };
    }

    if (norm.includes("UPDATE study_tasks SET scheduled_at=$1,status='rescheduled'")) {
      const [scheduledAt, taskId] = values;
      const res = await db.collection("study_tasks").findOneAndUpdate(
        { id: taskId },
        { $set: { scheduled_at: scheduledAt, status: "rescheduled" } },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(res);
      return { rows: doc ? [doc] : [] };
    }

    // 8. NOTES
    if (norm.includes("INSERT INTO notes")) {
      let id = uuid();
      let userId, courseId = null, lessonId = null, title = "", body = "", origin = "learner", sourceRef = "";
      if (values.length === 6) {
        [userId, courseId, lessonId, title, body, sourceRef] = values;
      } else if (values.length === 7) {
        [userId, courseId, lessonId, title, body, origin, sourceRef] = values;
      } else if (values.length >= 8) {
        [id, userId, courseId, lessonId, title, body, origin, sourceRef] = values;
      }
      if (norm.includes("'ai_draft'")) origin = "ai_draft";
      const doc = {
        id: id || uuid(),
        user_id: userId,
        course_id: courseId || null,
        lesson_id: lessonId || null,
        title,
        body: body || "",
        origin: origin || "learner",
        source_ref: sourceRef || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await db.collection("notes").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm === "SELECT * FROM notes WHERE user_id=$1") {
      const notes = await db.collection("notes").find({ user_id: values[0] }, opts).sort({ updated_at: -1 }).toArray();
      return { rows: notes };
    }

    if (norm.includes("FROM notes") && norm.includes("user_id=$1") && norm.includes("ORDER BY") && !norm.includes("ILIKE") && !norm.includes("to_tsvector")) {
      const notes = await db.collection("notes").find({ user_id: values[0] }, opts).sort({ updated_at: -1 }).toArray();
      for (const n of notes) {
        if (n.course_id) {
          const c = await db.collection("courses").findOne({ id: n.course_id }, opts);
          n.course_title = c?.title || "";
        }
        if (n.lesson_id) {
          const l = await db.collection("lessons").findOne({ id: n.lesson_id }, opts);
          n.lesson_title = l?.title || "";
        }
      }
      return { rows: notes };
    }

    if (norm.includes("FROM notes") && (norm.includes("id=$1") || norm.includes("id = $1")) && (norm.includes("user_id=$2") || norm.includes("user_id = $2"))) {
      const [noteId, userId] = values;
      const note = await db.collection("notes").findOne({ id: noteId, user_id: userId }, opts);
      if (!note) return { rows: [] };
      if (note.course_id) {
        const c = await db.collection("courses").findOne({ id: note.course_id }, opts);
        note.course_title = c?.title || "";
      }
      if (note.lesson_id) {
        const l = await db.collection("lessons").findOne({ id: note.lesson_id }, opts);
        note.lesson_title = l?.title || "";
      }
      return { rows: [note] };
    }

    if (norm.includes("FROM notes") && (norm.includes("course_id=$1") || norm.includes("course_id=$2") || norm.includes("course_id=")) && !norm.includes("ILIKE") && !norm.includes("to_tsvector")) {
      const filter = {};
      if (norm.includes("user_id=$1")) filter.user_id = values[0];
      if (norm.includes("user_id=$2")) filter.user_id = values[1];
      if (norm.includes("course_id=$1")) filter.course_id = values[0];
      if (norm.includes("course_id=$2")) filter.course_id = values[1];
      if (norm.includes("lesson_id=$3")) filter.lesson_id = values[2];
      if (norm.includes("lesson_id IS NULL")) filter.lesson_id = null;
      if (norm.includes("origin='ai_draft'")) filter.origin = "ai_draft";
      else if (norm.includes("origin=$3")) filter.origin = values[2];

      if (norm.includes("COUNT(*)")) {
        const count = await db.collection("notes").countDocuments(filter, opts);
        return { rows: [{ count }] };
      }
      const notes = await db.collection("notes").find(filter, opts).sort({ updated_at: -1, created_at: -1 }).toArray();
      return { rows: notes };
    }

    if (norm.includes("UPDATE notes SET title=$1,body=$2")) {
      const [title, body, noteId, userId] = values;
      const res = await db.collection("notes").findOneAndUpdate(
        { id: noteId, user_id: userId },
        { $set: { title, body, updated_at: new Date().toISOString() } },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(res);
      return { rows: doc ? [doc] : [] };
    }

    if (norm.includes("DELETE FROM notes WHERE id=$1 AND user_id=$2")) {
      const res = await db.collection("notes").deleteOne({ id: values[0], user_id: values[1] }, opts);
      return { rows: res.deletedCount > 0 ? [{ id: values[0] }] : [] };
    }

    // 9. FLASHCARDS
    if (norm.includes("INSERT INTO flashcards")) {
      let id = uuid();
      let userId, courseId = null, lessonId = null, front = "", back = "";
      if (values.length === 5) {
        [userId, courseId, lessonId, front, back] = values;
      } else if (values.length >= 6) {
        [id, userId, courseId, lessonId, front, back] = values;
      }
      const doc = {
        id: id || uuid(),
        user_id: userId,
        course_id: courseId || null,
        lesson_id: lessonId || null,
        front,
        back,
        due_at: new Date().toISOString(),
        interval_days: 0,
        ease: 2.5,
        repetitions: 0,
        created_at: new Date().toISOString(),
      };
      await db.collection("flashcards").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm === "SELECT * FROM flashcards WHERE user_id=$1") {
      const cards = await db.collection("flashcards").find({ user_id: values[0] }, opts).sort({ due_at: 1 }).toArray();
      return { rows: cards };
    }

    if (norm.includes("FROM flashcards") && norm.includes("user_id=$1") && !norm.includes("COUNT(*)")) {
      const filter = { user_id: values[0] };
      if (norm.includes("course_id=$2")) filter.course_id = values[1];
      if (norm.includes("lesson_id=$3")) filter.lesson_id = values[2];
      if (norm.includes("front=$4")) filter.front = values[3];
      const cards = await db.collection("flashcards").find(filter, opts).sort({ due_at: 1, created_at: 1 }).toArray();
      for (const card of cards) {
        if (card.lesson_id) {
          const lesson = await db.collection("lessons").findOne({ id: card.lesson_id }, opts);
          card.lesson_title = lesson?.title || "";
        }
      }
      return { rows: cards };
    }

    if (norm.includes("FROM flashcards WHERE id=$1 AND user_id=$2")) {
      const card = await db.collection("flashcards").findOne({ id: values[0], user_id: values[1] }, opts);
      return { rows: card ? [card] : [] };
    }

    if (norm.includes("UPDATE flashcards SET due_at=$1")) {
      const [dueAt, intervalDays, easeDelta, cardId] = values;
      const card = await db.collection("flashcards").findOne({ id: cardId }, opts);
      const currentEase = Number(card?.ease ?? 2.5);
      const newEase = Math.max(1.3, Number((currentEase + Number(easeDelta)).toFixed(2)));
      const newReps = (card?.repetitions || 0) + 1;
      const res = await db.collection("flashcards").findOneAndUpdate(
        { id: cardId },
        { $set: { due_at: dueAt, interval_days: intervalDays, ease: newEase, repetitions: newReps } },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(res);
      return { rows: doc ? [doc] : [] };
    }

    if (norm.includes("DELETE FROM flashcards WHERE id=$1 AND user_id=$2")) {
      await db.collection("flashcards").deleteOne({ id: values[0], user_id: values[1] }, opts);
      return { rows: [] };
    }

    if (norm.includes("INSERT INTO review_events")) {
      const [userId, cardId, rating, nextDue] = values;
      await db.collection("review_events").insertOne({
        id: uuid(),
        user_id: userId,
        flashcard_id: cardId,
        rating,
        reviewed_at: new Date().toISOString(),
        next_due_at: nextDue,
      }, opts);
      return { rows: [] };
    }

    // 10. PRACTICE_ATTEMPTS
    if (norm.includes("INSERT INTO practice_attempts")) {
      const [userId, taskId, lessonId, concept, prompt, answer, resultRaw, score] = values;
      const doc = {
        id: uuid(),
        user_id: userId,
        task_id: taskId || null,
        lesson_id: lessonId || null,
        concept: concept || "",
        prompt: prompt || "",
        submitted_answer: answer || "",
        result: parseJsonField(resultRaw, {}),
        score: score !== null && score !== undefined ? Number(score) : null,
        created_at: new Date().toISOString(),
      };
      await db.collection("practice_attempts").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("FROM practice_attempts WHERE user_id=$1 AND lesson_id=$2 AND score>=70")) {
      const [userId, lessonId] = values;
      const attempt = await db.collection("practice_attempts").findOne(
        { user_id: userId, lesson_id: lessonId, score: { $gte: 70 } },
        opts
      );
      return { rows: attempt ? [attempt] : [] };
    }

    if (norm === "SELECT * FROM practice_attempts WHERE user_id=$1") {
      const attempts = await db.collection("practice_attempts").find({ user_id: values[0] }, opts).sort({ created_at: -1 }).toArray();
      return { rows: attempts };
    }

    if (
      norm.includes("FROM practice_attempts") &&
      norm.includes("WHERE user_id=$1") &&
      !norm.includes("GROUP BY") &&
      !norm.includes("to_tsvector") &&
      !norm.includes("COUNT(") &&
      !norm.includes("lesson_id=$2")
    ) {
      const attempts = await db.collection("practice_attempts").find({ user_id: values[0] }, opts).sort({ created_at: -1 }).limit(100).toArray();
      return { rows: attempts };
    }

    // 11. STUDY_ROOMS
    if (norm.includes("INSERT INTO study_rooms")) {
      const [code, ownerId, title, topic, focus, pause, longPause, every] = values;
      const doc = {
        id: uuid(),
        room_code: code,
        owner_user_id: ownerId,
        title,
        topic: topic || "",
        focus_minutes: focus,
        break_minutes: pause,
        long_break_minutes: longPause,
        long_break_every: every,
        phase: "idle",
        paused_phase: null,
        completed_focuses: 0,
        paused_remaining_seconds: 0,
        phase_started_at: null,
        phase_ends_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await db.collection("study_rooms").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("FROM study_rooms WHERE room_code=$1")) {
      const room = await db.collection("study_rooms").findOne({ room_code: values[0] }, opts);
      return { rows: room ? [room] : [] };
    }

    if (norm.includes("INSERT INTO study_room_members")) {
      const [roomId, userId, roleOrCondition] = values;
      let role = "member";
      if (roleOrCondition === true || roleOrCondition === "owner" || norm.includes("'owner'")) {
        role = "owner";
      }
      await db.collection("study_room_members").updateOne(
        { room_id: roomId, user_id: userId },
        { $set: { role, last_seen_at: new Date().toISOString() }, $setOnInsert: { joined_at: new Date().toISOString() } },
        { upsert: true, ...opts }
      );
      return { rows: [] };
    }

    if (norm.includes("UPDATE study_room_members SET last_seen_at=NOW()")) {
      const [roomId, userId] = values;
      await db.collection("study_room_members").updateOne(
        { room_id: roomId, user_id: userId },
        { $set: { last_seen_at: new Date().toISOString() } },
        opts
      );
      return { rows: [] };
    }

    if (norm.includes("FROM study_room_members WHERE room_id=$1 AND user_id=$2")) {
      const [roomId, userId] = values;
      const mem = await db.collection("study_room_members").findOne({ room_id: roomId, user_id: userId }, opts);
      return { rows: mem ? [mem] : [] };
    }

    if (norm.includes("FROM study_room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=$1")) {
      const members = await db.collection("study_room_members").find({ room_id: values[0] }, opts).toArray();
      const rows = [];
      const thirtySecAgo = new Date(Date.now() - 30000).toISOString();
      for (const m of members) {
        const u = await db.collection("users").findOne({ id: m.user_id }, opts);
        rows.push({
          user_id: m.user_id,
          role: m.role,
          full_name: u?.full_name || "Member",
          last_seen_at: m.last_seen_at,
          is_online: m.last_seen_at >= thirtySecAgo,
        });
      }
      return { rows };
    }

    if (norm.includes("UPDATE study_rooms SET phase=$1")) {
      const [phase, pausedPhase, completed, pausedRemaining, started, ends, roomId] = values;
      const res = await db.collection("study_rooms").findOneAndUpdate(
        { id: roomId },
        {
          $set: {
            phase,
            paused_phase: pausedPhase,
            completed_focuses: completed,
            paused_remaining_seconds: pausedRemaining,
            phase_started_at: started,
            phase_ends_at: ends,
            updated_at: new Date().toISOString(),
          },
        },
        { returnDocument: "after", ...opts }
      );
      const doc = safeDoc(res);
      return { rows: doc ? [doc] : [] };
    }

    if (norm.includes("FROM study_rooms r JOIN study_room_members mine ON mine.room_id=r.id")) {
      const myMemberships = await db.collection("study_room_members").find({ user_id: values[0] }, opts).toArray();
      const roomIds = myMemberships.map(m => m.room_id);
      const rooms = await db.collection("study_rooms").find({ id: { $in: roomIds } }, opts).sort({ updated_at: -1 }).limit(40).toArray();
      for (const r of rooms) {
        const members = await db.collection("study_room_members").find({ room_id: r.id }, opts).toArray();
        r.participants = [];
        const thirtySecAgo = new Date(Date.now() - 30000).toISOString();
        for (const m of members) {
          const u = await db.collection("users").findOne({ id: m.user_id }, opts);
          r.participants.push({ id: m.user_id, name: u?.full_name || "Member", role: m.role, isOnline: m.last_seen_at >= thirtySecAgo });
        }
      }
      return { rows: rooms };
    }

    // 12. AI JOBS
    if (norm.includes("INSERT INTO ai_jobs")) {
      let id = uuid();
      let userId, jobType, status = "succeeded", inputRefRaw = "{}", outputRefRaw = null, errorCode = null, finishedAt = null;
      if (norm.includes("'course_materials_generation'")) {
        jobType = "course_materials_generation";
        status = norm.includes("'running'") ? "running" : "succeeded";
        if (values.length === 2) {
          [userId, inputRefRaw] = values;
        } else if (values.length === 3) {
          [id, userId, inputRefRaw] = values;
        } else if (values.length >= 4) {
          [id, userId, inputRefRaw, outputRefRaw] = values;
        }
      } else {
        [userId, inputRefRaw, outputRefRaw] = values;
        jobType = norm.includes("'course_plan_improvement'") ? "course_plan_improvement" : "course_plan";
        finishedAt = new Date().toISOString();
      }
      const doc = {
        id: id || uuid(),
        user_id: userId,
        job_type: jobType,
        status,
        input_ref: parseJsonField(inputRefRaw, {}),
        output_ref: parseJsonField(outputRefRaw, null),
        error_code: errorCode,
        finished_at: finishedAt,
        created_at: new Date().toISOString(),
      };
      await db.collection("ai_jobs").insertOne(doc, opts);
      return { rows: [doc] };
    }

    if (norm.includes("UPDATE ai_jobs")) {
      const id = values[values.length - 1];
      const updateFields = {
        finished_at: new Date().toISOString(),
      };
      if (norm.includes("status='succeeded'") || norm.includes("status=$1")) {
        const status = norm.includes("status='succeeded'") ? "succeeded" : values[0];
        updateFields.status = status;
        if (norm.includes("output_ref=$1")) updateFields.output_ref = parseJsonField(values[0], {});
        else if (norm.includes("output_ref=$2")) updateFields.output_ref = parseJsonField(values[1], {});
        if (norm.includes("error_code=null") || norm.includes("error_code=NULL")) updateFields.error_code = null;
        else if (norm.includes("error_code=$3")) updateFields.error_code = values[2] || null;
      } else if (norm.includes("status='failed'")) {
        updateFields.status = "failed";
        if (norm.includes("error_code=$1")) updateFields.error_code = values[0];
      }
      const res = await db.collection("ai_jobs").findOneAndUpdate(
        { id },
        { $set: updateFields },
        { returnDocument: "after", ...opts }
      );
      const updatedDoc = res ? (res.value !== undefined ? res.value : res) : null;
      return { rows: updatedDoc ? [updatedDoc] : [] };
    }

    if (norm.includes("FROM ai_jobs")) {
      const filter = {};
      if (norm.includes("user_id=$1")) filter.user_id = values[0];
      if (norm.includes("job_type='course_materials_generation'")) {
        filter.job_type = "course_materials_generation";
      } else if (norm.includes("job_type=$2")) {
        filter.job_type = values[1];
      }
      let cursor = db.collection("ai_jobs").find(filter, opts).sort({ created_at: -1 });
      if (norm.includes("LIMIT 1")) cursor = cursor.limit(1);
      else if (norm.includes("LIMIT 5")) cursor = cursor.limit(5);
      else if (norm.includes("LIMIT 10")) cursor = cursor.limit(10);
      const jobs = await cursor.toArray();
      return { rows: jobs };
    }

    // 13. AGGREGATES & HOME DASHBOARD
    // getHome combined counts
    if (
      norm.includes("SELECT (SELECT COUNT(*)::int FROM notes WHERE user_id=$1) notes") ||
      (norm.includes("COUNT(*)::int FROM notes WHERE user_id=$1") && norm.includes("COUNT(*)::int FROM flashcards WHERE user_id=$1"))
    ) {
      const userId = values[0];
      const [notes, flashcards, attempts, completed, total] = await Promise.all([
        db.collection("notes").countDocuments({ user_id: userId }, opts),
        db.collection("flashcards").countDocuments({ user_id: userId }, opts),
        db.collection("practice_attempts").countDocuments({ user_id: userId }, opts),
        db.collection("study_tasks").countDocuments({ user_id: userId, status: "completed" }, opts),
        db.collection("study_tasks").countDocuments({ user_id: userId }, opts),
      ]);
      return {
        rows: [{
          notes,
          flashcards,
          attempts,
          completed,
          total,
        }],
      };
    }

    if (norm.includes("COUNT(*)::int AS count FROM flashcards WHERE user_id=$1 AND due_at<=NOW()")) {
      const count = await db.collection("flashcards").countDocuments(
        { user_id: values[0], due_at: { $lte: new Date().toISOString() } },
        opts
      );
      return { rows: [{ count }] };
    }

    if (norm.includes("SELECT COUNT(DISTINCT concept)::int AS concepts FROM practice_attempts")) {
      const distinct = await db.collection("practice_attempts").distinct(
        "concept",
        { user_id: values[0], score: { $gte: 70 }, concept: { $ne: "" } },
        opts
      );
      return { rows: [{ concepts: distinct.length }] };
    }

    // 14. PROGRESS PAGE QUERIES
    // Progress courses completion
    if (norm.includes("FROM courses c LEFT JOIN study_tasks t ON t.course_id=c.id AND t.user_id=$1")) {
      const userId = values[0];
      const courses = await db.collection("courses").find({ user_id: userId }, opts).sort({ created_at: -1 }).toArray();
      const rows = [];
      for (const c of courses) {
        const totalTasks = await db.collection("study_tasks").countDocuments({ course_id: c.id, user_id: userId }, opts);
        const completedTasks = await db.collection("study_tasks").countDocuments({ course_id: c.id, user_id: userId, status: "completed" }, opts);
        rows.push({
          id: c.id,
          title: c.title,
          total_tasks: totalTasks,
          completed_tasks: completedTasks,
        });
      }
      return { rows };
    }

    // Progress tasks by status
    if (norm.includes("SELECT status,COUNT(*)::int count FROM study_tasks WHERE user_id=$1 GROUP BY status")) {
      const pipeline = [
        { $match: { user_id: values[0] } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ];
      const result = await db.collection("study_tasks").aggregate(pipeline, opts).toArray();
      return { rows: result.map(r => ({ status: r._id, count: r.count })) };
    }

    // Progress concept attempts & averages
    if (norm.includes("FROM practice_attempts WHERE user_id=$1 AND concept<>'' GROUP BY concept")) {
      const pipeline = [
        { $match: { user_id: values[0], concept: { $exists: true, $ne: "" } } },
        {
          $group: {
            _id: "$concept",
            attempts: { $sum: 1 },
            average_score: { $avg: "$score" },
            last_evidence: { $max: "$created_at" },
          },
        },
        { $sort: { last_evidence: -1 } },
        { $limit: 12 },
      ];
      const result = await db.collection("practice_attempts").aggregate(pipeline, opts).toArray();
      return {
        rows: result.map(r => ({
          concept: r._id,
          attempts: r.attempts,
          average_score: r.average_score !== null && r.average_score !== undefined ? Math.round(r.average_score) : null,
          last_evidence: r.last_evidence,
        })),
      };
    }

    // Progress weekly study counts
    if (norm.includes("date_trunc('week',scheduled_at)")) {
      const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString();
      const tasks = await db.collection("study_tasks").find(
        {
          user_id: values[0],
          scheduled_at: { $gt: eightWeeksAgo },
        },
        opts
      ).toArray();
      const weeksMap = new Map();
      for (const t of tasks) {
        if (!t.scheduled_at) continue;
        const d = new Date(t.scheduled_at);
        if (isNaN(d.getTime())) continue;
        const day = d.getUTCDay();
        const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).toISOString().slice(0, 10);
        if (!weeksMap.has(mon)) {
          weeksMap.set(mon, { week: mon, scheduled: 0, completed: 0 });
        }
        const w = weeksMap.get(mon);
        w.scheduled++;
        if (t.status === "completed") {
          w.completed++;
        }
      }
      const rows = Array.from(weeksMap.values()).sort((a, b) => a.week.localeCompare(b.week));
      return { rows };
    }

    // Progress recent attempts
    if (norm.includes("FROM practice_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50")) {
      const attempts = await db.collection("practice_attempts").find({ user_id: values[0] }, opts).sort({ created_at: -1 }).limit(50).toArray();
      return {
        rows: attempts.map(a => ({
          id: a.id,
          lesson_id: a.lesson_id,
          concept: a.concept,
          score: a.score,
          result: a.result,
          created_at: a.created_at,
        })),
      };
    }

    // 15. SEARCH QUERIES (ILIKE)
    // Search lessons
    if (norm.includes("FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.user_id=$1") && norm.includes("ILIKE $2")) {
      const [userId, termRaw] = values;
      const term = String(termRaw || "").replace(/^%+|%+$/g, "");
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const courses = await db.collection("courses").find({ user_id: userId }, opts).toArray();
      const courseIds = courses.map(c => c.id);
      const courseMap = new Map(courses.map(c => [c.id, c.title]));
      const lessons = await db.collection("lessons").find(
        {
          course_id: { $in: courseIds },
          $or: [{ title: { $regex: regex } }, { objective: { $regex: regex } }],
        },
        opts
      ).limit(8).toArray();
      return {
        rows: lessons.map(l => ({
          id: l.id,
          title: l.title,
          objective: l.objective,
          course_title: courseMap.get(l.course_id) || "",
        })),
      };
    }

    // Search notes
    if (norm.includes("FROM notes WHERE user_id=$1") && norm.includes("ILIKE $2")) {
      const [userId, termRaw] = values;
      const term = String(termRaw || "").replace(/^%+|%+$/g, "");
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const notes = await db.collection("notes").find(
        {
          user_id: userId,
          $or: [{ title: { $regex: regex } }, { body: { $regex: regex } }],
        },
        opts
      ).limit(8).toArray();
      return {
        rows: notes.map(n => ({ id: n.id, title: n.title, body: n.body })),
      };
    }

    // Search courses
    if (norm.includes("FROM courses WHERE user_id=$1 AND title ILIKE $2")) {
      const [userId, termRaw] = values;
      const term = String(termRaw || "").replace(/^%+|%+$/g, "");
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      const courses = await db.collection("courses").find(
        { user_id: userId, title: { $regex: regex } },
        opts
      ).limit(5).toArray();
      return {
        rows: courses.map(c => ({ id: c.id, title: c.title, status: c.status })),
      };
    }

    // 16. RETRIEVAL & FULL-TEXT SEARCH (to_tsvector)
    // Notes retrieval
    if (norm.includes("FROM notes WHERE user_id=$1") && norm.includes("to_tsvector")) {
      const userId = values[0];
      const words = parseTsQueryWords(values[1]);
      if (!words.length) return { rows: [] };
      const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const regex = new RegExp(pattern, "i");
      const notes = await db.collection("notes").find(
        {
          user_id: userId,
          $or: [{ title: { $regex: regex } }, { body: { $regex: regex } }],
        },
        opts
      ).sort({ updated_at: -1 }).limit(5).toArray();
      return {
        rows: notes.map(n => ({
          id: n.id,
          title: n.title,
          excerpt: String(n.body || "").slice(0, 1800),
          rank: 1,
        })),
      };
    }

    // Lessons retrieval
    if (norm.includes("FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.user_id=$1") && norm.includes("to_tsvector")) {
      const userId = values[0];
      const words = parseTsQueryWords(values[1]);
      if (!words.length) return { rows: [] };
      const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const regex = new RegExp(pattern, "i");
      const courses = await db.collection("courses").find({ user_id: userId }, opts).toArray();
      const courseIds = courses.map(c => c.id);
      const courseMap = new Map(courses.map(c => [c.id, c.title]));
      const lessons = await db.collection("lessons").find(
        {
          course_id: { $in: courseIds },
          $or: [
            { title: { $regex: regex } },
            { objective: { $regex: regex } },
            { content_markdown: { $regex: regex } },
            { worked_example: { $regex: regex } },
          ],
        },
        opts
      ).limit(5).toArray();
      return {
        rows: lessons.map(l => ({
          id: l.id,
          title: l.title,
          excerpt: [l.objective, l.content_markdown, l.worked_example].filter(Boolean).join("\n").slice(0, 1800),
          course_title: courseMap.get(l.course_id) || "",
          rank: 1,
        })),
      };
    }

    if (norm.includes("FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.user_id=$1") && !norm.includes("to_tsvector") && !norm.includes("ILIKE")) {
      const userId = values[0];
      const courses = await db.collection("courses").find({ user_id: userId }, opts).toArray();
      const courseIds = courses.map(c => c.id);
      const courseMap = new Map(courses.map(c => [c.id, c.title]));
      const lessons = await db.collection("lessons").find({ course_id: { $in: courseIds } }, opts).sort({ created_at: -1 }).limit(200).toArray();
      return {
        rows: lessons.map(l => ({
          ...l,
          course_title: courseMap.get(l.course_id) || "",
        })),
      };
    }

    // Practice attempts retrieval
    if (norm.includes("FROM practice_attempts a WHERE a.user_id=$1") && norm.includes("to_tsvector")) {
      const userId = values[0];
      const words = parseTsQueryWords(values[1]);
      if (!words.length) return { rows: [] };
      const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      const regex = new RegExp(pattern, "i");
      const attempts = await db.collection("practice_attempts").find(
        {
          user_id: userId,
          $or: [
            { concept: { $regex: regex } },
            { prompt: { $regex: regex } },
            { submitted_answer: { $regex: regex } },
          ],
        },
        opts
      ).sort({ created_at: -1 }).limit(4).toArray();
      return {
        rows: attempts.map(a => ({
          id: a.id,
          title: a.concept,
          excerpt: [a.prompt, a.submitted_answer].filter(Boolean).join("\n").slice(0, 1200),
          score: a.score,
          rank: 1,
        })),
      };
    }

    // 17. RAG_CHUNKS (Hybrid RAG persistent chunks & embeddings)
    if (norm.includes("INSERT INTO rag_chunks")) {
      const [
        userId,
        sourceType,
        sourceId,
        courseId,
        lessonId,
        title,
        chunkIndex,
        content,
        contentHash,
        metadataRaw,
        embeddingRaw,
        embeddingModel,
      ] = values;
      const now = new Date().toISOString();
      const filter = {
        user_id: userId,
        source_type: sourceType,
        source_id: String(sourceId),
        chunk_index: Number(chunkIndex) || 0,
      };
      const existing = await db.collection("rag_chunks").findOne(filter, opts);
      const docId = existing?.id || uuid();
      const updateFields = {
        user_id: userId,
        source_type: sourceType,
        source_id: String(sourceId),
        course_id: courseId || null,
        lesson_id: lessonId || null,
        title: title || "",
        chunk_index: Number(chunkIndex) || 0,
        content: content || "",
        content_hash: contentHash || "",
        metadata: parseJsonField(metadataRaw, {}),
        embedding: parseJsonField(embeddingRaw, null),
        embedding_model: embeddingModel || "local-hash-v1",
        updated_at: now,
      };
      await db.collection("rag_chunks").updateOne(
        filter,
        { $set: updateFields, $setOnInsert: { id: docId } },
        { upsert: true, ...opts }
      );
      return { rows: [{ id: docId, ...updateFields }] };
    }

    if (norm.includes("DELETE FROM rag_chunks")) {
      const filter = { user_id: values[0] };
      if (norm.includes("source_type=$2")) filter.source_type = values[1];
      if (norm.includes("source_id=$3")) filter.source_id = String(values[2]);
      if (norm.includes("course_id=$3")) filter.course_id = values[2];
      if (norm.includes("chunk_index>=$4")) filter.chunk_index = { $gte: Number(values[3]) };
      await db.collection("rag_chunks").deleteMany(filter, opts);
      return { rows: [] };
    }

    if (norm.includes("FROM rag_chunks") && norm.includes("user_id=$1")) {
      const userId = values[0];
      if (norm.includes("GROUP BY source_type")) {
        const chunks = await db.collection("rag_chunks").find({ user_id: userId }, opts).toArray();
        const grouped = new Map();
        for (const chunk of chunks) {
          const type = chunk.source_type || "note";
          const entry = grouped.get(type) || {
            source_type: type,
            count: 0,
            last_indexed_at: null,
            embedding_model: chunk.embedding_model || "local-hash-v1",
          };
          entry.count += 1;
          if (!entry.last_indexed_at || (chunk.updated_at && chunk.updated_at > entry.last_indexed_at)) {
            entry.last_indexed_at = chunk.updated_at || entry.last_indexed_at;
          }
          if (chunk.embedding_model && chunk.embedding_model !== "local-hash-v1") {
            entry.embedding_model = chunk.embedding_model;
          }
          grouped.set(type, entry);
        }
        return { rows: Array.from(grouped.values()) };
      }

      if (norm.includes("source_type=$2") && norm.includes("source_id=$3")) {
        const chunks = await db.collection("rag_chunks").find(
          { user_id: userId, source_type: values[1], source_id: String(values[2]) },
          opts
        ).sort({ chunk_index: 1 }).toArray();
        return { rows: chunks };
      }

      const chunks = await db.collection("rag_chunks").find({ user_id: userId }, opts).sort({ updated_at: -1 }).limit(400).toArray();
      return { rows: chunks };
    }

    // Generic fallback for unhandled queries
    logWarning("Unhandled MongoDB SQL query:", {
      sql: sqlText ? sqlText.slice(0, 200) : "",
      normalized: norm.slice(0, 200),
      valuesCount: values ? values.length : 0,
    });
    return { rows: [] };
  } catch (error) {
    logError("MongoDB query error", error, {
      sql: sqlText ? sqlText.slice(0, 200) : "",
      normalized: norm.slice(0, 200),
    });
    throw error;
  }
}

export async function executeMongoQuery(sqlText, values = [], session = null) {
  const norm = normalizeSql(sqlText);
  const opts = session ? { session } : {};

  // 1. Transaction control commands (handled at session level)
  if (norm === "BEGIN" || norm === "COMMIT" || norm === "ROLLBACK") {
    return { rows: [] };
  }

  const { collection, action } = inferCollectionAndAction(norm);
  const startTime = Date.now();

  try {
    const result = await _executeMongoQueryInner(norm, sqlText, values, opts);
    const durationMs = Date.now() - startTime;
    logger.logMongoQuery({
      collection,
      action,
      durationMs,
      rowCount: result?.rows?.length ?? 0,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.logMongoError({
      collection,
      action,
      durationMs,
      error,
      query: sqlText,
      params: values,
    });
    throw error;
  }
}
