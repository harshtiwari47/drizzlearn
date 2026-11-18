import React, { useState, useMemo } from "react";
import { Icon, minuteLabel, EmptyState } from "../components/common.jsx";

/**
 * CoursePage (Course Roadmap / Detail) - Modern 2026 Redesign
 * 
 * Trending design architecture:
 * - Ambient glassmorphism with multi-layered depth and glow
 * - High-impact Bento Grid Hub (Spotlight Next-Up Card, Circular Radial Progress Ring, Pace & Metrics, Quick Utilities Dock)
 * - Interactive Sequential Roadmap with dual view modes ("By Module" & "Timeline View"), status filters, and instant lesson search
 * - Milestone timeline spine with glowing states (Completed, Next Up, Planned)
 * - Zero AI slop, pure authentic learner data, authentic SVG icons only
 * - Multi-breakpoint responsive (480px, 768px, 1024px, 1280px, 1536px, 1920px)
 */
export function CoursePage(p) {
  const courseId = p.routeParams?.courseId;
  const course = (courseId && p.data?.courses?.find(c => c.id === courseId)) || p.activeCourse;

  // View state: "modules" (grouped by module) | "timeline" (continuous linear sequence)
  const [viewMode, setViewMode] = useState("modules");
  // Status filter: "all" | "in_progress" | "completed"
  const [statusFilter, setStatusFilter] = useState("all");
  // In-roadmap lesson search query
  const [searchQuery, setSearchQuery] = useState("");

  // Track expanded modules in accordion
  const [expandedModules, setExpandedModules] = useState(() => {
    const set = new Set();
    if (course?.modules?.length) {
      // Default: expand all if 3 or fewer modules, otherwise first module
      if (course.modules.length <= 3) {
        course.modules.forEach(m => set.add(m.id || m.title));
      } else {
        set.add(course.modules[0].id || course.modules[0].title);
      }
    }
    return set;
  });

  if (!course) {
    return (
      <div className="course-v2-container">
        <EmptyState
          title="No course found"
          body="Select an active course from your workspace or create a personalized learning plan to see your roadmap here."
          action="Back to My Courses"
          onAction={() => p.go("courses")}
        />
      </div>
    );
  }

  // Modules & Flattened Lessons
  const modules = useMemo(() => course.modules || [], [course.modules]);
  const allLessons = useMemo(() => {
    return modules.flatMap((m, mIdx) =>
      (m.lessons || []).map((l, lIdx) => ({
        ...l,
        moduleId: m.id || `mod-${mIdx}`,
        moduleTitle: m.title || `Module ${mIdx + 1}`,
        moduleIndex: mIdx,
        lessonIndex: lIdx,
      }))
    );
  }, [modules]);

  const totalLessons = allLessons.length;

  // Compute completed lessons accurately
  const completedLessonIds = useMemo(() => {
    const set = new Set();
    const tasks = p.data?.tasks || [];
    tasks.forEach(t => {
      if (t.course_id === course.id && t.lesson_id && t.status === "completed") {
        set.add(t.lesson_id);
      }
    });
    const attempts = p.data?.attempts || [];
    attempts.forEach(a => {
      if (a.lesson_id && (a.completed || a.score >= 0.7)) {
        set.add(a.lesson_id);
      }
    });
    return set;
  }, [p.data?.tasks, p.data?.attempts, course.id]);

  const completedCount = useMemo(() => {
    return allLessons.filter(l => completedLessonIds.has(l.id)).length;
  }, [allLessons, completedLessonIds]);

  const progressPercent = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  // Find next lesson to tackle
  const nextLesson = useMemo(() => {
    return allLessons.find(l => !completedLessonIds.has(l.id)) || null;
  }, [allLessons, completedLessonIds]);

  // Tasks related to this course
  const courseTasks = useMemo(() => {
    return (p.data?.tasks || []).filter(t => t.course_id === course.id);
  }, [p.data?.tasks, course.id]);

  const practiceTasks = useMemo(() => {
    return courseTasks.filter(t => t.task_type === "practice" || t.task_type === "checkpoint");
  }, [courseTasks]);

  const completedPracticeCount = practiceTasks.filter(t => t.status === "completed").length;

  // Associated study tools counts
  const courseNotes = useMemo(() => {
    return (p.data?.notes || []).filter(n => n.course_id === course.id);
  }, [p.data?.notes, course.id]);

  const courseFlashcards = useMemo(() => {
    return (p.data?.flashcards || []).filter(f => f.course_id === course.id);
  }, [p.data?.flashcards, course.id]);

  const dueFlashcardsCount = useMemo(() => {
    const now = new Date();
    return courseFlashcards.filter(f => !f.due_at || new Date(f.due_at) <= now).length;
  }, [courseFlashcards]);

  // Timing and pacing
  const totalMinutes = useMemo(() => {
    return allLessons.reduce((acc, l) => acc + (Number(l.estimated_minutes) || 25), 0);
  }, [allLessons]);
  const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
  const targetWeeks = Number(course.target_weeks || course.durationWeeks || 8);
  const weeklyMinutes = Math.ceil(totalMinutes / Math.max(1, targetWeeks));
  const weeklyHours = Math.round((weeklyMinutes / 60) * 10) / 10;

  const isGenerating = Boolean(
    (course.id && course.id === p.generatingCourseId) ||
    course.materials_status === "generating" ||
    course.isGenerating ||
    course.materialsGenerating
  );

  // Status toggle handler
  async function toggleStatus() {
    const nextStatus = course.status === "paused" ? "active" : "paused";
    try {
      if (p.remote) {
        await p.request(`courses/${course.id}`, {
          method: "PUT",
          body: JSON.stringify({
            title: course.title,
            summary: course.summary || course.desired_outcome,
            status: nextStatus
          })
        });
      }
      p.updateData(d => ({
        ...d,
        courses: d.courses.map(c => c.id === course.id ? { ...c, status: nextStatus } : c)
      }));
      if (p.remote) await p.refreshRemote();
      p.flashToast(nextStatus === "paused" ? "Course paused. Your progress and notes are kept safe." : "Course resumed!");
    } catch (e) {
      p.flashToast(e.message || "Failed to update course status.");
    }
  }

  // Module expansion helpers
  const toggleModule = (modKey) => {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(modKey)) next.delete(modKey);
      else next.add(modKey);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedModules(new Set(modules.map(m => m.id || m.title)));
  };

  const collapseAll = () => {
    setExpandedModules(new Set());
  };

  // Filter lessons according to search and status
  const filterLesson = (lesson) => {
    const isCompleted = completedLessonIds.has(lesson.id);
    if (statusFilter === "completed" && !isCompleted) return false;
    if (statusFilter === "in_progress" && isCompleted) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (lesson.title || "").toLowerCase().includes(q);
      const matchObj = (lesson.objective || "").toLowerCase().includes(q);
      if (!matchTitle && !matchObj) return false;
    }
    return true;
  };

  // Circumference for radial progress ring (radius 44 => 2 * pi * 44 ≈ 276.46)
  const strokeDashoffset = 276.46 - (276.46 * progressPercent) / 100;

  return (
    <div className="course-v2-container">
      {/* Ambient background glow elements */}
      <div className="course-v2-ambient-glow-top" aria-hidden="true" />
      <div className="course-v2-ambient-glow-side" aria-hidden="true" />

      {/* Top Header Navigation Bar */}
      <header className="course-v2-header">
        <div className="course-v2-header-nav">
          <button
            type="button"
            className="course-v2-circle-back-btn"
            onClick={() => p.go("courses")}
            aria-label="Back to My Courses"
          >
            <Icon name="arrow-left" size={16} />
          </button>

          <nav className="course-v2-breadcrumbs" aria-label="Breadcrumb">
            <button type="button" onClick={() => p.go("home")} className="course-v2-crumb-link">
              Home
            </button>
            <span className="course-v2-crumb-sep">/</span>
            <button type="button" onClick={() => p.go("courses")} className="course-v2-crumb-link">
              My Courses
            </button>
            <span className="course-v2-crumb-sep">/</span>
            <span className="course-v2-crumb-current" title={course.title}>
              {course.title}
            </span>
          </nav>
        </div>

        <div className="course-v2-header-actions">
          {isGenerating && (
            <div className="course-v2-generating-badge" role="status" aria-live="polite">
              <span className="course-v2-pulse-dot" aria-hidden="true" />
              <span>Generating study materials in background…</span>
            </div>
          )}

          <div className="course-v2-status-tag" data-status={course.status || "active"}>
            <span className="course-v2-status-dot" aria-hidden="true" />
            <span className="capitalize">{course.status || "active"}</span>
          </div>

          {["active", "paused"].includes(course.status) && (
            <button
              type="button"
              className="course-v2-ghost-action-btn"
              onClick={toggleStatus}
            >
              {course.status === "paused" ? "Resume course" : "Pause course"}
            </button>
          )}

          {p.confirmDeleteCourse && (
            <button
              type="button"
              className="course-v2-danger-action-btn"
              disabled={p.deletingCourseId === course.id}
              onClick={() => p.confirmDeleteCourse(course, "courses")}
              aria-label="Delete course"
              title="Delete this course and its local materials"
            >
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      </header>

      {/* Hero Overview Card */}
      <section className="course-v2-hero-card">
        <div className="course-v2-hero-body">
          <div className="course-v2-hero-meta-row">
            <span className="course-v2-hero-kicker">Course Blueprint</span>
            <div className="course-v2-hero-chips">
              <span className="course-v2-hero-chip">
                <Icon name="calendar" size={13} />
                <span>{targetWeeks} weeks</span>
              </span>
              <span className="course-v2-hero-chip">
                <Icon name="book" size={13} />
                <span>{totalLessons} lessons</span>
              </span>
              <span className="course-v2-hero-chip">
                <Icon name="clock" size={13} />
                <span>{totalHours} hrs estimated</span>
              </span>
            </div>
          </div>

          <h1 className="course-v2-title">{course.title}</h1>

          {(course.summary || course.desired_outcome) && (
            <p className="course-v2-desc">
              {course.summary || course.desired_outcome}
            </p>
          )}
        </div>
      </section>

      {/* Modern Trending Bento Grid Hub */}
      <section className="course-v2-bento-grid" aria-label="Course Highlights and Utilities">
        
        {/* Bento 1: Primary "Next Up" / "Continue Learning" Spotlight Card */}
        <div className="course-v2-bento-card course-v2-col-7 course-v2-spotlight-card">
          <div className="course-v2-card-glow" aria-hidden="true" />
          <div className="course-v2-spotlight-inner">
            <div className="course-v2-spotlight-head">
              <span className="course-v2-card-badge">
                <Icon name="play" size={11} />
                <span>{nextLesson ? "Up Next" : "Completed"}</span>
              </span>
              <span className="course-v2-spotlight-meta">
                {completedCount} of {totalLessons} lessons completed
              </span>
            </div>

            {nextLesson ? (
              <div className="course-v2-next-lesson-wrap">
                <span className="course-v2-next-lesson-mod">{nextLesson.moduleTitle}</span>
                <h3 className="course-v2-next-lesson-title">{nextLesson.title}</h3>
                {nextLesson.objective && (
                  <p className="course-v2-next-lesson-desc">{nextLesson.objective}</p>
                )}

                <div className="course-v2-next-actions-row">
                  <button
                    type="button"
                    className="course-v2-primary-cta-btn"
                    onClick={() => p.openLesson(nextLesson.id)}
                  >
                    <span>{completedCount === 0 ? "Start First Lesson" : "Continue Learning"}</span>
                    <Icon name="arrow-right" size={16} />
                  </button>
                  <span className="course-v2-next-duration">
                    <Icon name="clock" size={14} />
                    <span>{minuteLabel(nextLesson.estimated_minutes || 25)}</span>
                  </span>
                </div>
              </div>
            ) : (
              <div className="course-v2-completed-all-wrap">
                <div className="course-v2-completed-icon">
                  <Icon name="check" size={24} />
                </div>
                <div>
                  <h3 className="course-v2-completed-title">All Milestones Achieved!</h3>
                  <p className="course-v2-completed-desc">
                    You have completed all lessons in this curriculum. You can review any session or practice checkpoints.
                  </p>
                </div>
              </div>
            )}

            {/* Linear Progress Bar Track */}
            <div className="course-v2-progress-track-wrap">
              <div
                className="course-v2-progress-track"
                role="progressbar"
                aria-valuenow={progressPercent}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-label="Course completion percentage"
              >
                <div
                  className="course-v2-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="course-v2-progress-track-labels">
                <span>Course Progress</span>
                <span className="font-mono">{progressPercent}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bento 2: Radial Mastery & Checkpoints Card */}
        <div className="course-v2-bento-card course-v2-col-5 course-v2-radial-card">
          <div className="course-v2-radial-head">
            <h3 className="course-v2-card-title">
              <Icon name="progress" size={16} />
              <span>Overall Mastery</span>
            </h3>
            <button
              type="button"
              className="course-v2-quiet-link-btn"
              onClick={() => p.go("progress", { query: { course: course.id } })}
            >
              <span>Details</span>
              <Icon name="arrow-right" size={12} />
            </button>
          </div>

          <div className="course-v2-radial-body">
            <div className="course-v2-donut-wrap">
              <svg className="course-v2-donut-svg" width="108" height="108" viewBox="0 0 108 108">
                <defs>
                  <linearGradient id="courseProgressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00e5ff" />
                    <stop offset="60%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#34d399" />
                  </linearGradient>
                </defs>
                <circle
                  className="course-v2-donut-bg"
                  cx="54"
                  cy="54"
                  r="44"
                />
                <circle
                  className="course-v2-donut-meter"
                  cx="54"
                  cy="54"
                  r="44"
                  style={{ strokeDashoffset }}
                  stroke="url(#courseProgressGrad)"
                />
              </svg>
              <div className="course-v2-donut-text">
                <span className="course-v2-donut-value">{progressPercent}%</span>
                <span className="course-v2-donut-sub">mastered</span>
              </div>
            </div>

            <div className="course-v2-donut-stats">
              <div className="course-v2-stat-pair">
                <span className="course-v2-stat-num">{completedCount}/{totalLessons}</span>
                <span className="course-v2-stat-label">Lessons Done</span>
              </div>
              <div className="course-v2-stat-divider" aria-hidden="true" />
              <div className="course-v2-stat-pair">
                <span className="course-v2-stat-num">{completedPracticeCount}/{practiceTasks.length || 0}</span>
                <span className="course-v2-stat-label">Checkpoints</span>
              </div>
            </div>
          </div>
        </div>

        {/* Bento 3: Weekly Pace & Schedule Card */}
        <div className="course-v2-bento-card course-v2-col-4 course-v2-pace-card">
          <h3 className="course-v2-card-title">
            <Icon name="clock" size={16} />
            <span>Target Pacing</span>
          </h3>

          <div className="course-v2-pace-content">
            <div className="course-v2-pace-hero-metric">
              <span className="course-v2-pace-val">~{weeklyHours}</span>
              <span className="course-v2-pace-unit">hrs / week</span>
            </div>
            <p className="course-v2-pace-note">
              Paced over {targetWeeks} weeks to fit your routine with small, repeatable sessions.
            </p>
            <button
              type="button"
              className="course-v2-secondary-link-btn"
              onClick={() => p.go("today")}
            >
              <Icon name="calendar" size={14} />
              <span>View in Daily Plan</span>
            </button>
          </div>
        </div>

        {/* Bento 4: Quick Study Tools Dock */}
        <div className="course-v2-bento-card course-v2-col-8 course-v2-tools-dock-card">
          <div className="course-v2-tools-head">
            <h3 className="course-v2-card-title">
              <Icon name="spark" size={16} />
              <span>Course Study Tools</span>
            </h3>
            <span className="course-v2-tools-sub">Direct access to course resources</span>
          </div>

          <div className="course-v2-tools-grid">
            {/* Tool 1: Notes */}
            <button
              type="button"
              className="course-v2-tool-tile"
              onClick={() => p.go("notes", { query: { course: course.id } })}
            >
              <span className="course-v2-tool-icon">
                <Icon name="notes" size={18} />
              </span>
              <div className="course-v2-tool-text">
                <strong className="course-v2-tool-name">Course Notes</strong>
                <span className="course-v2-tool-count">{courseNotes.length} notes drafted</span>
              </div>
              <Icon name="arrow-right" size={14} className="course-v2-tool-arrow" />
            </button>

            {/* Tool 2: Flashcards */}
            <button
              type="button"
              className="course-v2-tool-tile"
              onClick={() => p.go("flashcards", { query: { course: course.id } })}
            >
              <span className="course-v2-tool-icon">
                <Icon name="cards" size={18} />
              </span>
              <div className="course-v2-tool-text">
                <strong className="course-v2-tool-name">Flashcards</strong>
                <span className="course-v2-tool-count">
                  {courseFlashcards.length} cards {dueFlashcardsCount > 0 && `(${dueFlashcardsCount} due)`}
                </span>
              </div>
              <Icon name="arrow-right" size={14} className="course-v2-tool-arrow" />
            </button>

            {/* Tool 3: Practice Studio */}
            <button
              type="button"
              className="course-v2-tool-tile"
              onClick={() => p.go("practice", { query: { course: course.id } })}
            >
              <span className="course-v2-tool-icon">
                <Icon name="practice" size={18} />
              </span>
              <div className="course-v2-tool-text">
                <strong className="course-v2-tool-name">Practice Studio</strong>
                <span className="course-v2-tool-count">
                  {practiceTasks.length} checkpoints
                </span>
              </div>
              <Icon name="arrow-right" size={14} className="course-v2-tool-arrow" />
            </button>

            {/* Tool 4: AI Tutor */}
            <button
              type="button"
              className="course-v2-tool-tile"
              onClick={() => p.go("tutor", { query: { course: course.id } })}
            >
              <span className="course-v2-tool-icon">
                <Icon name="tutor" size={18} />
              </span>
              <div className="course-v2-tool-text">
                <strong className="course-v2-tool-name">Ask AI Tutor</strong>
                <span className="course-v2-tool-count">Grounded in this course</span>
              </div>
              <Icon name="arrow-right" size={14} className="course-v2-tool-arrow" />
            </button>
          </div>
        </div>

      </section>

      {/* Course Roadmap Main Section */}
      <section className="course-v2-roadmap-section" aria-label="Course Curriculum Roadmap">
        
        {/* Roadmap Toolbar & Controls */}
        <div className="course-v2-roadmap-header">
          <div className="course-v2-roadmap-title-wrap">
            <h2 className="course-v2-section-title">Course Roadmap</h2>
            <p className="course-v2-section-subtitle">
              Follow the connected milestones from foundational concepts to capstone execution.
            </p>
          </div>

          <div className="course-v2-roadmap-controls">
            {/* View Switcher: By Module vs All Lessons Timeline */}
            <div className="course-v2-pill-switcher" role="tablist" aria-label="Roadmap View Options">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "modules"}
                className={`course-v2-switch-btn ${viewMode === "modules" ? "active" : ""}`}
                onClick={() => setViewMode("modules")}
              >
                By Module
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "timeline"}
                className={`course-v2-switch-btn ${viewMode === "timeline" ? "active" : ""}`}
                onClick={() => setViewMode("timeline")}
              >
                Timeline View
              </button>
            </div>

            {/* Status Filters */}
            <div className="course-v2-filter-group">
              <button
                type="button"
                className={`course-v2-filter-chip ${statusFilter === "all" ? "active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={`course-v2-filter-chip ${statusFilter === "in_progress" ? "active" : ""}`}
                onClick={() => setStatusFilter("in_progress")}
              >
                To Do
              </button>
              <button
                type="button"
                className={`course-v2-filter-chip ${statusFilter === "completed" ? "active" : ""}`}
                onClick={() => setStatusFilter("completed")}
              >
                Done
              </button>
            </div>

            {/* Search Input */}
            <div className="course-v2-search-box">
              <Icon name="search" size={14} className="course-v2-search-icon" />
              <input
                type="text"
                placeholder="Filter lessons…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="course-v2-search-input"
                aria-label="Search lessons in roadmap"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="course-v2-search-clear"
                  aria-label="Clear filter search"
                >
                  ×
                </button>
              )}
            </div>

            {viewMode === "modules" && (
              <div className="course-v2-expand-controls">
                <button
                  type="button"
                  onClick={expandAll}
                  className="course-v2-text-control-btn"
                >
                  Expand All
                </button>
                <span className="course-v2-control-sep">·</span>
                <button
                  type="button"
                  onClick={collapseAll}
                  className="course-v2-text-control-btn"
                >
                  Collapse All
                </button>
              </div>
            )}
          </div>
        </div>

        {/* View Mode 1: By Module (Milestone Accordion View) */}
        {viewMode === "modules" && (
          <div className="course-v2-modules-stack">
            {modules.map((mod, modIdx) => {
              const modKey = mod.id || mod.title || `module-${modIdx}`;
              const isExpanded = expandedModules.has(modKey);
              const modLessons = (mod.lessons || []).filter(filterLesson);
              const allModLessons = mod.lessons || [];
              const modCompletedCount = allModLessons.filter(l => completedLessonIds.has(l.id)).length;
              const isModCompleted = allModLessons.length > 0 && modCompletedCount === allModLessons.length;
              const isModInProgress = modCompletedCount > 0 && !isModCompleted;

              if (searchQuery && modLessons.length === 0) return null;

              return (
                <div
                  key={modKey}
                  className={`course-v2-module-card ${isExpanded ? "open" : ""} ${isModCompleted ? "module-complete" : ""}`}
                >
                  {/* Module Accordion Head */}
                  <button
                    type="button"
                    className="course-v2-module-head"
                    onClick={() => toggleModule(modKey)}
                    aria-expanded={isExpanded}
                  >
                    <div className="course-v2-mod-index-wrap">
                      <span className={`course-v2-mod-badge ${isModCompleted ? "done" : isModInProgress ? "active" : ""}`}>
                        {isModCompleted ? <Icon name="check" size={14} /> : String(modIdx + 1).padStart(2, "0")}
                      </span>
                    </div>

                    <div className="course-v2-mod-head-info">
                      <div className="course-v2-mod-title-row">
                        <h3 className="course-v2-mod-title">{mod.title}</h3>
                        {isModCompleted && (
                          <span className="course-v2-mod-pill completed">Completed</span>
                        )}
                        {isModInProgress && (
                          <span className="course-v2-mod-pill in-progress">In Progress</span>
                        )}
                      </div>
                      {mod.objective && (
                        <p className="course-v2-mod-objective">{mod.objective}</p>
                      )}
                    </div>

                    <div className="course-v2-mod-meta-wrap">
                      <span className="course-v2-mod-stats-text">
                        {modCompletedCount}/{allModLessons.length} lessons
                      </span>
                      <div className="course-v2-mod-mini-progress">
                        <div
                          className="course-v2-mod-mini-fill"
                          style={{
                            width: `${allModLessons.length > 0 ? (modCompletedCount / allModLessons.length) * 100 : 0}%`
                          }}
                        />
                      </div>
                      <span className={`course-v2-chevron ${isExpanded ? "rotated" : ""}`} aria-hidden="true">
                        <Icon name="chevron" size={16} />
                      </span>
                    </div>
                  </button>

                  {/* Module Lessons List (Connected Timeline Spine) */}
                  {isExpanded && (
                    <div className="course-v2-module-body">
                      {modLessons.length === 0 ? (
                        <div className="course-v2-no-lessons-msg">
                          No lessons match the active filters in this module.
                        </div>
                      ) : (
                        <div className="course-v2-lessons-timeline">
                          <div className="course-v2-timeline-spine" aria-hidden="true" />
                          {modLessons.map((lesson, lessonIdx) => {
                            const isDone = completedLessonIds.has(lesson.id);
                            const isNext = nextLesson?.id === lesson.id;
                            const lessonTasks = courseTasks.filter(t => t.lesson_id === lesson.id);
                            const practiceTask = lessonTasks.find(t => t.task_type === "practice" || t.task_type === "checkpoint");

                            return (
                              <div
                                key={lesson.id || lessonIdx}
                                className={`course-v2-lesson-row ${isDone ? "is-done" : ""} ${isNext ? "is-next" : ""}`}
                              >
                                {/* Timeline Spine Node */}
                                <div className="course-v2-lesson-node">
                                  {isDone ? (
                                    <span className="course-v2-node-icon done" title="Lesson Completed">
                                      <Icon name="check" size={12} />
                                    </span>
                                  ) : isNext ? (
                                    <span className="course-v2-node-icon next" title="Up Next">
                                      <span className="course-v2-node-ping" />
                                    </span>
                                  ) : (
                                    <span className="course-v2-node-icon planned" title="Planned Lesson">
                                      <span className="course-v2-node-dot" />
                                    </span>
                                  )}
                                </div>

                                {/* Lesson Content Box */}
                                <div className="course-v2-lesson-card">
                                  <div className="course-v2-lesson-main">
                                    <div className="course-v2-lesson-header">
                                      <h4 className="course-v2-lesson-title">{lesson.title}</h4>
                                      {isNext && (
                                        <span className="course-v2-lesson-tag next">Up Next</span>
                                      )}
                                      {isDone && (
                                        <span className="course-v2-lesson-tag done">Done</span>
                                      )}
                                    </div>

                                    {lesson.objective && (
                                      <p className="course-v2-lesson-desc">{lesson.objective}</p>
                                    )}

                                    <div className="course-v2-lesson-chips">
                                      <span className="course-v2-lesson-chip">
                                        <Icon name="clock" size={12} />
                                        <span>{minuteLabel(lesson.estimated_minutes || 25)}</span>
                                      </span>

                                      {practiceTask && (
                                        <span className={`course-v2-lesson-chip practice ${practiceTask.status === "completed" ? "practice-done" : ""}`}>
                                          <Icon name="practice" size={12} />
                                          <span>Checkpoint: {practiceTask.status === "completed" ? "Passed" : "Available"}</span>
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="course-v2-lesson-actions">
                                    {practiceTask && (
                                      <button
                                        type="button"
                                        className="course-v2-quiet-practice-btn"
                                        onClick={() => {
                                          p.setActiveLessonId?.(lesson.id);
                                          p.go("practice", { params: { lessonId: lesson.id } });
                                        }}
                                      >
                                        <span>Practice</span>
                                        <Icon name="arrow-right" size={12} />
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      className={`course-v2-lesson-launch-btn ${isNext ? "cta" : isDone ? "reviewed" : ""}`}
                                      onClick={() => p.openLesson(lesson.id)}
                                      aria-label={`Open lesson: ${lesson.title}`}
                                    >
                                      <span>{isDone ? "Review" : isNext ? "Continue" : "Start"}</span>
                                      <Icon name="arrow-right" size={13} />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* View Mode 2: Sequential Linear Timeline View */}
        {viewMode === "timeline" && (
          <div className="course-v2-timeline-view-stack">
            <div className="course-v2-lessons-timeline">
              <div className="course-v2-timeline-spine" aria-hidden="true" />
              {allLessons.filter(filterLesson).map((lesson, idx) => {
                const isDone = completedLessonIds.has(lesson.id);
                const isNext = nextLesson?.id === lesson.id;
                const lessonTasks = courseTasks.filter(t => t.lesson_id === lesson.id);
                const practiceTask = lessonTasks.find(t => t.task_type === "practice" || t.task_type === "checkpoint");

                return (
                  <div
                    key={lesson.id || idx}
                    className={`course-v2-lesson-row ${isDone ? "is-done" : ""} ${isNext ? "is-next" : ""}`}
                  >
                    <div className="course-v2-lesson-node">
                      {isDone ? (
                        <span className="course-v2-node-icon done">
                          <Icon name="check" size={12} />
                        </span>
                      ) : isNext ? (
                        <span className="course-v2-node-icon next">
                          <span className="course-v2-node-ping" />
                        </span>
                      ) : (
                        <span className="course-v2-node-icon planned">
                          <span className="course-v2-node-dot" />
                        </span>
                      )}
                    </div>

                    <div className="course-v2-lesson-card">
                      <div className="course-v2-lesson-main">
                        <div className="course-v2-timeline-mod-label">
                          {lesson.moduleTitle} · Lesson {lesson.lessonIndex + 1}
                        </div>
                        <div className="course-v2-lesson-header">
                          <h4 className="course-v2-lesson-title">{lesson.title}</h4>
                          {isNext && <span className="course-v2-lesson-tag next">Up Next</span>}
                          {isDone && <span className="course-v2-lesson-tag done">Done</span>}
                        </div>

                        {lesson.objective && (
                          <p className="course-v2-lesson-desc">{lesson.objective}</p>
                        )}

                        <div className="course-v2-lesson-chips">
                          <span className="course-v2-lesson-chip">
                            <Icon name="clock" size={12} />
                            <span>{minuteLabel(lesson.estimated_minutes || 25)}</span>
                          </span>
                          {practiceTask && (
                            <span className={`course-v2-lesson-chip practice ${practiceTask.status === "completed" ? "practice-done" : ""}`}>
                              <Icon name="practice" size={12} />
                              <span>Checkpoint: {practiceTask.status === "completed" ? "Passed" : "Available"}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="course-v2-lesson-actions">
                        {practiceTask && (
                          <button
                            type="button"
                            className="course-v2-quiet-practice-btn"
                            onClick={() => {
                              p.setActiveLessonId?.(lesson.id);
                              p.go("practice", { params: { lessonId: lesson.id } });
                            }}
                          >
                            <span>Practice</span>
                            <Icon name="arrow-right" size={12} />
                          </button>
                        )}

                        <button
                          type="button"
                          className={`course-v2-lesson-launch-btn ${isNext ? "cta" : isDone ? "reviewed" : ""}`}
                          onClick={() => p.openLesson(lesson.id)}
                          aria-label={`Open lesson: ${lesson.title}`}
                        >
                          <span>{isDone ? "Review" : isNext ? "Continue" : "Start"}</span>
                          <Icon name="arrow-right" size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </section>
    </div>
  );
}

export const CourseDetailPage = CoursePage;
export default CoursePage;
