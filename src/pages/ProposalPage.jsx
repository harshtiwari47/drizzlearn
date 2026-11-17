import React, { useState, useMemo, useEffect } from "react";
import { Icon, minuteLabel, EmptyState, GenerationProgressCard, mergeStreamProgress } from "../components/common.jsx";

export function ProposalPage(p) {
  const course = p.proposal || p.activeCourse;

  const [title, setTitle] = useState(course?.title || "");
  const [summary, setSummary] = useState(course?.summary || "");
  const [modules, setModules] = useState(course?.modules || []);
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [viewMode, setViewMode] = useState("milestone"); // "milestone" | "all"
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [improveText, setImproveText] = useState("");
  const [improving, setImproving] = useState(false);
  const [improveProgress, setImproveProgress] = useState(null);
  const [improveError, setImproveError] = useState("");

  useEffect(() => {
    setTitle(course?.title || "");
    setSummary(course?.summary || "");
    setModules(course?.modules || []);
    setHasUnsavedChanges(false);
  }, [course?.id, course?.title, course?.summary, course?.modules]);

  if (!course) {
    return (
      <EmptyState
        title="No proposal to review"
        body="Create a learning goal to generate a personalized course roadmap."
        action="Create a course"
        onAction={() => p.go("create/course")}
      />
    );
  }

  const minutes = Number(course.estimated_minutes) || modules.reduce(
    (sum, m) => sum + (Number(m.estimatedMinutes) || Number(m.estimated_minutes) || 0),
    0
  );
  const totalHours = Math.round((minutes / 60) * 10) / 10;
  const weeks = Number(course.durationWeeks || course.target_weeks) || 8;
  const weeklyBudget = Number(course.weeklyMinutes || course.weekly_minutes || p.data?.settings?.weeklyMinutes || 360);
  const weeklyNeeded = Math.ceil(minutes / weeks);
  const weeklyNeededHours = Math.round((weeklyNeeded / 60) * 10) / 10;
  const weeklyBudgetHours = Math.round(weeklyBudget / 60);
  const fitsSchedule = weeklyNeeded <= weeklyBudget;
  const pacingRatio = Math.min(100, Math.round((weeklyNeeded / Math.max(1, weeklyBudget)) * 100));
  const totalLessons = modules.reduce((n, m) => n + (m.lessons?.length || 0), 0);

  const activeModule = modules[activeModuleIndex] || modules[0] || null;

  const handleTitleChange = (val) => {
    setTitle(val);
    setHasUnsavedChanges(true);
  };

  const handleSummaryChange = (val) => {
    setSummary(val);
    setHasUnsavedChanges(true);
  };

  const handleModuleTitleChange = (modIndex, val) => {
    const updated = modules.map((m, idx) => (idx === modIndex ? { ...m, title: val } : m));
    setModules(updated);
    setHasUnsavedChanges(true);
  };

  const handleModuleObjectiveChange = (modIndex, val) => {
    const updated = modules.map((m, idx) => (idx === modIndex ? { ...m, objective: val } : m));
    setModules(updated);
    setHasUnsavedChanges(true);
  };

  async function saveChanges() {
    setSaving(true);
    const updated = { ...course, title, summary, modules };
    try {
      if (p.remote) {
        await p.request(`courses/${course.id}`, {
          method: "PUT",
          body: JSON.stringify({ title, summary }),
        });
        for (const mod of modules) {
          if (mod.id && !String(mod.id).startsWith("proposal-m")) {
            await p.request(`modules/${mod.id}`, {
              method: "PUT",
              body: JSON.stringify({ title: mod.title, objective: mod.objective }),
            });
          }
        }
        await p.refreshRemote();
      } else {
        p.updateData((d) => ({
          ...d,
          courses: d.courses.map((c) => (c.id === course.id ? updated : c)),
        }));
      }
      p.setProposal(updated);
      setHasUnsavedChanges(false);
      p.flashToast("Proposal changes saved.");
    } catch (error) {
      p.flashToast(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function improvePlan(event) {
    event.preventDefault();
    if (!p.remote) {
      p.openAccount();
      return;
    }
    setImproveError("");
    setImproving(true);
    setImproveProgress({ stage: "initializing", percent: 5, message: "Starting proposal revision…", model: "", provider: "" });

    const MAX_RETRIES = 3;
    let lastError = null;

    try {
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (attempt > 1) {
            setImproveProgress({
              stage: "retrying",
              percent: 15,
              message: `Refining revision format (retry ${attempt} of ${MAX_RETRIES})…`,
              model: "",
              provider: "",
            });
            await new Promise((r) => setTimeout(r, 1000));
          }

          const result = await p.requestStream(`courses/${course.id}/improve?stream=1`, {
            method: "POST",
            body: JSON.stringify({ feedback: improveText }),
          }, (frame) => {
            setImproveProgress((prev) => mergeStreamProgress(prev, frame, "Revising your course proposal…"));
          });

          if (!result?.course) {
            throw new Error("The revised proposal could not be loaded. Your current proposal is still available.");
          }
          p.setProposal(result.course);
          setImproveText("");
          p.flashToast("A revised draft is ready. Review it before approving.");
          return;
        } catch (err) {
          lastError = err;
          const errMsg = String(err?.message || "");
          const isJsonError =
            err?.code === "AI_INVALID_JSON" ||
            errMsg.toLowerCase().includes("not valid json") ||
            errMsg.toLowerCase().includes("invalid json");
          const isRetryable = isJsonError || err?.details?.retryable || err?.code === "AI_RATE_LIMIT";

          if (isRetryable && attempt < MAX_RETRIES) continue;
          break;
        }
      }
      setImproveError(lastError?.message || "The revision could not be generated. Your current proposal is still available.");
    } finally {
      setImproving(false);
      setImproveProgress(null);
    }
  }

  return (
    <div className="proposal-v2-container">
      {/* Top Navigation & Status */}
      <div className="proposal-v2-top-bar">
        <button
          type="button"
          className="proposal-v2-back-btn"
          onClick={() => p.go("courses")}
        >
          <Icon name="arrow-left" size={15} />
          <span>Back to courses</span>
        </button>

        <div className="proposal-v2-status-tag">
          <span className="proposal-v2-status-dot" />
          <span>Curriculum Blueprint · Reviewing</span>
        </div>
      </div>

      {/* Hero Bento Header Card */}
      <section className="proposal-v2-hero-card" aria-label="Course Overview">
        <div className="proposal-v2-hero-content">
          <div className="proposal-v2-eyebrow-row">
            <span className="proposal-v2-category-chip">
              <Icon name="spark" size={13} />
              <span>Tailored Learning Path</span>
            </span>
            {hasUnsavedChanges && (
              <span className="text-xs font-semibold text-[#E7B477] bg-[#242019] px-3 py-1 rounded-full border border-[#5C3926]">
                ● Unsaved changes
              </span>
            )}
          </div>

          <div>
            <label className="sr-only" htmlFor="proposal-course-title">Course Title</label>
            <input
              id="proposal-course-title"
              className="proposal-v2-title-input"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Course Title"
              title="Click to edit title"
            />
          </div>

          <div>
            <label className="sr-only" htmlFor="proposal-course-summary">Learning Outcome</label>
            <textarea
              id="proposal-course-summary"
              className="proposal-v2-summary-textarea"
              value={summary}
              onChange={(e) => handleSummaryChange(e.target.value)}
              placeholder="What practical capability will this course build?"
              title="Click to edit learning outcome"
            />
          </div>

          {/* Quick Metrics Strip */}
          <div className="proposal-v2-metrics-strip">
            <div className="proposal-v2-metric-chip">
              <span className="proposal-v2-metric-icon">
                <Icon name="calendar" size={15} />
              </span>
              <span>Duration: <strong>{weeks} weeks</strong></span>
            </div>

            <div className="proposal-v2-metric-chip">
              <span className="proposal-v2-metric-icon">
                <Icon name="clock" size={15} />
              </span>
              <span>Estimated effort: <strong>{totalHours} hrs</strong></span>
            </div>

            <div className="proposal-v2-metric-chip">
              <span className="proposal-v2-metric-icon">
                <Icon name="book" size={15} />
              </span>
              <span>Structure: <strong>{modules.length} modules</strong></span>
            </div>

            <div className="proposal-v2-metric-chip">
              <span className="proposal-v2-metric-icon">
                <Icon name="check" size={15} />
              </span>
              <span>Content: <strong>{totalLessons} lessons</strong></span>
            </div>
          </div>
        </div>
      </section>

      {/* Bento Middle Grid: Pacing, Refine, and Assumptions */}
      <div className="proposal-v2-bento-grid">
        {/* Pacing & Schedule Sync Card */}
        <div className="proposal-v2-bento-card proposal-v2-col-4">
          <div className="proposal-v2-card-header">
            <div className="proposal-v2-card-title">
              <span className="proposal-v2-card-title-icon">
                <Icon name="clock" size={17} />
              </span>
              <span>Weekly Pacing</span>
            </div>
            <span className={`proposal-v2-pacing-badge ${fitsSchedule ? "fits" : ""}`}>
              {fitsSchedule ? "✓ Fits routine" : "⚠ Pacing check"}
            </span>
          </div>

          <div className={`proposal-v2-pacing-status ${fitsSchedule ? "fits" : ""}`}>
            <div className="proposal-v2-pacing-bar-track">
              <div
                className="proposal-v2-pacing-bar-fill"
                style={{ width: `${Math.min(100, pacingRatio)}%` }}
              />
            </div>

            <div className="proposal-v2-pacing-stats">
              <span>Required: <strong>{weeklyNeededHours} hrs / wk</strong></span>
              <span>Budget: <strong>{weeklyBudgetHours} hrs / wk</strong></span>
            </div>
          </div>

          <p className="text-xs text-[#A69B8E] leading-relaxed m-0">
            {fitsSchedule
              ? "This proposal fits comfortably inside your weekly learning schedule."
              : "This curriculum requires more time than your current budget. You can request a slower pace or increase study hours."}
          </p>
        </div>

        {/* Refine & Customize Card (No AI Slop) */}
        <div className="proposal-v2-bento-card proposal-v2-col-4">
          <div className="proposal-v2-card-header">
            <div className="proposal-v2-card-title">
              <span className="proposal-v2-card-title-icon">
                <Icon name="spark" size={17} />
              </span>
              <span>Request Adjustments</span>
            </div>
          </div>

          <form className="proposal-v2-refine-form" onSubmit={improvePlan}>
            <textarea
              className="proposal-v2-refine-textarea"
              value={improveText}
              onChange={(e) => setImproveText(e.target.value)}
              disabled={improving}
              maxLength="1200"
              minLength="8"
              required
              placeholder="e.g. Add more hands-on coding drills, slow down the first module, or add realistic projects."
            />

            {improving && (
              <GenerationProgressCard
                progress={improveProgress}
                fallbackMessage="Revising your course blueprint…"
                ariaLabel="Course revision progress"
                note="Refining modules and lessons according to your feedback. Your current draft remains active."
              />
            )}

            <button
              type="submit"
              className="proposal-v2-refine-btn"
              disabled={improving || p.busy || !improveText.trim()}
            >
              {improving ? (
                <>
                  <span className="btn-spinner" />
                  <span>Revising curriculum…</span>
                </>
              ) : (
                <span>Request revisions ↗</span>
              )}
            </button>

            {improveError && (
              <p className="form-error text-xs text-rose-400 m-0" role="alert">
                {improveError}
              </p>
            )}
          </form>
        </div>

        {/* Course Assumptions & Focus Card */}
        <div className="proposal-v2-bento-card proposal-v2-col-4">
          <div className="proposal-v2-card-header">
            <div className="proposal-v2-card-title">
              <span className="proposal-v2-card-title-icon">
                <Icon name="notes" size={17} />
              </span>
              <span>Curriculum Notes</span>
            </div>
          </div>

          <ul className="proposal-v2-assumptions-list">
            {(course.assumptions || [
              "Backward design progression from core intuition to applied synthesis.",
              "Weekly milestone checkpoints verify demonstrated capability.",
              "Pacing calibrated for consistent daily practice intervals."
            ]).map((item, idx) => (
              <li key={idx} className="proposal-v2-assumption-item">
                <span className="proposal-v2-assumption-bullet">›</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Unique Roadmap Journey Visualizer */}
      <section className="proposal-v2-roadmap-container" aria-label="Curriculum Roadmap">
        <div className="proposal-v2-roadmap-header">
          <div className="proposal-v2-roadmap-title-area">
            <h2 className="proposal-v2-roadmap-title">
              <Icon name="book" size={20} />
              <span>Interactive Learning Roadmap</span>
            </h2>
            <span className="proposal-v2-roadmap-subtitle">
              Follow the connected milestones from foundational concepts to capstone execution.
            </span>
          </div>

          <div className="proposal-v2-view-switcher">
            <button
              type="button"
              className={`proposal-v2-view-btn ${viewMode === "milestone" ? "active" : ""}`}
              onClick={() => setViewMode("milestone")}
            >
              Milestone View
            </button>
            <button
              type="button"
              className={`proposal-v2-view-btn ${viewMode === "all" ? "active" : ""}`}
              onClick={() => setViewMode("all")}
            >
              Full Blueprint
            </button>
          </div>
        </div>

        {/* Milestone View: Connected Subway Milestones Rail */}
        {viewMode === "milestone" ? (
          <>
            <div className="proposal-v2-milestones-rail" role="tablist" aria-label="Milestones Rail">
              {modules.map((m, idx) => {
                const isActive = activeModuleIndex === idx;
                const modHours = Math.round(((m.estimatedMinutes || m.estimated_minutes || 0) / 60) * 10) / 10 || 1;
                return (
                  <React.Fragment key={m.id || idx}>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      className={`proposal-v2-milestone-node ${isActive ? "active" : ""}`}
                      onClick={() => setActiveModuleIndex(idx)}
                    >
                      <div className="proposal-v2-node-number">{String(idx + 1).padStart(2, "0")}</div>
                      <div className="proposal-v2-node-info">
                        <span className="proposal-v2-node-title">{m.title}</span>
                        <span className="proposal-v2-node-meta">
                          {m.lessons?.length || 0} lessons · {modHours} hrs
                        </span>
                      </div>
                    </button>
                    {idx < modules.length - 1 && (
                      <span className="proposal-v2-milestone-arrow">
                        <Icon name="arrow-right" size={14} />
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Active Module Spotlight Card */}
            {activeModule && (
              <div className="proposal-v2-module-spotlight">
                <div className="proposal-v2-module-header">
                  <div className="flex-1 min-w-0">
                    <span className="proposal-v2-module-tag">
                      Module {String(activeModuleIndex + 1).padStart(2, "0")} of {String(modules.length).padStart(2, "0")}
                    </span>

                    <input
                      className="proposal-v2-module-title-input"
                      value={activeModule.title}
                      onChange={(e) => handleModuleTitleChange(activeModuleIndex, e.target.value)}
                      title="Edit module title"
                    />

                    <textarea
                      className="proposal-v2-module-obj-input"
                      value={activeModule.objective || ""}
                      onChange={(e) => handleModuleObjectiveChange(activeModuleIndex, e.target.value)}
                      placeholder="Module objective"
                      title="Edit module objective"
                    />
                  </div>
                </div>

                <div className="proposal-v2-module-rationale">
                  <strong className="text-[#E7B477] mr-1.5 font-semibold">Pedagogical Rationale:</strong>
                  {activeModule.rationale || "Builds prerequisite competency required for applied mastery in downstream modules."}
                </div>

                {/* Lesson Cards Grid */}
                <div className="proposal-v2-lessons-grid">
                  {(activeModule.lessons || []).map((lesson, lIdx) => (
                    <article key={lesson.id || lIdx} className="proposal-v2-lesson-card">
                      <div className="proposal-v2-lesson-top">
                        <span className="proposal-v2-lesson-badge">{lIdx + 1}</span>
                        <div className="proposal-v2-lesson-text">
                          <h4 className="proposal-v2-lesson-title">{lesson.title}</h4>
                          <p className="proposal-v2-lesson-obj">{lesson.objective}</p>
                        </div>
                      </div>

                      <div className="proposal-v2-lesson-footer">
                        <span className="proposal-v2-duration-chip">
                          <Icon name="clock" size={13} />
                          <span>{minuteLabel(lesson.estimated_minutes || lesson.estimatedMinutes || 25)}</span>
                        </span>

                        <span className="proposal-v2-checkpoint-chip">
                          <Icon name="check" size={12} />
                          <span>Check</span>
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Full Blueprint View: All modules rendered in interconnected vertical sequence */
          <div className="flex flex-col gap-6">
            {modules.map((m, mIdx) => (
              <div key={m.id || mIdx} className="proposal-v2-module-spotlight">
                <div className="proposal-v2-module-header">
                  <div className="flex-1 min-w-0">
                    <span className="proposal-v2-module-tag">
                      Module {String(mIdx + 1).padStart(2, "0")} · {m.lessons?.length || 0} lessons
                    </span>
                    <h3 className="text-lg font-bold text-[#F4EFE8] mt-1">{m.title}</h3>
                    <p className="text-sm text-[#A69B8E] mt-1">{m.objective}</p>
                  </div>
                </div>

                <div className="proposal-v2-lessons-grid">
                  {(m.lessons || []).map((lesson, lIdx) => (
                    <article key={lesson.id || lIdx} className="proposal-v2-lesson-card">
                      <div className="proposal-v2-lesson-top">
                        <span className="proposal-v2-lesson-badge">{lIdx + 1}</span>
                        <div className="proposal-v2-lesson-text">
                          <h4 className="proposal-v2-lesson-title">{lesson.title}</h4>
                          <p className="proposal-v2-lesson-obj">{lesson.objective}</p>
                        </div>
                      </div>

                      <div className="proposal-v2-lesson-footer">
                        <span className="proposal-v2-duration-chip">
                          <Icon name="clock" size={13} />
                          <span>{minuteLabel(lesson.estimated_minutes || lesson.estimatedMinutes || 25)}</span>
                        </span>
                        <span className="proposal-v2-checkpoint-chip">
                          <Icon name="check" size={12} />
                          <span>Check</span>
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Floating / Sticky Action Bar */}
      <div className="proposal-v2-action-bar">
        <div className="proposal-v2-action-left">
          <button
            type="button"
            className="text-xs text-[#A69B8E] hover:text-[#F4EFE8] transition-colors bg-transparent border-none cursor-pointer"
            onClick={() => p.go("create/course")}
          >
            ← Change goal parameters
          </button>
        </div>

        <div className="proposal-v2-action-right">
          {p.confirmDeleteCourse && (
            <button
              type="button"
              className="proposal-v2-danger-btn"
              disabled={saving || improving || p.busy || p.deletingCourseId === course.id}
              onClick={() => p.confirmDeleteCourse(course, "courses")}
            >
              <Icon name="trash" size={14} />
              <span>Delete</span>
            </button>
          )}

          <button
            type="button"
            className="proposal-v2-secondary-btn"
            disabled={saving || improving}
            onClick={saveChanges}
          >
            {saving ? (
              <>
                <span className="btn-spinner" />
                <span>Saving…</span>
              </>
            ) : (
              <span>Save edits</span>
            )}
          </button>

          <button
            type="button"
            className="proposal-v2-primary-btn"
            disabled={p.busy || improving}
            onClick={() => p.approveProposal(false, { ...course, title, summary, modules })}
          >
            {p.busy ? (
              <>
                <span className="btn-spinner" />
                <span>Approving blueprint…</span>
              </>
            ) : (
              <span>Approve & start learning ↗</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
