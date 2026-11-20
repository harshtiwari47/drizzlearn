import React, { useRef, useState, useMemo, useEffect } from "react";
import { Icon, GenerationProgressCard } from "../components/common.jsx";

const DRAFT_STORAGE_KEY = "drizzlearn.create_course_draft";
const PROGRESS_STORAGE_KEY = "drizzlearn.generation_progress";

function readGoalDraft() {
  try {
    const local = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (local) return JSON.parse(local);
  } catch (_) {}
  try {
    const session = sessionStorage.getItem("learnos.goal.draft");
    if (session) return JSON.parse(session);
  } catch (_) {}
  return {};
}

export { readGoalDraft };

function CreateCoursePage(props) {
  const formRef = useRef(null);
  const targetPos = useRef({ x: 0, y: 0, opacity: 0 });
  const currentPos = useRef({ x: 0, y: 0, opacity: 0 });
  const rafId = useRef(null);

  const initialDraft = useMemo(() => readGoalDraft(), []);
  const prefill = typeof window !== "undefined" ? sessionStorage.getItem("learnos.goal.prefill") : "";

  const [topic, setTopic] = useState(() => prefill || initialDraft.topic || "");
  const [outcome, setOutcome] = useState(() => initialDraft.desiredOutcome || "");
  const [level, setLevel] = useState(() => initialDraft.currentLevel || "Beginner");
  const [purpose, setPurpose] = useState(() => initialDraft.purpose || "Personal learning");
  const [weekly, setWeekly] = useState(() => initialDraft.weeklyMinutes || props.data?.settings?.weeklyMinutes || 360);
  const [weeks, setWeeks] = useState(() => initialDraft.targetWeeks || 8);
  const [date, setDate] = useState(() => initialDraft.targetDate || "");

  const weeklyHours = useMemo(() => {
    return Math.round(Number(weekly) / 60);
  }, [weekly]);

  const hasSavedDraft = Boolean(topic.trim() || outcome.trim());

  // Auto-save form inputs to localStorage so refreshing or closing the tab restores everything
  useEffect(() => {
    if (topic.trim() || outcome.trim()) {
      const draftData = {
        topic,
        desiredOutcome: outcome,
        currentLevel: level,
        purpose,
        weeklyMinutes: Number(weekly),
        targetWeeks: Number(weeks),
        targetDate: date || null,
        goalId: props.generationProgress?.goalId || initialDraft.goalId || null,
        updatedAt: Date.now(),
      };
      try {
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
        sessionStorage.setItem("learnos.goal.draft", JSON.stringify(draftData));
      } catch (_) {}
    }
  }, [topic, outcome, level, purpose, weekly, weeks, date, props.generationProgress?.goalId, initialDraft.goalId]);

  const handleClearDraft = () => {
    setTopic("");
    setOutcome("");
    setLevel("Beginner");
    setPurpose("Personal learning");
    setWeekly(props.data?.settings?.weeklyMinutes || 360);
    setWeeks(8);
    setDate("");
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
      localStorage.removeItem(PROGRESS_STORAGE_KEY);
      sessionStorage.removeItem("learnos.goal.draft");
      sessionStorage.removeItem("learnos.goal.prefill");
    } catch (_) {}
    if (props.setGenerationProgress) props.setGenerationProgress(null);
    if (props.setGenerationError) props.setGenerationError("");
  };

  const runSubmit = async () => {
    sessionStorage.removeItem("learnos.goal.prefill");
    const savedDraft = readGoalDraft();
    const existingGoalId = props.generationProgress?.goalId || savedDraft.goalId || null;

    await props.submitGoal({
      topic,
      desiredOutcome: outcome,
      currentLevel: level,
      purpose,
      weeklyMinutes: Number(weekly),
      targetWeeks: Number(weeks),
      targetDate: date || null,
      goalId: existingGoalId,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    await runSubmit();
  };

  const retryGeneration = () => {
    if (formRef.current?.requestSubmit) {
      formRef.current.requestSubmit();
    } else {
      runSubmit();
    }
  };

  // Smooth entrance sweep and fluid damped cursor-following spotlight loop
  useEffect(() => {
    let mounted = true;
    const form = formRef.current;
    if (!form) return;

    // Initial position on mount (gentle introductory glide across the card surface)
    const rect = form.getBoundingClientRect();
    const initialWidth = rect.width || 800;
    const initialHeight = rect.height || 450;
    currentPos.current = { x: initialWidth * 0.15, y: initialHeight * 0.2, opacity: 0 };
    targetPos.current = { x: initialWidth * 0.5, y: initialHeight * 0.42, opacity: 0.75 };

    const timer = setTimeout(() => {
      if (!mounted) return;
      targetPos.current.opacity = 0.55;
    }, 200);

    const updateLoop = () => {
      if (!mounted) return;
      // Damped spring / lerp easing for silky smooth cursor follow
      const speed = 0.12;
      currentPos.current.x += (targetPos.current.x - currentPos.current.x) * speed;
      currentPos.current.y += (targetPos.current.y - currentPos.current.y) * speed;
      currentPos.current.opacity += (targetPos.current.opacity - currentPos.current.opacity) * 0.08;

      if (form) {
        form.style.setProperty("--mouse-x", `${currentPos.current.x.toFixed(2)}px`);
        form.style.setProperty("--mouse-y", `${currentPos.current.y.toFixed(2)}px`);
        form.style.setProperty("--spotlight-opacity", currentPos.current.opacity.toFixed(3));
      }

      rafId.current = requestAnimationFrame(updateLoop);
    };

    rafId.current = requestAnimationFrame(updateLoop);

    return () => {
      mounted = false;
      clearTimeout(timer);
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const handleMouseMove = (e) => {
    if (!formRef.current) return;
    const rect = formRef.current.getBoundingClientRect();
    targetPos.current.x = e.clientX - rect.left;
    targetPos.current.y = e.clientY - rect.top;
    targetPos.current.opacity = 1;
  };

  const handleMouseEnter = (e) => {
    if (!formRef.current) return;
    const rect = formRef.current.getBoundingClientRect();
    targetPos.current.x = e.clientX - rect.left;
    targetPos.current.y = e.clientY - rect.top;
    targetPos.current.opacity = 1;
  };

  const handleMouseLeave = () => {
    targetPos.current.opacity = 0;
  };

  return (
    <div className="create-course-page-container">
      {/* Page Header */}
      <div className="create-course-header">
        <div className="create-course-title-row">
          <button
            type="button"
            className="create-course-circle-back-btn"
            onClick={() => {
              if (props.go) {
                props.go("courses");
              } else if (window.history.length > 1) {
                window.history.back();
              } else {
                window.location.href = "/courses";
              }
            }}
            aria-label="Back to courses"
            title="Back to My Courses"
          >
            <Icon name="arrowLeft" size={22} />
          </button>
          <div className="create-course-title-wrap">
            <div className="create-course-title-header-badge-row flex items-center gap-3 flex-wrap">
              <h1 className="create-course-title">Create a course</h1>
              {hasSavedDraft && (
                <div className="create-course-draft-pill flex items-center gap-2" role="status" aria-label="Draft saved locally">
                  <span className="draft-saved-dot" aria-hidden="true" />
                  <span className="draft-saved-text">Draft saved</span>
                  <button
                    type="button"
                    className="draft-clear-btn"
                    onClick={handleClearDraft}
                    title="Clear saved draft and start fresh"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
            <p className="create-course-subtitle">
              Define what you want to learn to build your structured roadmap.
            </p>
          </div>
        </div>
      </div>

      {/* Main Responsive Form Card with Smooth Interactive Cursor Green Glow */}
      <form
        ref={formRef}
        className="create-course-form-card"
        onSubmit={handleSubmit}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="create-course-columns-grid">
          {/* Left Column: Course Scope & Demonstration */}
          <div className="create-course-col">
            {/* Field 1: Topic */}
            <div className="create-course-field">
              <label htmlFor="course-topic" className="create-course-label">
                What do you want to learn?
              </label>
              <input
                id="course-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Node.js Foundations, Spanish, Cloud Architecture..."
                className="create-course-input"
              />
            </div>

            {/* Field 2: Outcome */}
            <div className="create-course-field create-course-field-grow">
              <label htmlFor="course-outcome" className="create-course-label">
                What do you want to be able to do?
              </label>
              <textarea
                id="course-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                required
                minLength={8}
                placeholder="Describe a practical outcome you can demonstrate upon course completion..."
                className="create-course-textarea create-course-textarea-fill"
                rows={5}
              />
            </div>
          </div>

          {/* Right Column: Parameters, Cadence & Target Date */}
          <div className="create-course-col">
            {/* Field 3: Level & Purpose */}
            <div className="create-course-grid-two">
              <div className="create-course-field">
                <label htmlFor="course-level" className="create-course-label">
                  Current level
                </label>
                <select
                  id="course-level"
                  value={level}
                  onChange={(e) => setLevel(e.target.value)}
                  className="create-course-select"
                >
                  <option value="Beginner">Beginner</option>
                  <option value="Some experience">Some experience</option>
                  <option value="Intermediate">Intermediate</option>
                  <option value="Advanced">Advanced</option>
                </select>
              </div>

              <div className="create-course-field">
                <label htmlFor="course-purpose" className="create-course-label">
                  Purpose
                </label>
                <select
                  id="course-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="create-course-select"
                >
                  <option value="Personal learning">Personal learning</option>
                  <option value="School or university">School or university</option>
                  <option value="Work project">Work project</option>
                  <option value="Career transition">Career transition</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            {/* Field 4: Weekly Hours & Duration */}
            <div className="create-course-grid-two">
              <div className="create-course-field">
                <label htmlFor="course-weekly-hours" className="create-course-label">
                  Hours each week
                </label>
                <select
                  id="course-weekly-hours"
                  value={weekly}
                  onChange={(e) => setWeekly(Number(e.target.value))}
                  className="create-course-select"
                >
                  <option value="180">3 hours / week</option>
                  <option value="360">6 hours / week</option>
                  <option value="600">10 hours / week</option>
                  <option value="900">15 hours / week</option>
                  <option value="1200">20 hours / week</option>
                </select>
              </div>

              <div className="create-course-field">
                <label htmlFor="course-duration" className="create-course-label">
                  Target duration
                </label>
                <select
                  id="course-duration"
                  value={weeks}
                  onChange={(e) => setWeeks(Number(e.target.value))}
                  className="create-course-select"
                >
                  <option value="4">4 weeks</option>
                  <option value="8">8 weeks</option>
                  <option value="10">10 weeks</option>
                  <option value="12">12 weeks</option>
                  <option value="16">16 weeks</option>
                </select>
              </div>
            </div>

            {/* Field 5: Target Date */}
            <div className="create-course-field">
              <div className="flex items-center justify-between">
                <label htmlFor="course-date" className="create-course-label">
                  Target date
                </label>
                <span className="optional-label">Optional</span>
              </div>
              <p className="create-course-field-hint">
                Set a completion deadline to pace your lessons and daily study blocks.
              </p>
              <input
                id="course-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onClick={(e) => {
                  try {
                    e.target.showPicker?.();
                  } catch (_) {}
                }}
                min={new Date().toISOString().slice(0, 10)}
                className="create-course-input"
              />
            </div>
          </div>
        </div>

        {/* Progress Display: keep visible during active streaming OR when generation pauses/fails with error */}
        {(props.busy || (props.generationProgress && props.generationProgress.percent > 0)) && (
          <div className="create-course-progress-wrap">
            <GenerationProgressCard
              progress={props.generationProgress}
              fallbackMessage="Building your course plan…"
              ariaLabel="Course generation progress"
              note="Structuring modules, lessons, and practice checkpoints."
              onRetry={retryGeneration}
              onDismiss={handleClearDraft}
            />
          </div>
        )}

        {/* Fallback Error Notification (only shown if GenerationProgressCard is not active) */}
        {props.generationError && !props.busy && !props.generationProgress && (
          <div className="create-course-error-row" role="alert">
            <span className="error-icon text-rose-400">
              <Icon name="alert" size={17} />
            </span>
            <div className="error-text flex-1">
              <strong>Course generation paused:</strong> {props.generationError}
            </div>
            <div className="error-btns flex items-center gap-2">
              <button
                type="button"
                className="error-retry-btn"
                onClick={retryGeneration}
              >
                Try again ↻
              </button>
              <button
                type="button"
                className="error-dismiss-btn"
                onClick={() => props.setGenerationError("")}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Submit Row */}
        <div className="create-course-submit-row">
          <div className="study-budget-badge">
            <span className="budget-icon text-[#DDA96D]">
              <Icon name="clock" size={16} />
            </span>
            <span className="budget-label">
              Study budget: <strong>{weeklyHours} hours / week</strong>
            </span>
          </div>

          <button
            type="submit"
            className="create-course-submit-btn"
            disabled={props.busy || !topic.trim() || !outcome.trim()}
          >
            {props.busy ? (
              <>
                <span className="btn-spinner" aria-hidden="true" />
                <span>Building your plan…</span>
              </>
            ) : props.remote ? (
              <span>Generate course proposal ↗</span>
            ) : (
              <span>Sign in to generate plan ↗</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

export { CreateCoursePage };
