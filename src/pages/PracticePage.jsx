import React, { useState, useMemo, useDeferredValue, useEffect, useCallback, useRef } from "react";
import { Icon, Panel, EmptyState, prettyDate, collectAllCourseLessons } from "../components/common.jsx";
import { buildPracticeSetKey, listLessonPracticeModes, loadPracticeSet, savePracticeSet } from "../practice-db.js";
import { recordBehavior } from "../behavior-tracking.js";
import { PracticeStudioRunner } from "../practice-exercises.jsx";

const PRACTICE_MODES = [
  {
    id: "checkpoint",
    label: "Topic Checkpoint",
    tagline: "Core Mastery Evaluation",
    hint: "Formal lesson understanding check. Prove conceptual mastery with rubric grading.",
    accent: "emerald",
    badgeText: "Required Evidence",
    features: ["Rubric Graded", "Instant Feedback", "Progress Unlocked"],
    previewType: "checkpoint",
  },
  {
    id: "quiz",
    label: "Quiz",
    tagline: "Active Multiple Choice",
    hint: "Timed multiple-choice drills with code snippets, hints, and explanatory feedback.",
    accent: "violet",
    badgeText: "Active Recall",
    features: ["3 Applied Questions", "Context Snippets", "Hint Guidance"],
    previewType: "quiz",
  },
  {
    id: "fill_blank",
    label: "Fill in the Blanks",
    tagline: "Cloze Sentence Synthesis",
    hint: "Reconstruct core syntax and logic using interactive contextual word bank chips.",
    accent: "cyan",
    badgeText: "Contextual Recall",
    features: ["Interactive Word Bank", "Drag & Tap Chips", "Syntax Drills"],
    previewType: "cloze",
  },
  {
    id: "order",
    label: "Correct Order",
    tagline: "Process & Logic Sequencing",
    hint: "Arrange workflow steps, execution lifecycles, and architectural layers sequentially.",
    accent: "amber",
    badgeText: "Process Logic",
    features: ["Step Rearrangement", "Logic Timelines", "Flow Checks"],
    previewType: "order",
  },
  {
    id: "word_scramble",
    label: "Word Builder",
    tagline: "Terminology & Anagrams",
    hint: "Unscramble core lesson terminology, keyword tokens, and domain vocabulary.",
    accent: "rose",
    badgeText: "Keyword Recall",
    features: ["Letter Tile Rack", "Clue Discovery", "Vocabulary Lock"],
    previewType: "word",
  },
  {
    id: "mixed",
    label: "Quick Mix",
    tagline: "Adaptive 4-in-1 Sprint",
    hint: "Holistic power drill bundling 1 Quiz, 1 Cloze, 1 Order, and 1 Word Builder exercise.",
    accent: "lime",
    badgeText: "4-in-1 Daily Sprint",
    features: ["All Interactive Types", "Multi-Angle Recall", "Rapid Practice"],
    previewType: "mix",
  },
];

