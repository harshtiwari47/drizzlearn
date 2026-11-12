import crypto from "node:crypto";
import { query } from "./db.js";
import { logger } from "./logger.js";
import { aiError, executeWithModelFailover, getCandidates, providerDisplayName } from "./model-manager.js";
import { indexCourseMaterialsRag } from "./rag-service.js";

/**
 * Get status of materials generation for a course.
 */
export async function getCourseMaterialsStatus(userId, courseId, options = {}) {
  const queryFn = options.queryFn || query;
  try {
    const jobResult = await queryFn(
      `SELECT * FROM ai_jobs WHERE user_id=$1 AND job_type='course_materials_generation' ORDER BY created_at DESC LIMIT 10`,
      [userId]
    );

    const match = (jobResult.rows || []).find((row) => {
      const ref = typeof row.input_ref === "string" ? JSON.parse(row.input_ref) : (row.input_ref || {});
      return ref.courseId === courseId;
    });

    if (match) {
      return {
        status: match.status || "none",
        job: {
          id: match.id,
          status: match.status,
          errorCode: match.error_code || null,
          outputRef: typeof match.output_ref === "string" ? JSON.parse(match.output_ref) : (match.output_ref || null),
          createdAt: match.created_at,
          finishedAt: match.finished_at || null,
        },
      };
    }

    // Check if materials already exist directly
    const notesCount = await queryFn(
      `SELECT COUNT(*)::int AS count FROM notes WHERE user_id=$1 AND course_id=$2 AND origin='ai_draft'`,
      [userId, courseId]
    );
    const count = Number(notesCount.rows?.[0]?.count) || 0;
    if (count > 0) {
      return { status: "succeeded", job: null, count };
    }

    return { status: "none", job: null };
  } catch (error) {
    logger.warn(`Failed to query materials status for course ${courseId}: ${error?.message || error}`, "drizzlearn:materials");
    return { status: "none", job: null };
  }
}

/**
 * Generate rich study materials for an approved course:
 * 1. Roadmap Note in `notes` (title: `${course.title} - Learning Roadmap`, origin: 'ai_draft')
 * 2. Milestone study tasks in `study_tasks` (task_type: 'project')
 * 3. Structured study notes for lessons in `notes` (origin: 'ai_draft')
 * 4. Spaced repetition flashcards in `flashcards` (due_at: NOW())
 * 5. Practice tasks in `study_tasks` (task_type: 'practice') and rich checkpoints/worked examples
 *
 * All tracked in `ai_jobs` ('course_materials_generation').
 */
