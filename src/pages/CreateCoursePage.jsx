import React, { useRef, useState, useMemo, useCallback } from "react";
import { Icon, Panel, GenerationProgressCard } from "../components/common.jsx";

function readGoalDraft() {
  try {
    return JSON.parse(sessionStorage.getItem("learnos.goal.draft") || "{}");
  } catch {
    return {};
  }
}

export { readGoalDraft };

// Quick inspiration topics for effortless course creation
const INSPIRATION_TOPICS = [
  "Full-Stack React & Node.js",
  "Machine Learning & PyTorch",
  "Cloud Architecture & AWS",
  "Conversational Spanish",
  "Product Design & Systems",
  "Rust Systems Programming"
];

const PURPOSE_OPTIONS = [
  { id: "Personal learning", label: "Personal growth", glyph: "spark", desc: "Curiosity & passion" },
  { id: "Career transition", label: "Career transition", glyph: "progress", desc: "Pivot to a new field" },
  { id: "Work project", label: "Work project", glyph: "briefcase", desc: "Deliver on real deadlines" },
  { id: "School or university", label: "Academic study", glyph: "book", desc: "Exam & thesis prep" },
  { id: "Other", label: "Self-directed", glyph: "check", desc: "Custom syllabus" }
];

const LEVEL_OPTIONS = [
  { id: "Beginner", label: "Beginner", hint: "From absolute ground up" },
  { id: "Some experience", label: "Some experience", hint: "Know the core syntax" },
  { id: "Intermediate", label: "Intermediate", hint: "Build functional projects" },
  { id: "Advanced", label: "Advanced", hint: "Deep mastery & optimization" }
];

const WEEKLY_HOURS_OPTIONS = [
  { minutes: 180, label: "3 hrs/wk", badge: "Casual pace" },
  { minutes: 360, label: "6 hrs/wk", badge: "Recommended" },
  { minutes: 600, label: "10 hrs/wk", badge: "Dedicated" },
  { minutes: 900, label: "15 hrs/wk", badge: "Intensive" }
];

const DURATION_OPTIONS = [
  { weeks: 4, label: "4 weeks", sub: "Sprint sprint" },
  { weeks: 8, label: "8 weeks", sub: "Standard path" },
  { weeks: 12, label: "12 weeks", sub: "Comprehensive" },
  { weeks: 16, label: "16 weeks", sub: "Mastery track" }
];