function ModeIcon({ type, size = 20 }) {
  if (type === "checkpoint") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="6" r="2" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    );
  }
  if (type === "quiz") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  if (type === "fill_blank") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
      </svg>
    );
  }
  if (type === "order") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
        <polyline points="17 14 12 9 7 14" />
        <line x1="12" y1="9" x2="12" y2="21" />
      </svg>
    );
  }
  if (type === "word_scramble") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="8" height="8" rx="1.5" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" />
      </svg>
    );
  }
  // mixed
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function PracticePage(p) {
  const allCourses = useMemo(
    () => (p.data?.courses || []).filter((c) => c.modules?.some((m) => m.lessons?.length)),
    [p.data?.courses]
  );
  const allLessons = useMemo(
    () => (p.allLessons?.length ? p.allLessons : collectAllCourseLessons(p.data?.courses, p.lessons, p.activeCourse)),
    [p.allLessons, p.data?.courses, p.lessons, p.activeCourse]
  );
  const [courseFilter, setCourseFilter] = useState(() => p.routeQuery?.get?.("course") || "all");
  const visibleLessons = useMemo(
    () => (courseFilter === "all" ? allLessons : allLessons.filter((l) => l.courseId === courseFilter)),
    [allLessons, courseFilter]
  );

  const [lessonId, setLessonId] = useState(() => {
    const paramLessonId = p.routeParams?.lessonId;
    if (paramLessonId && allLessons.some((l) => l.id === paramLessonId)) return paramLessonId;
    const initialList = courseFilter === "all" ? allLessons : allLessons.filter((l) => l.courseId === courseFilter);
    return initialList.find((l) => l.id === p.activeLesson?.id)?.id || initialList[0]?.id || "";
  });

  // activeTab can be "overview" (Aesthetic Bento Hub) or any mode ID: "checkpoint", "quiz", "fill_blank", "order", "word_scramble", "mixed"
  const [activeTab, setActiveTab] = useState(() => {
    const qMode = p.routeQuery?.get?.("mode");
    if (qMode && PRACTICE_MODES.some((m) => m.id === qMode)) return qMode;
    return "overview";
  });

  const [mode, setMode] = useState(() => {
    const qMode = p.routeQuery?.get?.("mode");
    if (qMode && PRACTICE_MODES.some((m) => m.id === qMode)) return qMode;
    return "mixed";
  });

  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [studioSet, setStudioSet] = useState(null);
  const [studioStatus, setStudioStatus] = useState({ kind: "idle", message: "" });
  const [cachedModes, setCachedModes] = useState([]);
  const [generatingKey, setGeneratingKey] = useState(null);
  const generatingKeyRef = useRef(null);

  useEffect(() => {
    const paramLessonId = p.routeParams?.lessonId;
    if (paramLessonId && allLessons.some((l) => l.id === paramLessonId)) {
      const target = allLessons.find((l) => l.id === paramLessonId);
      if (courseFilter !== "all" && target?.courseId && target.courseId !== courseFilter) {
        setCourseFilter(target.courseId);
      }
      if (paramLessonId !== lessonId) {
        setLessonId(paramLessonId);
        setResult(null);
      }
      return;
    }
    if ((!lessonId || !visibleLessons.some((l) => l.id === lessonId)) && visibleLessons[0]?.id) {
      setLessonId(visibleLessons[0].id);
    }
  }, [lessonId, allLessons, visibleLessons, courseFilter, p.routeParams?.lessonId]);

  const userId = p.user?.id || "anon";
  const lesson = allLessons.find((l) => l.id === lessonId);
  const checkpoint = lesson?.checkpoint;
  const activeModeMeta = PRACTICE_MODES.find((m) => m.id === mode) || PRACTICE_MODES[5];
  const activeKey = lesson && mode !== "checkpoint" ? buildPracticeSetKey(userId, lesson.id, mode) : "";

  const refreshCachedModes = useCallback(async () => {
    if (!lesson?.id) {
      setCachedModes([]);
      return;
    }
    const list = await listLessonPracticeModes(userId, lesson.id);
    setCachedModes(list);
  }, [userId, lesson?.id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshCachedModes();
      if (!lesson || mode === "checkpoint") {
        if (!cancelled) {
          setStudioSet(null);
          setStudioStatus({ kind: "idle", message: "" });
        }
        return;
      }
      const key = buildPracticeSetKey(userId, lesson.id, mode);
      const cached = await loadPracticeSet(key);
      if (cancelled) return;
      if (generatingKeyRef.current === key) {
        setStudioStatus({
          kind: "loading",
          message: `Generating ${activeModeMeta.label} drills for ${lesson.title}…`,
        });
        return;
      }
      if (cached?.exercises?.length) {
        setStudioSet(cached);
        setStudioStatus({
          kind: "cached",
          message: `Loaded from cache — ${cached.exercises.length} interactive exercises ready.`,
        });
      } else {
        setStudioSet(null);
        setStudioStatus({
          kind: "idle",
          message: `Generate ${activeModeMeta.label} exercises to practice this topic.`,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, lesson?.id, mode, activeModeMeta.label, refreshCachedModes]);

  async function generateExercises(isRegenerate = false) {
    if (!lesson || mode === "checkpoint") return;
    if (!p.remote) {
      setStudioStatus({ kind: "error", message: "Sign in to generate AI practice exercises for this lesson." });
      return;
    }
    const targetKey = buildPracticeSetKey(userId, lesson.id, mode);
    if (generatingKeyRef.current) return;
    generatingKeyRef.current = targetKey;
    setGeneratingKey(targetKey);
    setStudioStatus({ kind: "loading", message: `Generating ${activeModeMeta.label} exercises with self-healing validation…` });

    const excludeQuestions =
      isRegenerate && Array.isArray(studioSet?.exercises)
        ? studioSet.exercises.map((ex) => ex.prompt).filter(Boolean)
        : [];

    try {
      const response = await p.request("practice/generate", {
        method: "POST",
        body: JSON.stringify({ lessonId: lesson.id, mode, excludeQuestions }),
      });
      const exercises = Array.isArray(response?.exercises) ? response.exercises : [];
      if (!exercises.length) {
        throw new Error("The AI did not return any valid practice exercises. Retry generation.");
      }
      const payload = {
        userId,
        lessonId: lesson.id,
        mode,
        lessonTitle: lesson.title,
        exercises,
        source: response.source || null,
        model: response.model || null,
        failoverCount: Number(response.failoverCount || 0),
        progress: { activeIndex: 0, resultsById: {}, statesById: {}, savedAttemptIds: {} },
      };
      await savePracticeSet(targetKey, payload);
      await refreshCachedModes();
      const latest = await loadPracticeSet(targetKey);
      if (buildPracticeSetKey(userId, lesson.id, mode) === targetKey) {
        setStudioSet(latest || payload);
        setStudioStatus({ kind: "loaded", message: `Drills ready — ${exercises.length} interactive challenges loaded.` });
      }
    } catch (error) {
      const msg = error?.message || "Could not generate practice exercises. Retry when ready.";
      setStudioStatus({ kind: "error", message: msg });
      p.flashToast(msg);
    } finally {
      generatingKeyRef.current = null;
      setGeneratingKey(null);
    }
  }

  async function handlePersistProgress(nextProgress) {
    if (!lesson || mode === "checkpoint" || !studioSet) return;
    const key = buildPracticeSetKey(userId, lesson.id, mode);
    const updated = { ...studioSet, userId, lessonId: lesson.id, mode, lessonTitle: lesson.title, progress: nextProgress };
    setStudioSet(updated);
    await savePracticeSet(key, updated);
    await refreshCachedModes();
  }

  async function handleRecordAttempt({ exercise, correct, score, answer: submittedAnswer, explanation }) {
    if (!lesson) return false;
    try {
      if (p.remote) {
        await p.request("practice", {
          method: "POST",
          body: JSON.stringify({
            lessonId: lesson.id,
            exerciseType: exercise.type,
            concept: lesson.title,
            prompt: exercise.prompt,
            answer: submittedAnswer || exercise.type,
            correct,
            score,
            explanation,
          }),
        });
      }
      p.updateData((d) => ({
        ...d,
        attempts: [
          {
            id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            lesson_id: lesson.id,
            concept: lesson.title,
            score,
            result: { exerciseType: exercise.type, correct, explanation },
            created_at: new Date().toISOString(),
          },
          ...d.attempts,
        ],
      }));
      recordBehavior("practice_drill", {
        lessonId: lesson.id,
        concept: lesson.title,
        score,
        passed: Boolean(correct),
        exerciseType: exercise.type,
      });
      return true;
    } catch (error) {
      p.flashToast(error?.message || "Could not save practice attempt.");
      return false;
    }
  }

  async function submitCheckpoint(index) {
    const value = checkpoint?.options?.[index] || answer;
    if (!value.trim()) return p.flashToast("Write or select an answer before submitting.");
    try {
      if (p.remote) {
        await p.request("practice", {
          method: "POST",
          body: JSON.stringify({
            lessonId,
            concept: lesson?.title,
            prompt: checkpoint?.question || lesson?.objective,
            answer: value,
            selectedIndex: index,
          }),
        });
      }
      const correct = checkpoint ? Number(index) === Number(checkpoint.answerIndex) : null;
      if (p.remote && correct) {
        const task = p.data.tasks.find((t) => t.lesson_id === lessonId && t.status !== "completed");
        if (task) {
          await p.request(`tasks/${task.id}/complete`, {
            method: "POST",
            body: JSON.stringify({ actualMinutes: task.estimated_minutes }),
          });
        }
      }
      setResult({
        correct,
        text:
          correct === null
            ? "Your response is saved as evidence. Ask the tutor to review your reasoning."
            : correct
            ? checkpoint.explanation || "Excellent! Your answer demonstrates complete conceptual mastery."
            : "Review the lesson and try again. Your attempt is preserved.",
      });
      p.updateData((d) => ({
        ...d,
        attempts: [
          {
            id: `a-${Date.now()}`,
            lesson_id: lessonId,
            concept: lesson?.title,
            score: correct === null ? null : correct ? 100 : 0,
            result: { exerciseType: "checkpoint", correct },
            created_at: new Date().toISOString(),
          },
          ...d.attempts,
        ],
        tasks: d.tasks.map((t) =>
          t.lesson_id === lessonId && correct ? { ...t, status: "completed", completed_at: new Date().toISOString() } : t
        ),
      }));
      recordBehavior("checkpoint_attempt", {
        lessonId,
        concept: lesson?.title,
        score: correct === null ? null : correct ? 100 : 0,
        passed: Boolean(correct),
      });
      if (p.remote) await p.refreshRemote();
    } catch (error) {
      p.flashToast(error.message);
    }
  }

  const cachedModeSet = useMemo(() => new Set(cachedModes.map((m) => m.mode)), [cachedModes]);
  const isGeneratingCurrent = Boolean(generatingKey && activeKey && generatingKey === activeKey);

  const scopedAttempts = useMemo(() => {
    const attempts = p.data?.attempts || [];
    if (courseFilter === "all") return attempts;
    const courseLessonIds = new Set(visibleLessons.map((l) => l.id));
    return attempts.filter((a) => a.course_id === courseFilter || (a.lesson_id && courseLessonIds.has(a.lesson_id)));
  }, [p.data?.attempts, courseFilter, visibleLessons]);

  const lessonGroups = useMemo(() => {
    const groups = [];
    const byKey = new Map();
    visibleLessons.forEach((item) => {
      const groupTitle =
        courseFilter === "all" && allCourses.length > 1 && item.courseTitle
          ? `${item.courseTitle}${item.moduleTitle ? ` · ${item.moduleTitle}` : ""}`
          : item.moduleTitle || "";
      if (!byKey.has(groupTitle)) {
        const bucket = [];
        byKey.set(groupTitle, bucket);
        groups.push([groupTitle, bucket]);
      }
      byKey.get(groupTitle).push(item);
    });
    return groups;
  }, [visibleLessons, courseFilter, allCourses.length]);

  const handleCourseFilterChange = (nextCourse) => {
    setCourseFilter(nextCourse);
    setResult(null);
    const nextVisible = nextCourse === "all" ? allLessons : allLessons.filter((l) => l.courseId === nextCourse);
    if (!nextVisible.some((l) => l.id === lessonId)) {
      setLessonId(nextVisible[0]?.id || "");
    }
  };

  const selectMode = (targetMode) => {
    setMode(targetMode);
    setActiveTab(targetMode);
    setResult(null);
  };

  return (
    <div className="practice-layout">
      {/* Main Practice Work Area (No outer panel! Sits directly on page!) */}
      <div className="practice-main-column flex flex-col gap-5">
        {/* Practice Studio Header */}
        <div className="practice-hero-header flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="practice-hero-icon">
              <Icon name="practice" size={24} />
            </div>
            <div>
              <h1 className="practice-hero-title">Practice Studio</h1>
              <p className="practice-hero-subtitle">Interactive drills, active recall, and conceptual understanding</p>
            </div>
          </div>
          <span className="practice-header-badge">Interactive Drills & Mastery</span>
        </div>

        {/* Topic Selectors */}
        <div className={`practice-selectors-bar grid gap-3.5 ${allCourses.length > 0 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
          {allCourses.length > 0 && (
            <label className="practice-field-label">
              <span className="practice-field-title">Course</span>
              <select
                value={courseFilter}
                aria-label="Filter practice topics by course"
                className="practice-select"
                onChange={(e) => handleCourseFilterChange(e.target.value)}
              >
                <option value="all">All courses ({allLessons.length} topics)</option>
                {allCourses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="practice-field-label">
            <span className="practice-field-title">Topic / Lesson</span>
            <select
              value={lessonId}
              aria-label="Choose a lesson"
              className="practice-select"
              onChange={(e) => {
                setLessonId(e.target.value);
                setResult(null);
              }}
            >
              {lessonGroups.every(([label]) => !label)
                ? visibleLessons.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title}
                    </option>
                  ))
                : lessonGroups.map(([label, items]) =>
                    label ? (
                      <optgroup key={label} label={label}>
                        {items.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.title}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      items.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))
                    )
                  )}
            </select>
          </label>
        </div>

        {lesson ? (
          <>
            {/* Top Navigation Tabs */}
            <div className="practice-mode-nav flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Practice Modes">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "overview"}
                className={`practice-nav-tab ${activeTab === "overview" ? "selected" : ""}`}
                onClick={() => setActiveTab("overview")}
              >
                <span className="practice-tab-icon">⊞</span>
                <span>Modes Hub</span>
              </button>
              {PRACTICE_MODES.map((item) => {
                const isActive = activeTab === item.id;
                const hasCache = item.id !== "checkpoint" && cachedModeSet.has(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`practice-nav-tab ${isActive ? "selected" : ""}`}
                    onClick={() => selectMode(item.id)}
                  >
                    <span className="practice-tab-icon">
                      <ModeIcon type={item.id} size={15} />
                    </span>
                    <span>{item.label}</span>
                    {hasCache && <span className="practice-tab-badge" title="Drills cached locally">Cached</span>}
                  </button>
                );
              })}
            </div>

            {/* OVERVIEW / BENTO HUB VIEW (No outer panel! Sits directly on page!) */}
            {activeTab === "overview" ? (
              <div className="practice-hub-view flex flex-col gap-4">
                <div className="practice-hub-intro flex items-center justify-between gap-3">
                  <div>
                    <h2 className="practice-hub-title">{lesson.title}</h2>
                    <p className="practice-hub-subtitle">
                      Select an interactive practice mode below to reinforce recall, syntax intuition, and logical understanding.
                    </p>
                  </div>
                </div>

                {/* 6 Aesthetic Bento Cards */}
                <div className="practice-bento-grid">
                  {PRACTICE_MODES.map((m) => {
                    const hasCache = m.id !== "checkpoint" && cachedModeSet.has(m.id);
                    return (
                      <div
                        key={m.id}
                        className={`practice-bento-card bento-accent-${m.accent}`}
                        onClick={() => selectMode(m.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectMode(m.id);
                          }
                        }}
                      >
                        <div className="bento-card-header flex items-center justify-between">
                          <div className={`bento-icon-box accent-${m.accent}`}>
                            <ModeIcon type={m.id} size={22} />
                          </div>
                          <div className="flex items-center gap-1.5">
                            {hasCache && <span className="bento-badge-cached">✓ Ready</span>}
                            <span className={`bento-badge-category accent-${m.accent}`}>{m.badgeText}</span>
                          </div>
                        </div>

                        <div className="bento-card-body flex flex-col gap-1.5">
                          <div className="bento-title-row">
                            <h3 className="bento-card-title">{m.label}</h3>
                            <span className={`bento-card-tagline accent-${m.accent}`}>{m.tagline}</span>
                          </div>
                          <p className="bento-card-desc">{m.hint}</p>
                        </div>

                        {/* Aesthetic Micro-UI Graphic */}
                        <div className={`bento-preview-widget preview-${m.previewType}`}>
                          {m.previewType === "checkpoint" && (
                            <div className="preview-checkpoint-row flex items-center gap-2">
                              <span className="preview-chip is-check">✓ Rubric evaluation</span>
                              <span className="preview-chip is-pill">100% Mastery</span>
                            </div>
                          )}
                          {m.previewType === "quiz" && (
                            <div className="preview-quiz-row flex items-center gap-2">
                              <span className="preview-option-pill active">A</span>
                              <span className="preview-option-pill">B</span>
                              <span className="preview-option-pill">C</span>
                              <span className="preview-hint-pill">Instant Feedback</span>
                            </div>
                          )}
                          {m.previewType === "cloze" && (
                            <div className="preview-cloze-row flex items-center gap-2 flex-wrap">
                              <span className="preview-cloze-token">let [___] = state</span>
                              <span className="preview-cloze-chip accent-cyan">data</span>
                              <span className="preview-cloze-chip">value</span>
                            </div>
                          )}
                          {m.previewType === "order" && (
                            <div className="preview-order-row flex items-center gap-1.5">
                              <span className="preview-step-chip">① Setup</span>
                              <span className="preview-arrow">→</span>
                              <span className="preview-step-chip">② Execute</span>
                              <span className="preview-arrow">→</span>
                              <span className="preview-step-chip">③ Verify</span>
                            </div>
                          )}
                          {m.previewType === "word" && (
                            <div className="preview-word-row flex items-center gap-1.5">
                              <span className="preview-letter-tile">T</span>
                              <span className="preview-letter-tile">Y</span>
                              <span className="preview-letter-tile">P</span>
                              <span className="preview-letter-tile">E</span>
                              <span className="preview-letter-tile">S</span>
                            </div>
                          )}
                          {m.previewType === "mix" && (
                            <div className="preview-mix-row flex items-center gap-1.5 flex-wrap">
                              <span className="preview-mix-tag">✍ Cloze</span>
                              <span className="preview-mix-tag">❓ Quiz</span>
                              <span className="preview-mix-tag">⇄ Order</span>
                              <span className="preview-mix-tag">🔤 Word</span>
                            </div>
                          )}
                        </div>

                        <div className="bento-card-footer flex items-center justify-between pt-2">
                          <div className="bento-features flex items-center gap-1.5 flex-wrap">
                            {m.features.map((f, idx) => (
                              <span key={idx} className="bento-feature-item">
                                {f}
                              </span>
                            ))}
                          </div>
                          <span className="bento-action-btn flex items-center gap-1">
                            <span>Open</span>
                            <span className="bento-arrow">→</span>
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* DEDICATED TAB VIEW */
              <div className="practice-dedicated-card flex flex-col gap-4">
                {/* Mode Bar */}
                <div className="practice-mode-header flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      className="practice-back-btn flex items-center gap-1.5"
                      onClick={() => setActiveTab("overview")}
                      title="Back to all practice modes"
                    >
                      <span className="back-arrow">←</span>
                      <span>Modes Hub</span>
                    </button>
                    <div className="practice-header-divider" />
                    <div>
                      <div className="practice-active-badge flex items-center gap-1.5">
                        <ModeIcon type={activeModeMeta.id} size={15} />
                        <span>{activeModeMeta.label}</span>
                      </div>
                      <h2 className="practice-active-title">{lesson.title}</h2>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {mode !== "checkpoint" && (
                      <>
                        {studioSet?.exercises?.length > 0 && <span className="status-pill">Cached locally</span>}
                        <button
                          type="button"
                          className="primary-btn"
                          disabled={Boolean(generatingKey)}
                          onClick={() => generateExercises(Boolean(studioSet?.exercises?.length))}
                        >
                          {isGeneratingCurrent ? (
                            <>
                              <span className="btn-spinner" /> Generating…
                            </>
                          ) : studioSet?.exercises?.length ? (
                            `Regenerate ${activeModeMeta.label}`
                          ) : (
                            `Generate ${activeModeMeta.label}`
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Checkpoint Mode */}
                {mode === "checkpoint" ? (
                  <div className="practice-checkpoint-box flex flex-col gap-4">
                    <div className="checkpoint-banner">
                      <span className="checkpoint-eyebrow">{lesson.moduleTitle || "MODULE CHECKPOINT"}</span>
                      <h3 className="checkpoint-question">{checkpoint?.question || lesson.objective}</h3>
                    </div>

                    {checkpoint?.options?.length ? (
                      <div className="answer-options flex flex-col gap-2.5">
                        {checkpoint.options.map((choice, i) => (
                          <button
                            key={i}
                            type="button"
                            className="answer-option flex items-center gap-3 p-3.5 text-left cursor-pointer"
                            onClick={() => submitCheckpoint(i)}
                          >
                            <span className="option-letter">{String.fromCharCode(65 + i)}</span>
                            <span className="option-text">{choice}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="checkpoint-freeform flex flex-col gap-3">
                        <label className="practice-field-label">
                          <span className="practice-field-title">Your understanding & reasoning</span>
                          <textarea
                            value={answer}
                            onChange={(e) => setAnswer(e.target.value)}
                            placeholder="Explain your approach and the key intuition in your own words…"
                            className="practice-textarea"
                          />
                        </label>
                        <button type="button" className="primary-btn self-start" onClick={() => submitCheckpoint(-1)}>
                          Save Practice Evidence
                        </button>
                      </div>
                    )}

                    {result && (
                      <div
                        className={`feedback-box ${
                          result.correct === true ? "correct" : result.correct === false ? "incorrect" : ""
                        }`}
                        role="status"
                      >
                        <strong>
                          {result.correct === true ? "Correct" : result.correct === false ? "Not yet" : "Attempt saved"}
                        </strong>
                        <p>{result.text}</p>
                      </div>
                    )}
                    <p className="muted-copy">
                      Attempts are recorded in your learner profile as evidence of conceptual understanding.
                    </p>
                  </div>
                ) : (
                  /* Studio Runner / Launch State */
                  <div className="practice-studio-content flex flex-col gap-4">
                    {studioStatus.message && (
                      <div className={`practice-status-banner is-${studioStatus.kind}`} role="status" aria-live="polite">
                        <span>{studioStatus.message}</span>
                        {studioStatus.kind === "error" &&
                          (!p.remote ? (
                            <button type="button" className="quiet-btn compact" onClick={() => p.openAccount()}>
                              Sign in
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="quiet-btn compact"
                              disabled={Boolean(generatingKey)}
                              onClick={() => generateExercises(Boolean(studioSet?.exercises?.length))}
                            >
                              Retry
                            </button>
                          ))}
                      </div>
                    )}

                    {!isGeneratingCurrent && studioSet?.exercises?.length > 0 ? (
                      <PracticeStudioRunner
                        exercises={studioSet.exercises}
                        mode={mode}
                        lesson={lesson}
                        initialProgress={studioSet.progress}
                        onPersistProgress={handlePersistProgress}
                        onRecordAttempt={handleRecordAttempt}
                      />
                    ) : (
                      !isGeneratingCurrent && (
                        <div className="practice-mode-empty-card flex flex-col items-center justify-center p-8 text-center gap-3">
                          <div className={`empty-mode-icon accent-${activeModeMeta.accent}`}>
                            <ModeIcon type={activeModeMeta.id} size={36} />
                          </div>
                          <h3 className="empty-mode-title">{activeModeMeta.label} Studio</h3>
                          <p className="empty-mode-desc max-w-md">{activeModeMeta.hint}</p>
                          <button
                            type="button"
                            className="primary-btn mt-2"
                            disabled={Boolean(generatingKey)}
                            onClick={() => generateExercises(false)}
                          >
                            Generate {activeModeMeta.label} Exercises
                          </button>
                        </div>
                      )
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <EmptyState
            title="Choose a lesson first"
            body="Open a course to see its practice checkpoints and interactive exercises."
            action="Browse courses"
            onAction={() => p.go("courses")}
          />
        )}
      </div>

      {/* Aside: Glassmorphic with restrained moving border accent */}
      <aside className="practice-aside flex flex-col gap-5">
        <div className="glass-moving-border-card evidence-card-wrap">
          <div className="glass-card-inner">
            <div className="glass-card-head flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="glass-icon-glow">
                  <Icon name="progress" size={17} />
                </span>
                <h3 className="glass-card-title">Recent Evidence</h3>
              </div>
              <span className="glass-pill-badge">Active Log</span>
            </div>
            <div className="glass-card-content">
              <EvidenceList attempts={scopedAttempts.slice(0, 6)} />
            </div>
          </div>
        </div>

        <div className="glass-moving-border-card tutor-card-wrap">
          <div className="glass-card-inner">
            <div className="glass-card-head flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="glass-icon-glow violet">
                  <Icon name="tutor" size={17} />
                </span>
                <h3 className="glass-card-title">AI Tutor Practice</h3>
              </div>
              <span className="glass-pill-badge">Adaptive Help</span>
            </div>
            <div className="glass-card-content p-4 flex flex-col gap-3">
              <p className="glass-tutor-desc">
                Need guidance or hints? Ask the AI Tutor for contextual feedback and deeper concept breakdowns.
              </p>
              <button type="button" className="glass-tutor-btn flex items-center justify-center gap-2" onClick={() => p.go("tutor")}>
                <span>Open AI Tutor</span>
                <span className="tutor-btn-arrow">↗</span>
              </button>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function EvidenceList({
  attempts = [],
  pageSize = 0,
  showControls = false,
  emptyMessage = "Your checkpoint and practice evidence will appear here.",
}) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  if (!attempts.length) {
    return <p className="muted-copy padded">{emptyMessage}</p>;
  }

  // Sidebar / compact list mode (Practice page aside panel)
  if (!pageSize && !showControls) {
    return (
      <div className="evidence-aside-list flex flex-col gap-2.5 p-3">
        {attempts.map((a, i) => {
          const score = a.score != null ? Number(a.score) : null;
          const isPassed = score !== null && score >= 70;
          const isReview = score !== null && score < 70;
          const rawType = a.result?.exerciseType || (score != null ? "checkpoint" : "drill");
          const modeLabel =
            rawType === "fill_blank"
              ? "Fill Blanks"
              : rawType === "quiz"
              ? "Quiz"
              : rawType === "order"
              ? "Order"
              : rawType === "word_scramble"
              ? "Word Builder"
              : rawType === "checkpoint"
              ? "Checkpoint"
              : "Practice";

          return (
            <div className="evidence-item-card flex flex-col gap-1.5" key={a.id || i}>
              <div className="evidence-item-header flex items-center justify-between gap-2">
                <strong className="evidence-concept truncate" title={a.concept || "Practice Attempt"}>
                  {a.concept || "Practice Attempt"}
                </strong>
                {isPassed ? (
                  <span className="evidence-badge is-passed">
                    <span className="evidence-badge-icon">✓</span>
                    {score !== null ? `${score}%` : "Passed"}
                  </span>
                ) : isReview ? (
                  <span className="evidence-badge is-review">
                    <span className="evidence-badge-icon">⚡</span>
                    {score !== null ? `${score}%` : "Review"}
                  </span>
                ) : (
                  <span className="evidence-badge is-saved">
                    <span className="evidence-badge-icon">✎</span>
                    Saved
                  </span>
                )}
              </div>
              <div className="evidence-item-footer flex items-center gap-2 text-xs">
                <span className="evidence-mode-chip">{modeLabel}</span>
                <span className="evidence-dot-sep">•</span>
                <span className="evidence-date">{prettyDate(a.created_at, { month: "short", day: "numeric" })}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // Paginated / full table mode (Progress & Analytics views)
  const passedCount = attempts.filter((a) => a.score != null && Number(a.score) >= 70).length;
  const reviewCount = attempts.filter((a) => a.score != null && Number(a.score) < 70).length;

  const filtered = attempts.filter((a) => {
    if (statusFilter === "passed") {
      if (a.score == null || Number(a.score) < 70) return false;
    } else if (statusFilter === "review") {
      if (a.score == null || Number(a.score) >= 70) return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchConcept = (a.concept || "").toLowerCase().includes(q);
      const matchType = (a.result?.exerciseType || "").toLowerCase().includes(q);
      if (!matchConcept && !matchType) return false;
    }
    return true;
  });

  const actualPageSize = pageSize > 0 ? pageSize : 5;
  const totalPages = Math.max(1, Math.ceil(filtered.length / actualPageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * actualPageSize;
  const endIdx = Math.min(startIdx + actualPageSize, filtered.length);
  const visible = filtered.slice(startIdx, endIdx);

  const resetFilters = () => {
    setStatusFilter("all");
    setSearchQuery("");
    setPage(1);
  };

  return (
    <div className="evidence-paginated-container flex flex-col gap-2.5">
      <div className="evidence-toolbar flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <div className="evidence-filter-pills flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Filter activity status">
          <button
            type="button"
            className={`evidence-filter-pill ${statusFilter === "all" ? "active" : ""}`}
            onClick={() => {
              setStatusFilter("all");
              setPage(1);
            }}
          >
            All ({attempts.length})
          </button>
          <button
            type="button"
            className={`evidence-filter-pill ${statusFilter === "passed" ? "active" : ""}`}
            onClick={() => {
              setStatusFilter("passed");
              setPage(1);
            }}
          >
            Passed ({passedCount})
          </button>
          <button
            type="button"
            className={`evidence-filter-pill ${statusFilter === "review" ? "active" : ""}`}
            onClick={() => {
              setStatusFilter("review");
              setPage(1);
            }}
          >
            Needs review ({reviewCount})
          </button>
        </div>
        <div className="evidence-search-wrap">
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(1);
            }}
            placeholder="Filter concept…"
            aria-label="Filter practice activity by concept"
            className="evidence-search-input text-xs"
          />
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="evidence-list paginated flex flex-col gap-2">
          {visible.map((a, i) => {
            const score = a.score != null ? Number(a.score) : null;
            const isGood = score !== null && score >= 70;
            const isReview = score !== null && score < 70;
            const exType = a.result?.exerciseType;
            const typeLabel = exType ? exType.replace(/_/g, " ") : "checkpoint";

            return (
              <div className="evidence-item-card flex items-center justify-between gap-3 p-3.5" key={a.id || `${startIdx + i}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <strong className="block truncate text-sm text-slate-100">{a.concept || "Practice attempt"}</strong>
                    <div className="flex items-center gap-2 text-xs text-slate-300 mt-0.5">
                      <span className="evidence-mode-chip">{typeLabel}</span>
                      <span className="evidence-date">· {prettyDate(a.created_at, { month: "short", day: "numeric" })}</span>
                    </div>
                  </div>
                </div>
                {isGood ? (
                  <span className="evidence-badge is-passed">
                    <span className="evidence-badge-icon">✓</span>
                    {score !== null ? `${score}%` : "Passed"}
                  </span>
                ) : isReview ? (
                  <span className="evidence-badge is-review">
                    <span className="evidence-badge-icon">⚡</span>
                    {score !== null ? `${score}%` : "Review"}
                  </span>
                ) : (
                  <span className="evidence-badge is-saved">
                    <span className="evidence-badge-icon">✎</span>
                    Saved
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="evidence-empty-filter p-4 text-center text-sm muted-copy flex flex-col items-center gap-2">
          <span>No activity matched the selected filter.</span>
          <button type="button" className="text-button text-xs" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      )}

      {filtered.length > actualPageSize && (
        <div className="evidence-pagination flex items-center justify-between px-2 pt-2 border-t border-learnos-line/40 text-xs text-learnos-muted">
          <span>
            Showing {startIdx + 1}–{endIdx} of {filtered.length} attempts
          </span>
          <div className="evidence-page-buttons flex items-center gap-2">
            <button
              type="button"
              className="evidence-page-btn"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page of practice activity"
            >
              Previous
            </button>
            <span className="page-indicator">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="evidence-page-btn"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page of practice activity"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { PracticePage };