export async function generateCourseMaterials(userId, courseId, options = {}) {
  const queryFn = options.queryFn || query;
  const jobId = crypto.randomUUID();
  let jobStarted = false;

  try {
    // 1. Fetch course details and goal
    const courseRes = await queryFn(
      `SELECT c.*, g.topic, g.desired_outcome, g.current_level, g.weekly_minutes, g.target_weeks
       FROM courses c JOIN learning_goals g ON g.id=c.goal_id
       WHERE c.id=$1 AND c.user_id=$2`,
      [courseId, userId]
    );
    const course = courseRes.rows?.[0];
    if (!course) {
      logger.warn(`Course ${courseId} not found for user ${userId}; skipping materials generation`, "drizzlearn:materials");
      return { success: false, reason: "COURSE_NOT_FOUND" };
    }

    // 2. Fetch modules and lessons
    const moduleRes = await queryFn(
      `SELECT * FROM course_modules WHERE course_id=$1 ORDER BY position`,
      [courseId]
    );
    const modules = moduleRes.rows || [];

    const lessonRes = await queryFn(
      `SELECT * FROM lessons WHERE course_id=$1 ORDER BY position`,
      [courseId]
    );
    const modulePosMap = new Map(modules.map((m, idx) => [m.id, Number(m.position) || idx + 1]));
    const lessons = [...(lessonRes.rows || [])].sort((a, b) => {
      const modDiff =
        (modulePosMap.get(a.module_id) ?? Number.MAX_SAFE_INTEGER) -
        (modulePosMap.get(b.module_id) ?? Number.MAX_SAFE_INTEGER);
      if (modDiff !== 0) return modDiff;
      return (Number(a.position) || 0) - (Number(b.position) || 0);
    });

    // 3. Track job execution in `ai_jobs`
    await queryFn(
      `INSERT INTO ai_jobs(id, user_id, job_type, status, input_ref, created_at)
       VALUES($1, $2, 'course_materials_generation', 'running', $3, NOW())`,
      [
        jobId,
        userId,
        JSON.stringify({
          courseId,
          courseTitle: course.title,
          lessonCount: lessons.length,
          moduleCount: modules.length,
        }),
      ]
    );
    jobStarted = true;

    // 4. Try AI generation via model manager failover if configured, otherwise fallback to rule-based generation
    const candidates = getCandidates();
    let aiResult = null;
    let generationMode = "rule_based";

    if (candidates.length > 0 && !options.skipAi) {
      try {
        aiResult = await tryAiMaterialsGeneration(candidates, course, modules, lessons);
        if (aiResult?.success) {
          generationMode = `ai_${aiResult.provider}`;
        }
      } catch (aiErr) {
        logger.warn(`AI model generation failed, falling back to rule-based generation: ${aiErr?.message || aiErr}`, "drizzlearn:materials");
      }
    }

    // 5. Build material artifacts (AI or rule-based fallback)
    const materials = buildCourseMaterials(course, modules, lessons, aiResult?.data);

    // 6. Persist Roadmap Note (strictly idempotent: only 1 AI-generated roadmap note per course)
    let roadmapCreated = false;
    const existingRoadmap = await queryFn(
      `SELECT id FROM notes WHERE user_id=$1 AND course_id=$2 AND origin='ai_draft' AND lesson_id IS NULL`,
      [userId, courseId]
    );
    if (!existingRoadmap.rows?.length) {
      const roadmapId = crypto.randomUUID();
      await queryFn(
        `INSERT INTO notes(id, user_id, course_id, lesson_id, title, body, origin, source_ref, created_at, updated_at)
         VALUES($1, $2, $3, NULL, $4, $5, 'ai_draft', $6, NOW(), NOW())`,
        [
          roadmapId,
          userId,
          courseId,
          `${course.title} - Learning Roadmap`,
          materials.roadmapMarkdown,
          `course:${courseId}`,
        ]
      );
      roadmapCreated = true;
    }

    // 7. Persist Milestone Study Tasks (task_type: 'project')
    let milestonesCreated = 0;
    const targetWeeks = Math.max(1, Number(course.target_weeks) || 4);
    const existingTasks = await queryFn(
      `SELECT id, lesson_id, task_type, title, scheduled_at FROM study_tasks WHERE user_id=$1 AND course_id=$2`,
      [userId, courseId]
    );
    const existingTasksList = existingTasks.rows || [];

    for (const [modIndex, mod] of modules.entries()) {
      const milestoneTitle = `Milestone: ${mod.title}`;
      const alreadyScheduled = existingTasksList.some(
        (t) => t.task_type === "project" && t.title === milestoneTitle
      );
      if (!alreadyScheduled) {
        // Find latest scheduled lesson in this module to place milestone right after
        const modLessons = lessons.filter((l) => l.module_id === mod.id);
        const modLessonIds = new Set(modLessons.map((l) => l.id));
        const modLessonTasks = existingTasksList.filter(
          (t) => t.lesson_id && modLessonIds.has(t.lesson_id) && t.scheduled_at
        );

        let milestoneDate;
        if (modLessonTasks.length > 0) {
          const sorted = modLessonTasks.sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));
          milestoneDate = new Date(sorted[0].scheduled_at);
          milestoneDate.setDate(milestoneDate.getDate() + 2); // 2 days after last lesson of module
        } else {
          milestoneDate = new Date();
          const weekOffset = Math.ceil(((modIndex + 1) / Math.max(1, modules.length)) * targetWeeks);
          milestoneDate.setDate(milestoneDate.getDate() + weekOffset * 7);
          milestoneDate.setHours(18, 0, 0, 0);
        }

        const taskId = crypto.randomUUID();
        await queryFn(
          `INSERT INTO study_tasks(id, user_id, course_id, lesson_id, task_type, title, scheduled_at, status, estimated_minutes, created_at)
           VALUES($1, $2, $3, NULL, 'project', $4, $5, 'upcoming', 45, NOW())`,
          [taskId, userId, courseId, milestoneTitle, milestoneDate.toISOString()]
        );
        milestonesCreated++;
      }
    }

    // 8. Persist Lesson Notes, Flashcards, Practice Tasks, and Ensure Rich Checkpoints/Examples
    let notesCreated = 0;
    let flashcardsCreated = 0;
    let practiceCreated = 0;

    for (const lesson of lessons) {
      // 8a. Structured Lesson Notes (strictly idempotent: only 1 AI-drafted note per topic/lesson)
      const existingLessonNote = await queryFn(
        `SELECT id FROM notes WHERE user_id=$1 AND course_id=$2 AND lesson_id=$3 AND origin='ai_draft'`,
        [userId, courseId, lesson.id]
      );
      if (!existingLessonNote.rows?.length) {
        const noteId = crypto.randomUUID();
        const lessonNoteContent = materials.notesByLessonId[lesson.id] || buildLessonNoteMarkdown(lesson, course);
        await queryFn(
          `INSERT INTO notes(id, user_id, course_id, lesson_id, title, body, origin, source_ref, created_at, updated_at)
           VALUES($1, $2, $3, $4, $5, $6, 'ai_draft', $7, NOW(), NOW())`,
          [
            noteId,
            userId,
            courseId,
            lesson.id,
            `Study Notes: ${lesson.title}`,
            lessonNoteContent,
            `lesson:${lesson.id}`,
          ]
        );
        notesCreated++;
      }

      // 8b. Flashcards
      const lessonCards = materials.flashcardsByLessonId[lesson.id] || buildLessonFlashcards(lesson);
      for (const card of lessonCards) {
        const existingCard = await queryFn(
          `SELECT id FROM flashcards WHERE user_id=$1 AND course_id=$2 AND lesson_id=$3 AND front=$4`,
          [userId, courseId, lesson.id, card.front]
        );
        if (!existingCard.rows?.length) {
          const cardId = crypto.randomUUID();
          await queryFn(
            `INSERT INTO flashcards(id, user_id, course_id, lesson_id, front, back, due_at, interval_days, ease, repetitions, created_at)
             VALUES($1, $2, $3, $4, $5, $6, NOW(), 0, 2.50, 0, NOW())`,
            [cardId, userId, courseId, lesson.id, card.front, card.back]
          );
          flashcardsCreated++;
        }
      }

      // 8c. Ensure rich checkpoint and worked example on lesson
      const enrichment = materials.enrichmentsByLessonId[lesson.id];
      const needsExample = !lesson.worked_example || String(lesson.worked_example).trim().length < 20;
      const parsedCheckpoint = typeof lesson.checkpoint === "string" ? JSON.parse(lesson.checkpoint || "{}") : (lesson.checkpoint || {});
      const needsCheckpoint = !parsedCheckpoint.question || !Array.isArray(parsedCheckpoint.options) || parsedCheckpoint.options.length < 2;

      if (needsExample || needsCheckpoint) {
        const finalWorkedExample = needsExample
          ? (enrichment?.workedExample || buildWorkedExample(lesson))
          : lesson.worked_example;
        const finalCheckpoint = needsCheckpoint
          ? (enrichment?.checkpoint || buildRichCheckpoint(lesson))
          : parsedCheckpoint;

        await queryFn(
          `UPDATE lessons SET worked_example=$1, checkpoint=$2 WHERE id=$3`,
          [finalWorkedExample, JSON.stringify(finalCheckpoint), lesson.id]
        );
      }

      // 8d. Practice Tasks in `study_tasks` (task_type: 'practice')
      const practiceTitle = `Practice: ${lesson.title}`;
      const existingPractice = existingTasksList.some(
        (t) => t.task_type === "practice" && t.lesson_id === lesson.id
      );
      if (!existingPractice) {
        // Schedule alongside lesson
        const lessonTask = existingTasksList.find((t) => t.lesson_id === lesson.id && t.task_type === "lesson");
        let practiceScheduledAt;
        if (lessonTask?.scheduled_at) {
          const d = new Date(lessonTask.scheduled_at);
          d.setMinutes(d.getMinutes() + (Number(lesson.estimated_minutes) || 25));
          practiceScheduledAt = d.toISOString();
        } else {
          const d = new Date();
          d.setHours(19, 0, 0, 0);
          practiceScheduledAt = d.toISOString();
        }

        const taskId = crypto.randomUUID();
        await queryFn(
          `INSERT INTO study_tasks(id, user_id, course_id, lesson_id, task_type, title, scheduled_at, status, estimated_minutes, created_at)
           VALUES($1, $2, $3, $4, 'practice', $5, $6, 'upcoming', 15, NOW())`,
          [taskId, userId, courseId, lesson.id, practiceTitle, practiceScheduledAt]
        );
        practiceCreated++;
      }
    }

    // 9. Update `ai_jobs` to 'succeeded'
    const outputSummary = {
      roadmapCreated,
      notesCreated,
      flashcardsCreated,
      practiceCreated,
      milestonesCreated,
      generationMode,
      ...(aiResult?.model ? { modelUsed: aiResult.model, failoverCount: aiResult.failoverCount || 0 } : {}),
      completedAt: new Date().toISOString(),
    };

    await queryFn(
      `UPDATE ai_jobs SET status='succeeded', output_ref=$1, error_code=NULL, finished_at=NOW() WHERE id=$2`,
      [JSON.stringify(outputSummary), jobId]
    );

    // 10. Best-effort RAG indexing of newly generated course materials
    try {
      await indexCourseMaterialsRag(userId, courseId, { queryFn });
    } catch (ragErr) {
      logger.warn(`Best-effort RAG indexing skipped for course ${courseId}: ${ragErr?.message || ragErr}`, "drizzlearn:materials");
    }

    logger.info(`Course materials generation succeeded for course ${courseId} (${generationMode})`, "drizzlearn:materials", outputSummary);
    return { success: true, ...outputSummary };
  } catch (error) {
    logger.error(`Course materials generation encountered error for course ${courseId}: ${error?.message || error}`, "drizzlearn:materials", {
      courseId,
      userId,
      error: error?.message,
    });

    if (jobStarted) {
      try {
        await queryFn(
          `UPDATE ai_jobs SET status='failed', error_code=$1, finished_at=NOW() WHERE id=$2`,
          [error?.code || error?.message || "MATERIALS_GEN_ERROR", jobId]
        );
      } catch (jobUpdateErr) {
        logger.error(`Failed to update ai_jobs status to failed: ${jobUpdateErr?.message || jobUpdateErr}`, "drizzlearn:materials");
      }
    }

    // Crucial resilience contract: Do not throw or let background failure affect course approval
    return { success: false, error: error?.message || "MATERIALS_GEN_ERROR" };
  }
}