function CreateCoursePage(props) {
  const formRef = useRef(null);

  // Form states initialized with prefill or draft
  const [topic, setTopic] = useState(() => sessionStorage.getItem("learnos.goal.prefill") || readGoalDraft().topic || "");
  const [outcome, setOutcome] = useState(() => readGoalDraft().desiredOutcome || "");
  const [level, setLevel] = useState("Beginner");
  const [purpose, setPurpose] = useState("Personal learning");
  const [weekly, setWeekly] = useState(props.data?.settings?.weeklyMinutes || 360);
  const [weeks, setWeeks] = useState(8);
  const [date, setDate] = useState("");

  const totalHours = useMemo(() => {
    return Math.round((Number(weekly) * Number(weeks)) / 60);
  }, [weekly, weeks]);

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

  const handleSelectInspiration = (item) => {
    setTopic(item);
    if (!outcome) {
      setOutcome(`Build and deploy complete real-world projects in ${item} with independent mastery.`);
    }
  };

  return (
    <div className="create-course-page-container">
      {/* 1. HERO HEADER AREA */}
      <header className="create-course-hero">
        <div className="create-course-eyebrow-chip">
          <span className="eyebrow-spark">✦</span>
          <span>AI Curriculum Architect</span>
        </div>
        <h1 className="create-course-heading">
          Design your custom course
        </h1>
        <p className="create-course-subheading">
          Define the subject and capability you want to build. Drizzlearn analyzes prerequisite milestones,
          synthesizes weekly modules, and drafts interactive practice drills.
        </p>
      </header>

      {/* 2. MAIN TWO-COLUMN WORKSPACE */}
      <div className="create-course-layout">
        {/* LEFT COLUMN: THE MODERN COURSE SYNTHESIS FORM */}
        <form ref={formRef} className="create-course-form-card" onSubmit={handleSubmit}>
          {/* SECTION 1: WHAT YOU WANT TO LEARN */}
          <section className="form-step-section">
            <div className="step-section-header">
              <span className="step-number-badge">01</span>
              <div>
                <h2 className="step-title">Course Subject & Practical Outcome</h2>
                <p className="step-desc">What skill do you want to unlock?</p>
              </div>
            </div>

            <div className="form-field-group">
              <label htmlFor="course-topic" className="create-course-label">
                What do you want to learn? <span className="required-star">*</span>
              </label>
              <input
                id="course-topic"
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
                minLength={2}
                maxLength={120}
                placeholder="e.g. Modern React & Next.js, Conversational Italian, Cloud Systems..."
                className="create-course-input"
              />

              {/* Inspiration Suggestion Chips */}
              <div className="inspiration-chips-wrap">
                <span className="inspiration-label">Suggestions:</span>
                <div className="inspiration-chips">
                  {INSPIRATION_TOPICS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className="inspiration-pill"
                      onClick={() => handleSelectInspiration(item)}
                    >
                      <span>+</span> {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="form-field-group mt-5">
              <label htmlFor="course-outcome" className="create-course-label">
                What practical capability will you demonstrate? <span className="required-star">*</span>
              </label>
              <textarea
                id="course-outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                required
                minLength={8}
                placeholder="Describe a tangible outcome, e.g. 'Build an authenticated full-stack application and deploy it to production independently.'"
                className="create-course-textarea"
                rows={3}
              />
              <div className="field-hint-row">
                <span className="hint-icon">✦</span>
                <span className="hint-text">
                  A specific outcome empowers the AI to craft relevant lessons, worked examples, and checkpoint quizzes.
                </span>
              </div>
            </div>
          </section>

          {/* SECTION 2: LEARNER PROFILE & INTENT */}
          <section className="form-step-section border-t border-[#CFDDD0] pt-7">
            <div className="step-section-header">
              <span className="step-number-badge">02</span>
              <div>
                <h2 className="step-title">Learner Profile & Purpose</h2>
                <p className="step-desc">Tailor the difficulty and context of explanations.</p>
              </div>
            </div>

            {/* Current Level Segmented Control */}
            <div className="form-field-group">
              <label className="create-course-label mb-2">
                Your current experience level
              </label>
              <div className="level-segmented-grid">
                {LEVEL_OPTIONS.map((opt) => {
                  const isSelected = level === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`level-segment-card ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setLevel(opt.id)}
                    >
                      <div className="level-segment-header">
                        <span className="level-name">{opt.label}</span>
                        {isSelected && <span className="level-check">✓</span>}
                      </div>
                      <span className="level-hint">{opt.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Purpose Selector Chips */}
            <div className="form-field-group mt-6">
              <label className="create-course-label mb-2">
                Primary learning goal or context
              </label>
              <div className="purpose-chips-grid">
                {PURPOSE_OPTIONS.map((opt) => {
                  const isSelected = purpose === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      className={`purpose-chip-card ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setPurpose(opt.id)}
                    >
                      <div className="purpose-chip-icon">
                        <Icon name={opt.glyph} size={15} />
                      </div>
                      <div className="purpose-chip-content">
                        <strong className="purpose-chip-title">{opt.label}</strong>
                        <span className="purpose-chip-desc">{opt.desc}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          {/* SECTION 3: STUDY SCHEDULE & PACING */}
          <section className="form-step-section border-t border-[#CFDDD0] pt-7">
            <div className="step-section-header">
              <span className="step-number-badge">03</span>
              <div>
                <h2 className="step-title">Schedule & Pacing</h2>
                <p className="step-desc">Set realistic milestones to balance your weekly time.</p>
              </div>
            </div>

            <div className="pacing-two-column-grid">
              {/* Weekly Time Commitment */}
              <div className="pacing-column">
                <label className="create-course-label mb-2">
                  Weekly commitment
                </label>
                <div className="pacing-chips-flex">
                  {WEEKLY_HOURS_OPTIONS.map((opt) => {
                    const isSelected = Number(weekly) === opt.minutes;
                    return (
                      <button
                        key={opt.minutes}
                        type="button"
                        className={`pacing-option-chip ${isSelected ? "is-selected" : ""}`}
                        onClick={() => setWeekly(opt.minutes)}
                      >
                        <strong className="pacing-val">{opt.label}</strong>
                        <span className="pacing-badge">{opt.badge}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target Duration */}
              <div className="pacing-column">
                <label className="create-course-label mb-2">
                  Curriculum duration
                </label>
                <div className="pacing-chips-flex">
                  {DURATION_OPTIONS.map((opt) => {
                    const isSelected = Number(weeks) === opt.weeks;
                    return (
                      <button
                        key={opt.weeks}
                        type="button"
                        className={`pacing-option-chip ${isSelected ? "is-selected" : ""}`}
                        onClick={() => setWeeks(opt.weeks)}
                      >
                        <strong className="pacing-val">{opt.label}</strong>
                        <span className="pacing-badge">{opt.sub}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Target Date Picker (Optional) */}
            <div className="form-field-group mt-5">
              <label htmlFor="course-target-date" className="create-course-label flex items-center justify-between">
                <span>Target completion deadline</span>
                <span className="optional-tag">Optional</span>
              </label>
              <input
                id="course-target-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                onClick={(e) => {
                  try {
                    e.target.showPicker?.();
                  } catch (_) {}
                }}
                min={new Date().toISOString().slice(0, 10)}
                className="create-course-date-input"
              />
            </div>
          </section>

          {/* SECTION 4: PROGRESS & ERROR NOTIFICATIONS */}
          {props.busy && (
            <div className="course-synthesis-progress-box">
              <GenerationProgressCard
                progress={props.generationProgress}
                fallbackMessage="Synthesizing personalized curriculum & practice sets..."
                ariaLabel="Course generation progress"
                note="Decomposing topic into modular checkpoints, worked lessons, and spaced drills."
              />
            </div>
          )}

          {props.generationError && !props.busy && (
            <div className="create-course-error-banner" role="alert">
              <span className="error-icon">
                <Icon name="alert" size={18} />
              </span>
              <div className="error-message-wrap">
                <strong>Curriculum synthesis paused:</strong> {props.generationError}
              </div>
              <div className="error-actions-wrap">
                <button
                  type="button"
                  className="retry-synthesis-btn"
                  onClick={retryGeneration}
                >
                  Try again ↻
                </button>
                <button
                  type="button"
                  className="dismiss-error-btn"
                  onClick={() => props.setGenerationError("")}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* SECTION 5: ACTION SUBMISSION BAR */}
          <div className="create-course-submit-bar">
            {/* Live Study Commitment Badge */}
            <div className="study-budget-indicator">
              <div className="budget-clock-icon" aria-hidden="true">
                <Icon name="clock" size={17} />
              </div>
              <div className="budget-text-col">
                <span className="budget-caption">Total Curriculum Commitment</span>
                <strong className="budget-hours">
                  {totalHours} hours <span className="budget-rate">({weeklyHours} hrs/wk over {weeks} wks)</span>
                </strong>
              </div>
            </div>

            {/* Primary Action Button */}
            <button
              type="submit"
              className="create-course-submit-btn"
              disabled={props.busy || !topic.trim() || !outcome.trim()}
            >
              {props.busy ? (
                <>
                  <span className="btn-spinner-botanical" aria-hidden="true" />
                  <span>Synthesizing roadmap…</span>
                </>
              ) : props.remote ? (
                <>
                  <span>Generate Course Roadmap</span>
                  <span className="btn-arrow-botanical">↗</span>
                </>
              ) : (
                <>
                  <span>Sign in to Generate Course</span>
                  <span className="btn-arrow-botanical">↗</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* RIGHT COLUMN: LIVE BLUEPRINT & SYNTHESIS ARCHITECTURE COMPANION */}
        <aside className="create-course-companion" aria-label="Course Blueprint Preview">
          {/* CARD 1: LIVE BLUEPRINT PREVIEW */}
          <div className="companion-card live-blueprint-card">
            <div className="companion-card-header">
              <span className="blueprint-status-indicator" />
              <h3 className="companion-card-title">Course Blueprint Preview</h3>
            </div>
            
            <div className="blueprint-details">
              <div className="blueprint-hero-topic">
                {topic.trim() || "Your Course Title"}
              </div>
              <p className="blueprint-outcome-preview">
                {outcome.trim() || "Practical demonstrated outcome will be displayed here as you type..."}
              </p>

              <div className="blueprint-tags-row">
                <span className="blueprint-tag tag-level">{level}</span>
                <span className="blueprint-tag tag-duration">{weeks} weeks</span>
                <span className="blueprint-tag tag-hours">{weeklyHours} hrs/wk</span>
                <span className="blueprint-tag tag-purpose">{purpose}</span>
              </div>
            </div>
          </div>

          {/* CARD 2: WHAT HAPPENS NEXT */}
          <div className="companion-card synthesis-steps-card">
            <h3 className="companion-card-title mb-3">Synthesis Architecture</h3>
            <div className="synthesis-timeline">
              <div className="timeline-step">
                <span className="timeline-step-badge">01</span>
                <div className="timeline-step-content">
                  <strong className="timeline-step-title">Modular Concept Mapping</strong>
                  <p className="timeline-step-desc">
                    Decomposes {topic ? `"${topic}"` : "the subject"} into bite-sized progressive modules tailored to {level.toLowerCase()} level.
                  </p>
                </div>
              </div>

              <div className="timeline-step">
                <span className="timeline-step-badge">02</span>
                <div className="timeline-step-content">
                  <strong className="timeline-step-title">Interactive Lessons & Checks</strong>
                  <p className="timeline-step-desc">
                    Generates clear concept explanations, code sandboxes, and verification quizzes for each milestone.
                  </p>
                </div>
              </div>

              <div className="timeline-step">
                <span className="timeline-step-badge">03</span>
                <div className="timeline-step-content">
                  <strong className="timeline-step-title">Spaced Practice & Flashcards</strong>
                  <p className="timeline-step-desc">
                    Automates daily reviews and practice drills scheduled across your {weeks}-week study budget.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* CARD 3: HIGH IMPACT OUTCOME GUIDE */}
          <div className="companion-card outcome-guide-card">
            <div className="guide-header flex items-center gap-2 mb-2">
              <span className="text-[#DDA96D]">✦</span>
              <h4 className="guide-title font-bold text-sm text-[#183126]">Outcome Quality Checklist</h4>
            </div>
            <ul className="guide-checklist">
              <li className="checklist-item">
                <span className="check-icon">✓</span>
                <span>Action-oriented verb (e.g. "Build", "Speak", "Deploy")</span>
              </li>
              <li className="checklist-item">
                <span className="check-icon">✓</span>
                <span>Observable milestone you can test yourself on</span>
              </li>
              <li className="checklist-item">
                <span className="check-icon">✓</span>
                <span>Realistic scope achievable in ~{totalHours} hours</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}

export { CreateCoursePage };
