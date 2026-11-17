import React, { useRef, useState, useMemo } from "react";
import { Icon, GenerationProgressCard } from "../components/common.jsx";

function readGoalDraft() {
  try {
    return JSON.parse(sessionStorage.getItem("learnos.goal.draft") || "{}");
  } catch {
    return {};
  }
}

export { readGoalDraft };

function CreateCoursePage(props) {
  const formRef = useRef(null);

  const [topic, setTopic] = useState(() => sessionStorage.getItem("learnos.goal.prefill") || readGoalDraft().topic || "");
  const [outcome, setOutcome] = useState(() => readGoalDraft().desiredOutcome || "");
  const [level, setLevel] = useState("Beginner");
  const [purpose, setPurpose] = useState("Personal learning");
  const [weekly, setWeekly] = useState(props.data?.settings?.weeklyMinutes || 360);
  const [weeks, setWeeks] = useState(8);
  const [date, setDate] = useState("");

  const weeklyHours = useMemo(() => {
    return Math.round(Number(weekly) / 60);
  }, [weekly]);

  const runSubmit = async () => {
    sessionStorage.removeItem("learnos.goal.prefill");
    await props.submitGoal({
      topic,
      desiredOutcome: outcome,
      currentLevel: level,
      purpose,
      weeklyMinutes: Number(weekly),
      targetWeeks: Number(weeks),
      targetDate: date || null
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

  return (
    <div className="create-course-page-container">
      {/* Page Header */}
      <div className="create-course-header">
        <h1 className="create-course-title">Create a course</h1>
        <p className="create-course-subtitle">
          Define what you want to learn to build your structured roadmap.
        </p>
      </div>

      {/* Main Clean Form Card */}
      <form ref={formRef} className="create-course-form-card" onSubmit={handleSubmit}>
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
        <div className="create-course-field">
          <label htmlFor="course-outcome" className="create-course-label">
            What do you want to be able to do?
          </label>
          <textarea
            id="course-outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            required
            minLength={8}
            placeholder="Describe a practical outcome you can demonstrate..."
            className="create-course-textarea"
            rows={3}
          />
        </div>

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
          <label htmlFor="course-date" className="create-course-label flex items-center justify-between">
            <span>Target date</span>
            <span className="optional-label text-xs font-normal text-[#A8C5A8]">Optional</span>
          </label>
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

        {/* Progress Display */}
        {props.busy && (
          <div className="create-course-progress-wrap">
            <GenerationProgressCard
              progress={props.generationProgress}
              fallbackMessage="Building your course plan…"
              ariaLabel="Course generation progress"
              note="Structuring modules, lessons, and practice checkpoints."
            />
          </div>
        )}

        {/* Error Notification */}
        {props.generationError && !props.busy && (
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