/**
 * Invoke configured AI model pool with automatic traffic failover to generate rich course materials.
 */
async function tryAiMaterialsGeneration(candidates, course, modules, lessons) {
  const context = {
    course: {
      title: course.title,
      summary: course.summary,
      topic: course.topic,
      outcome: course.desired_outcome,
      durationWeeks: course.target_weeks || 4,
      weeklyMinutes: course.weekly_minutes || 360,
    },
    modules: modules.map((m) => ({
      position: m.position,
      title: m.title,
      objective: m.objective,
    })),
    lessons: lessons.map((l) => ({
      id: l.id,
      modulePosition: l.module_id,
      position: l.position,
      title: l.title,
      objective: l.objective,
    })),
  };

  const systemPrompt = `You are the Lead Curriculum Specialist for Drizzlearn.
Generate comprehensive study materials for the provided course in strict JSON format.
Always strictly match the academic discipline, tone, and subject matter of the course (for example, if the course is about English language, grammar, or communication, all concepts, step-by-step reasoning, worked examples, and checkpoints must focus on natural language usage; do NOT generate computer programming code or software engineering analogies unless the course is explicitly about computer programming).
Return a single JSON object with this exact shape:
{
  "roadmap": {
    "keyCompetencies": ["string"],
    "pacingStrategy": "string",
    "milestonePhases": [
      { "modulePosition": 1, "phaseTitle": "string", "deliverable": "string", "focusNotes": "string" }
    ]
  },
  "lessons": [
    {
      "lessonId": "string",
      "coreConcepts": "string",
      "stepByStepReasoning": "string",
      "practicalTakeaways": "string",
      "flashcards": [
        { "front": "string", "back": "string" }
      ],
      "workedExample": "string",
      "checkpoint": {
        "question": "string",
        "options": ["string", "string", "string", "string"],
        "answerIndex": 0,
        "explanation": "string"
      }
    }
  ]
}`;

  const deadline = Date.now() + 45_000;
  const failoverRes = await executeWithModelFailover({
    stageName: "materials_generation",
    candidates,
    deadline,
    perAttemptTimeoutMs: 22_000,
    executeFn: async (candidate, timeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
      const useJsonFormat = candidate.supportsJsonFormat !== false;
      const finalPrompt = useJsonFormat
        ? systemPrompt
        : `${systemPrompt}\nReturn ONLY a valid raw JSON object without markdown code fences or commentary.`;
      const providerLabel = providerDisplayName(candidate.name);

      try {
        const response = await fetch(`${candidate.baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${candidate.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: candidate.model,
            messages: [
              { role: "system", content: finalPrompt },
              { role: "user", content: JSON.stringify(context) },
            ],
            ...(useJsonFormat ? { response_format: { type: "json_object" } } : {}),
            max_tokens: 4000,
            temperature: 0.25,
          }),
        });

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            throw aiError("AI_PROVIDER_AUTH", `${providerLabel} rejected credentials during materials generation.`, {
              status: response.status,
            });
          }
          if (response.status === 429) {
            throw aiError("AI_RATE_LIMIT", `${providerLabel} rate limited materials generation.`, {
              retryable: true,
              status: 429,
            });
          }
          throw aiError("AI_PROVIDER_ERROR", `${providerLabel} returned HTTP ${response.status} during materials generation.`, {
            retryable: response.status >= 500 || response.status === 404 || response.status === 408,
            status: response.status,
          });
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          throw aiError("AI_PROVIDER_RESPONSE", `${providerLabel} returned unreadable JSON payload.`, { retryable: true });
        }

        const rawText = payload?.choices?.[0]?.message?.content;
        if (typeof rawText !== "string" || !rawText.trim()) {
          throw aiError("AI_EMPTY_RESPONSE", `${providerLabel} returned an empty response.`, { retryable: true });
        }

        const normalized = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const first = normalized.indexOf("{");
        const last = normalized.lastIndexOf("}");
        if (first < 0 || last < first) {
          throw aiError("AI_INVALID_JSON", `${providerLabel} returned non-JSON materials output.`, { retryable: true });
        }

        let parsed;
        try {
          parsed = JSON.parse(normalized.slice(first, last + 1));
        } catch {
          throw aiError("AI_INVALID_JSON", `${providerLabel} returned invalid JSON materials output.`, { retryable: true });
        }
        if (!parsed || typeof parsed !== "object") {
          throw aiError("AI_INVALID_JSON", `${providerLabel} returned malformed materials object.`, { retryable: true });
        }
        return parsed;
      } catch (err) {
        if (String(err?.code || "").startsWith("AI_")) throw err;
        const isTimeout = err?.name === "AbortError" || err?.name === "TimeoutError" || controller.signal.aborted;
        throw aiError(
          isTimeout ? "AI_TIMEOUT" : "AI_NETWORK_ERROR",
          isTimeout ? `${providerLabel} timed out during materials generation.` : `${providerLabel} network error during materials generation.`,
          { retryable: !isTimeout }
        );
      } finally {
        clearTimeout(timer);
      }
    },
  });

  return {
    success: true,
    data: failoverRes.result,
    provider: failoverRes.provider,
    model: failoverRes.model,
    failoverCount: failoverRes.failoverCount,
  };
}

/**
 * Builds rich course materials using AI output if present, or deterministic rule-based synthesis.
 */
function buildCourseMaterials(course, modules, lessons, aiData = null) {
  const targetWeeks = Math.max(1, Number(course.target_weeks) || 4);
  const weeklyMinutes = Number(course.weekly_minutes) || 360;

  // 1. Compose Roadmap Markdown
  let roadmapMarkdown = "";
  if (aiData?.roadmap) {
    const rm = aiData.roadmap;
    roadmapMarkdown = `# 🗺️ ${course.title} — Learning Roadmap

## Course Objective & Target Outcome
${course.summary || course.desired_outcome || "Master key competencies through structured progression."}

- **Target Duration:** ${targetWeeks} weeks
- **Weekly Commitment:** ${weeklyMinutes} minutes/week (~${Math.round(weeklyMinutes / 60)} hrs/week)
- **Learner Level:** ${course.current_level || "Beginner to Intermediate"}
- **Total Modules:** ${modules.length}
- **Total Lessons:** ${lessons.length}

---

## 🎯 Key Competencies
${(rm.keyCompetencies || []).map((c, i) => `${i + 1}. **${c}**`).join("\n")}

---

## 📅 Milestone Phases & Pacing
${(rm.milestonePhases || []).map((p, idx) => `
### Phase ${p.modulePosition || idx + 1}: ${p.phaseTitle || `Module ${idx + 1}`}
- **Milestone Deliverable:** ${p.deliverable || "Applied synthesis project"}
- **Focus & Pacing:** ${p.focusNotes || `Target completion within ${Math.max(1, Math.round(targetWeeks / modules.length))} week(s).`}
`).join("\n")}

---

## 🚀 Recommended Study Rhythm & Pacing Strategy
${rm.pacingStrategy || "- Dedicate 2-3 focused study blocks weekly.\n- Complete spaced repetition flashcards daily before learning new material.\n- Validate understanding with each lesson checkpoint."}
`;
  } else {
    // Deterministic Rule-Based Roadmap
    roadmapMarkdown = `# 🗺️ ${course.title} — Learning Roadmap

## Course Objective & Terminal Outcome
${course.summary || course.desired_outcome || `Master all practical principles and application patterns of ${course.title}.`}

- **Target Duration:** ${targetWeeks} weeks
- **Weekly Commitment:** ${weeklyMinutes} minutes/week (~${Math.max(1, Math.round(weeklyMinutes / 60))} hours)
- **Learner Level:** ${course.current_level || "Beginner to Intermediate"}
- **Total Modules:** ${modules.length} modules
- **Total Lessons:** ${lessons.length} lessons

---

## 🎯 Key Competencies & Transfer Goals
1. **Conceptual Fluency:** Deeply understand core invariants, terminology, and foundational mental models.
2. **Applied Problem Solving:** Analyze domain challenges, apply step-by-step reasoning, and verify edge conditions.
3. **Independent Execution:** Synthesize multi-lesson concepts to design, implement, and validate milestone projects.

---

## 📅 Milestone Phases & Estimated Pacing
${modules.map((m, idx) => {
  const modLessons = lessons.filter((l) => l.module_id === m.id);
  const phasePacingWeeks = Math.max(1, Math.round(targetWeeks / modules.length));
  return `### Phase ${m.position || idx + 1}: ${m.title}
- **Objective:** ${m.objective}
- **Rationale:** ${m.rationale || `Develop foundational understanding and practical execution for Phase ${idx + 1}.`}
- **Estimated Pacing:** Week ${idx * phasePacingWeeks + 1}${phasePacingWeeks > 1 ? ` - Week ${(idx + 1) * phasePacingWeeks}` : ""} (~${m.estimated_minutes || 60} mins total)
- **Included Lessons:**
${modLessons.map((l) => `  - **Lesson ${l.position}:** ${l.title} (*${l.estimated_minutes || 25}m*)`).join("\n") || "  - Foundations and core principles"}
- **Phase Milestone Project:** Milestone Project ${idx + 1} — Synthesize and demonstrate mastery of ${m.title}.`;
}).join("\n\n")}

---

## 🚀 Recommended Study Rhythm & Active Practice Guidelines
- **Rhythm Over Cramming:** Protect 2 to 3 consistent study sessions each week.
- **Active Recall:** Review spaced repetition flashcards daily to cement concepts into permanent memory.
- **Checkpoint Evidence:** Pass each lesson practice checkpoint before moving forward to ensure verified progress.
`;
  }

  // 2. Map AI lesson data if available
  const notesByLessonId = {};
  const flashcardsByLessonId = {};
  const enrichmentsByLessonId = {};

  if (Array.isArray(aiData?.lessons)) {
    for (const aiLesson of aiData.lessons) {
      const lesson = lessons.find((l) => l.id === aiLesson.lessonId || l.title === aiLesson.title);
      if (!lesson) continue;

      notesByLessonId[lesson.id] = `# 📝 Study Notes: ${lesson.title}

## 🎯 Core Concepts & Intuitive Mental Model
**Objective:** ${lesson.objective}

${aiLesson.coreConcepts || lesson.content_markdown || "Grasp foundational concepts and mental models."}

---

## 🛠️ Step-by-Step Reasoning & Worked Application
${aiLesson.stepByStepReasoning || lesson.worked_example || "1. Analyze problem requirements.\n2. Execute structured steps.\n3. Verify edge cases."}

---

## 💡 Practical Takeaways & Anti-Patterns to Avoid
${aiLesson.practicalTakeaways || "- Avoid skipping prerequisite checks.\n- Verify assumptions with unit evidence."}
`;

      if (Array.isArray(aiLesson.flashcards) && aiLesson.flashcards.length > 0) {
        flashcardsByLessonId[lesson.id] = aiLesson.flashcards.map((c) => ({
          front: String(c.front || "").trim(),
          back: String(c.back || "").trim(),
        })).filter((c) => c.front && c.back);
      }

      enrichmentsByLessonId[lesson.id] = {
        workedExample: aiLesson.workedExample,
        checkpoint: aiLesson.checkpoint,
      };
    }
  }

  return {
    roadmapMarkdown,
    notesByLessonId,
    flashcardsByLessonId,
    enrichmentsByLessonId,
  };
}

/**
 * Builds deterministic study notes in Markdown for a lesson.
 */
function buildLessonNoteMarkdown(lesson, course) {
  return `# 📝 Study Notes: ${lesson.title}

## 🎯 Core Concepts & Intuitive Mental Model
**Objective:** ${lesson.objective}

${lesson.content_markdown ? lesson.content_markdown : `Understand the core principles and architectural mechanisms underlying **${lesson.title}**. Focus on how inputs are transformed into outputs and how state transitions occur reliably.`}

---

## 🛠️ Step-by-Step Reasoning & Worked Application
${lesson.worked_example ? `### Practical Worked Example\n${lesson.worked_example}` : `### Step-by-Step Implementation Framework
1. **Define the Context:** Clarify the problem constraints, expected inputs, and target deliverables.
2. **Execute Core Steps:** Apply the verified pattern for ${lesson.title} sequentially.
3. **Verify & Validate:** Run regression tests and confirm behavior across edge cases.`}

---

## 💡 Practical Takeaways & Anti-Patterns
- **Key Takeaway:** Always articulate the underlying "why" behind each decision before executing implementation details.
- **Common Anti-Pattern:** Premature optimization without verifying fundamental correctness or edge-case handling.
- **Next Steps:** Review flashcards and attempt the practice checkpoint to lock in learning evidence.
`;
}

/**
 * Builds deterministic spaced-repetition flashcards for a lesson.
 */
function buildLessonFlashcards(lesson) {
  const cards = [];

  // Card 1: Core Objective / Concept
  cards.push({
    front: `What is the primary objective and core focus of "${lesson.title}"?`,
    back: `${lesson.objective}\n\nKey Takeaway: Master foundational intuition and systematic application.`,
  });

  // Card 2: Checkpoint-derived or application card
  let checkpoint = null;
  try {
    checkpoint = typeof lesson.checkpoint === "string" ? JSON.parse(lesson.checkpoint) : lesson.checkpoint;
  } catch {}

  if (checkpoint?.question && Array.isArray(checkpoint.options) && checkpoint.answerIndex !== undefined) {
    const correctOption = checkpoint.options[Number(checkpoint.answerIndex)] || checkpoint.options[0];
    cards.push({
      front: `[${lesson.title}] ${checkpoint.question}`,
      back: `Correct Answer: ${correctOption}\n\nExplanation: ${checkpoint.explanation || "Demonstrates core conceptual mastery."}`,
    });
  } else {
    cards.push({
      front: `When implementing solutions in "${lesson.title}", what step-by-step strategy is recommended?`,
      back: `1. Formulate problem constraints.\n2. Apply the core patterns methodically.\n3. Verify edge cases and validate output.`,
    });
  }

  // Card 3: Anti-pattern / Key Reasoning
  cards.push({
    front: `What is a critical common pitfall or anti-pattern to avoid in "${lesson.title}"?`,
    back: `Skipping prerequisite validation or executing without checking boundary constraints. Always establish clear mental models and verify invariants first.`,
  });

  return cards;
}

/**
 * Builds a deterministic worked example for a lesson if missing.
 */
function buildWorkedExample(lesson) {
  return `Concrete Worked Example for ${lesson.title}:
1. Context & Setup: Define the baseline environment and specify input invariants.
2. Step 1: Establish preconditions and validate input parameters.
3. Step 2: Execute the core transformation logic for ${lesson.title}.
4. Step 3: Verify the output against expected success criteria and handle edge cases gracefully.
Rationale: Following systematic, testable increments ensures correctness and simplifies error recovery.`;
}

/**
 * Builds a deterministic rich checkpoint for a lesson if missing.
 */
function buildRichCheckpoint(lesson) {
  return {
    question: `When applying the concepts of "${lesson.title}", which approach ensures the most reliable outcome?`,
    options: [
      `Structure the solution step-by-step, validating preconditions and edge cases`,
      `Bypass initial input verification to prioritize immediate execution speed`,
      `Hardcode values without establishing a sound mental model or rationale`,
      `Proceed without validating boundary conditions or checking errors`,
    ],
    answerIndex: 0,
    explanation: `A structured step-by-step methodology with rigorous precondition and edge-case verification ensures correctness, maintainability, and deep conceptual understanding.`,
  };
}
