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

  // Luminous Fluid Orb Progress calculations (viewBox 140x140)
  const meterRadius = 56;
  const meterCircumference = 2 * Math.PI * meterRadius; // ≈ 351.86
  const strokeDashoffset = meterCircumference - (meterCircumference * Math.max(0, Math.min(100, progressPercent))) / 100;

  // Luminous bead position at progress head (-90 deg offset)
  const beadAngleRad = (-0.5 + 2 * (Math.max(0, Math.min(100, progressPercent)) / 100)) * Math.PI;
  const beadX = Math.round((70 + meterRadius * Math.cos(beadAngleRad)) * 100) / 100;
  const beadY = Math.round((70 + meterRadius * Math.sin(beadAngleRad)) * 100) / 100;

  // Liquid level Y (from 118 down to 22 within 140x140)
  const liquidY = Math.round((118 - (96 * Math.max(0, Math.min(100, progressPercent))) / 100) * 100) / 100;

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
        </div>

        <div className="course-v2-header-actions">
          {isGenerating && (
            <div className="course-v2-generating-badge" role="status" aria-live="polite">
              <span className="course-v2-pulse-dot" aria-hidden="true" />
              <span>Generating study materials in background…</span>
            </div>
          )}

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

      {/* Hero Overview (Clean, Borderless, No Outer Card Background) */}
      <section className="course-v2-hero-clean">
        <h1 className="course-v2-title">{course.title}</h1>

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

        {(course.summary || course.desired_outcome) && (
          <p className="course-v2-desc">
            {course.summary || course.desired_outcome}
          </p>
        )}
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
            {/* Luminous Glowing Fluid Orb Container */}
            <div className="course-v2-fluid-orb-wrap">
              {/* Outer Glowing Radiant Aura */}
              <div className="course-v2-orb-aura" aria-hidden="true" />
              {/* Continuous Light Sheen Sweep */}
              <div className="course-v2-orb-sheen" aria-hidden="true" />

              <svg
                className="course-v2-fluid-orb-svg"
                width="136"
                height="136"
                viewBox="0 0 140 140"
                aria-hidden="true"
              >
                <defs>
                  {/* Progress Arc Neon Gradient */}
                  <linearGradient id="orbProgressGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#00e5ff" />
                    <stop offset="50%" stopColor="#38bdf8" />
                    <stop offset="100%" stopColor="#4ade80" />
                  </linearGradient>

                  {/* Soft Neon Glow Filter */}
                  <filter id="orbNeonGlow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>

                  {/* Glass Sphere Mask */}
                  <clipPath id="sphereClip">
                    <circle cx="70" cy="70" r="48" />
                  </clipPath>

                  {/* Sphere Deep Base Gradient */}
                  <radialGradient id="sphereBaseGrad" cx="50%" cy="80%" r="75%">
                    <stop offset="0%" stopColor="rgba(16, 185, 129, 0.2)" />
                    <stop offset="60%" stopColor="rgba(10, 16, 24, 0.95)" />
                    <stop offset="100%" stopColor="rgba(6, 10, 16, 0.98)" />
                  </radialGradient>

                  {/* Primary Wave Gradient (Emerald Front) */}
                  <linearGradient id="waveGradFront" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="rgba(74, 222, 128, 0.88)" />
                    <stop offset="35%" stopColor="rgba(16, 185, 129, 0.72)" />
                    <stop offset="100%" stopColor="rgba(6, 78, 59, 0.9)" />
                  </linearGradient>

                  {/* Secondary Wave Gradient (Cyan Back) */}
                  <linearGradient id="waveGradBack" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="rgba(0, 229, 255, 0.65)" />
                    <stop offset="50%" stopColor="rgba(5, 150, 105, 0.5)" />
                    <stop offset="100%" stopColor="rgba(4, 47, 46, 0.8)" />
                  </linearGradient>

                  {/* Glass Highlight Top Reflection */}
                  <linearGradient id="glassTopReflection" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="rgba(255, 255, 255, 0.45)" />
                    <stop offset="70%" stopColor="rgba(255, 255, 255, 0.08)" />
                    <stop offset="100%" stopColor="rgba(255, 255, 255, 0)" />
                  </linearGradient>

                  {/* Glass Sphere Rim Lighting */}
                  <linearGradient id="glassRimGrad" x1="20%" y1="0%" x2="80%" y2="100%">
                    <stop offset="0%" stopColor="rgba(255, 255, 255, 0.35)" />
                    <stop offset="50%" stopColor="rgba(52, 211, 153, 0.2)" />
                    <stop offset="100%" stopColor="rgba(0, 229, 255, 0.35)" />
                  </linearGradient>
                </defs>

                {/* 1. Subtle Outer Orbit Track */}
                <circle
                  cx="70"
                  cy="70"
                  r="62"
                  className="course-v2-orb-orbit-faint"
                />

                {/* 2. Outer Progress Arc Background Track */}
                <circle
                  cx="70"
                  cy="70"
                  r="56"
                  className="course-v2-orb-meter-bg"
                />

                {/* 3. Luminous Glowing Progress Arc */}
                <circle
                  cx="70"
                  cy="70"
                  r="56"
                  className="course-v2-orb-meter"
                  stroke="url(#orbProgressGrad)"
                  strokeDasharray={meterCircumference}
                  strokeDashoffset={strokeDashoffset}
                  filter="url(#orbNeonGlow)"
                />

                {/* 4. Luminous Bead at Progress Head */}
                {progressPercent > 0 && (
                  <g className="course-v2-orb-bead-group" transform={`translate(${beadX}, ${beadY})`}>
                    <circle r="7.5" className="course-v2-orb-bead-halo" />
                    <circle r="3.5" className="course-v2-orb-bead-core" />
                  </g>
                )}

                {/* 5. Clipped Glass Fluid Sphere */}
                <g clipPath="url(#sphereClip)">
                  {/* Sphere Dark Glass Base */}
                  <circle cx="70" cy="70" r="48" fill="url(#sphereBaseGrad)" />

                  {/* Fluid Wave Level Group */}
                  <g
                    className="course-v2-wave-level-group"
                    style={{ transform: `translateY(${liquidY}px)` }}
                  >
                    {/* Secondary Background Wave (Cyan) */}
                    <path
                      className="course-v2-wave-back"
                      d="M -70 0 Q -35 -9 0 0 T 70 0 T 140 0 T 210 0 T 280 0 V 130 H -70 Z"
                      fill="url(#waveGradBack)"
                    />
                    {/* Primary Foreground Wave (Emerald) */}
                    <path
                      className="course-v2-wave-front"
                      d="M -70 0 Q -35 -10 0 0 T 70 0 T 140 0 T 210 0 T 280 0 V 130 H -70 Z"
                      fill="url(#waveGradFront)"
                    />
                    {/* Glowing Wave Crest Line */}
                    <path
                      className="course-v2-wave-crest"
                      d="M -70 0 Q -35 -10 0 0 T 70 0 T 140 0 T 210 0 T 280 0"
                      fill="none"
                      stroke="#86efac"
                      strokeWidth="1.6"
                      filter="url(#orbNeonGlow)"
                    />
                  </g>

                  {/* 3D Glass Specular Highlights */}
                  <path
                    d="M 40 30 A 36 20 0 0 1 100 30 A 36 12 0 0 0 40 30 Z"
                    fill="url(#glassTopReflection)"
                  />
                  <ellipse
                    cx="44"
                    cy="40"
                    rx="2.5"
                    ry="4.5"
                    fill="rgba(255, 255, 255, 0.45)"
                    transform="rotate(-28 44 40)"
                  />
                  <ellipse
                    cx="70"
                    cy="114"
                    rx="22"
                    ry="4"
                    fill="rgba(52, 211, 153, 0.22)"
                    filter="blur(2px)"
                  />
                </g>

                {/* 6. Glass Sphere Rim Lighting Ring */}
                <circle
                  cx="70"
                  cy="70"
                  r="48"
                  fill="none"
                  stroke="url(#glassRimGrad)"
                  strokeWidth="1.5"
                />
              </svg>

              {/* Luminous Center Readout */}
              <div className="course-v2-orb-center-text">
                <span className="course-v2-orb-value">{progressPercent}%</span>
                <span className="course-v2-orb-sub">MASTERED</span>
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

        {/* Bento 3: Weekly Pace & Schedule Card (Glassmorphic Redesign) */}
        <div className="course-v2-bento-card course-v2-col-4 course-v2-pace-card">
          {/* Luminous Edge-lit Top Rim Light */}
          <div className="course-v2-pace-rim-light" aria-hidden="true" />

          {/* Celestial Aurora Radial Glows */}
          <div className="course-v2-pace-glow-top" aria-hidden="true" />
          <div className="course-v2-pace-glow-bottom" aria-hidden="true" />

          {/* Luminous Volumetric Aurora Blades & Translucent Curves */}
          <svg
            className="course-v2-pace-curves-svg"
            viewBox="0 0 440 280"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              {/* Arc 1 Gradient Stroke */}
              <linearGradient id="paceBladeStroke1" x1="65%" y1="0%" x2="10%" y2="100%">
                <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.95" />
                <stop offset="25%" stopColor="#4ade80" stopOpacity="0.85" />
                <stop offset="60%" stopColor="#10b981" stopOpacity="0.38" />
                <stop offset="100%" stopColor="#047857" stopOpacity="0.05" />
              </linearGradient>

              {/* Arc 1 Translucent Aurora Fill */}
              <radialGradient id="paceBladeFill1" cx="80%" cy="15%" r="75%">
                <stop offset="0%" stopColor="#4ade80" stopOpacity="0.22" />
                <stop offset="35%" stopColor="#10b981" stopOpacity="0.1" />
                <stop offset="70%" stopColor="#047857" stopOpacity="0.02" />
                <stop offset="100%" stopColor="#047857" stopOpacity="0" />
              </radialGradient>

              {/* Arc 2 Gradient Stroke */}
              <linearGradient id="paceBladeStroke2" x1="100%" y1="15%" x2="35%" y2="100%">
                <stop offset="0%" stopColor="#86efac" stopOpacity="0.8" />
                <stop offset="45%" stopColor="#34d399" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0.08" />
              </linearGradient>

              {/* Arc 2 Translucent Aurora Fill */}
              <radialGradient id="paceBladeFill2" cx="88%" cy="60%" r="65%">
                <stop offset="0%" stopColor="#34d399" stopOpacity="0.14" />
                <stop offset="50%" stopColor="#10b981" stopOpacity="0.05" />
                <stop offset="100%" stopColor="#047857" stopOpacity="0" />
              </radialGradient>

              {/* Arc 3 Gradient Stroke */}
              <linearGradient id="paceBladeStroke3" x1="100%" y1="0%" x2="20%" y2="100%">
                <stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#059669" stopOpacity="0.04" />
              </linearGradient>

              {/* Soft Ethereal Glow Filter */}
              <filter id="paceGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Aurora Sail 1 Fill & Stroke (Sweeping Wide Lens) */}
            <path
              d="M 300 0 C 315 65, 275 145, 215 212 C 185 246, 155 268, 130 280 L 440 280 L 440 0 Z"
              fill="url(#paceBladeFill1)"
            />
            <path
              d="M 300 0 C 315 65, 275 145, 215 212 C 185 246, 155 268, 130 280"
              fill="none"
              stroke="url(#paceBladeStroke1)"
              strokeWidth="2.2"
              filter="url(#paceGlow)"
            />

            {/* Aurora Sail 2 (Intersecting Optical Lens) Fill & Stroke */}
            <path
              d="M 440 70 C 365 105, 290 175, 275 280 L 440 280 Z"
              fill="url(#paceBladeFill2)"
            />
            <path
              d="M 440 70 C 365 105, 290 175, 275 280"
              fill="none"
              stroke="url(#paceBladeStroke2)"
              strokeWidth="1.9"
              filter="url(#paceGlow)"
            />

            {/* Aurora Blade 3 (Subtle Bottom-Right Accent) */}
            <path
              d="M 440 160 C 395 192, 355 238, 345 280"
              fill="none"
              stroke="url(#paceBladeStroke3)"
              strokeWidth="1.4"
            />
          </svg>

          <div className="course-v2-pace-card-inner">
            {/* Top Row: Activity Tile + Divider + Title */}
            <div className="course-v2-pace-header">
              <div className="course-v2-pace-icon-tile">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="3 16 8 11 13 15 21 7" />
                </svg>
              </div>
              <span className="course-v2-pace-divider" aria-hidden="true" />
              <h3 className="course-v2-pace-title">Target Pacing</h3>
            </div>

            {/* Middle Row: Large Metric + Unit in Secondary Pill */}
            <div className="course-v2-pace-metric-row">
              <span className="course-v2-pace-big-val">~{weeklyHours}</span>
              <span className="course-v2-pace-unit-pill">hrs / week</span>
            </div>

            {/* Description Text */}
            <p className="course-v2-pace-desc">
              Paced over {targetWeeks} weeks to fit your routine with small, repeatable sessions.
            </p>

            {/* Bottom Row: Glass CTA Button with Calendar and Arrow Icons */}
            <button
              type="button"
              className="course-v2-pace-glass-btn"
              onClick={() => p.go("today")}
            >
              <Icon name="calendar" size={16} />
              <span>View in Daily Plan</span>
              <Icon name="arrow-right" size={15} className="course-v2-pace-btn-arrow" />
            </button>
          </div>
        </div>

        {/* Bento 4: Quick Study Tools Dock (Modern Dark Glassmorphism, 4 Independent Cards) */}
        <div className="course-v2-col-8 course-v2-study-tools-container">
          <div className="course-v2-study-tools-header">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="course-v2-study-tools-sparkle"
              aria-hidden="true"
            >
              <path d="M12 1L14.5 9.5L23 12L14.5 14.5L12 23L9.5 14.5L1 12L9.5 9.5L12 1Z" />
            </svg>
            <h3 className="course-v2-study-tools-title">Course Study Tools</h3>
          </div>

          <div className="course-v2-study-tools-grid">
            {/* Tool 1: Course Notes (Cyan) */}
            <button
              type="button"
              className="course-v2-study-tool-card course-v2-tool-cyan"
              onClick={() => p.go("notes", { query: { course: course.id } })}
            >
              <div className="course-v2-study-card-glow" aria-hidden="true" />
              <svg
                className="course-v2-study-wave-svg"
                viewBox="0 0 320 90"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="toolWaveCyanStroke" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#00e5ff" stopOpacity="0" />
                    <stop offset="35%" stopColor="#00e5ff" stopOpacity="0.75" />
                    <stop offset="80%" stopColor="#38bdf8" stopOpacity="1" />
                    <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0.9" />
                  </linearGradient>
                  <radialGradient id="toolWaveCyanFill" cx="92%" cy="85%" r="70%">
                    <stop offset="0%" stopColor="#00e5ff" stopOpacity="0.22" />
                    <stop offset="60%" stopColor="#0284c7" stopOpacity="0.05" />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
                  </radialGradient>
                  <filter id="toolWaveGlowCyan" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32 L 320 90 Z"
                  fill="url(#toolWaveCyanFill)"
                />
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32"
                  fill="none"
                  stroke="url(#toolWaveCyanStroke)"
                  strokeWidth="1.8"
                  filter="url(#toolWaveGlowCyan)"
                />
              </svg>
              <div className="course-v2-study-card-content">
                <div className="course-v2-study-icon-tile">
                  <Icon name="notes" size={20} />
                </div>
                <div className="course-v2-study-text">
                  <h4 className="course-v2-study-title">Course Notes</h4>
                  <p className="course-v2-study-desc">{courseNotes.length} notes drafted</p>
                </div>
                <Icon name="arrow-right" size={16} className="course-v2-study-arrow" />
              </div>
            </button>

            {/* Tool 2: Flashcards (Purple) */}
            <button
              type="button"
              className="course-v2-study-tool-card course-v2-tool-purple"
              onClick={() => p.go("flashcards", { query: { course: course.id } })}
            >
              <div className="course-v2-study-card-glow" aria-hidden="true" />
              <svg
                className="course-v2-study-wave-svg"
                viewBox="0 0 320 90"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="toolWavePurpleStroke" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#a855f7" stopOpacity="0" />
                    <stop offset="35%" stopColor="#a855f7" stopOpacity="0.75" />
                    <stop offset="80%" stopColor="#c084fc" stopOpacity="1" />
                    <stop offset="100%" stopColor="#f0abfc" stopOpacity="0.9" />
                  </linearGradient>
                  <radialGradient id="toolWavePurpleFill" cx="92%" cy="85%" r="70%">
                    <stop offset="0%" stopColor="#c084fc" stopOpacity="0.22" />
                    <stop offset="60%" stopColor="#7e22ce" stopOpacity="0.05" />
                    <stop offset="100%" stopColor="#7e22ce" stopOpacity="0" />
                  </radialGradient>
                  <filter id="toolWaveGlowPurple" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32 L 320 90 Z"
                  fill="url(#toolWavePurpleFill)"
                />
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32"
                  fill="none"
                  stroke="url(#toolWavePurpleStroke)"
                  strokeWidth="1.8"
                  filter="url(#toolWaveGlowPurple)"
                />
              </svg>
              <div className="course-v2-study-card-content">
                <div className="course-v2-study-icon-tile">
                  <Icon name="cards" size={20} />
                </div>
                <div className="course-v2-study-text">
                  <h4 className="course-v2-study-title">Flashcards</h4>
                  <p className="course-v2-study-desc">
                    {courseFlashcards.length} cards {dueFlashcardsCount > 0 && `(${dueFlashcardsCount} due)`}
                  </p>
                </div>
                <Icon name="arrow-right" size={16} className="course-v2-study-arrow" />
              </div>
            </button>

            {/* Tool 3: Practice Studio (Amber) */}
            <button
              type="button"
              className="course-v2-study-tool-card course-v2-tool-amber"
              onClick={() => p.go("practice", { query: { course: course.id } })}
            >
              <div className="course-v2-study-card-glow" aria-hidden="true" />
              <svg
                className="course-v2-study-wave-svg"
                viewBox="0 0 320 90"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="toolWaveAmberStroke" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
                    <stop offset="35%" stopColor="#f59e0b" stopOpacity="0.75" />
                    <stop offset="80%" stopColor="#fbbf24" stopOpacity="1" />
                    <stop offset="100%" stopColor="#fef08a" stopOpacity="0.9" />
                  </linearGradient>
                  <radialGradient id="toolWaveAmberFill" cx="92%" cy="85%" r="70%">
                    <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.22" />
                    <stop offset="60%" stopColor="#b45309" stopOpacity="0.05" />
                    <stop offset="100%" stopColor="#b45309" stopOpacity="0" />
                  </radialGradient>
                  <filter id="toolWaveGlowAmber" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32 L 320 90 Z"
                  fill="url(#toolWaveAmberFill)"
                />
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32"
                  fill="none"
                  stroke="url(#toolWaveAmberStroke)"
                  strokeWidth="1.8"
                  filter="url(#toolWaveGlowAmber)"
                />
              </svg>
              <div className="course-v2-study-card-content">
                <div className="course-v2-study-icon-tile">
                  <Icon name="practice" size={20} />
                </div>
                <div className="course-v2-study-text">
                  <h4 className="course-v2-study-title">Practice Studio</h4>
                  <p className="course-v2-study-desc">{practiceTasks.length} checkpoints</p>
                </div>
                <Icon name="arrow-right" size={16} className="course-v2-study-arrow" />
              </div>
            </button>

            {/* Tool 4: Ask AI Tutor (Green) */}
            <button
              type="button"
              className="course-v2-study-tool-card course-v2-tool-green"
              onClick={() => p.go("tutor", { query: { course: course.id } })}
            >
              <div className="course-v2-study-card-glow" aria-hidden="true" />
              <svg
                className="course-v2-study-wave-svg"
                viewBox="0 0 320 90"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id="toolWaveGreenStroke" x1="0%" y1="100%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#22c55e" stopOpacity="0" />
                    <stop offset="35%" stopColor="#22c55e" stopOpacity="0.75" />
                    <stop offset="80%" stopColor="#4ade80" stopOpacity="1" />
                    <stop offset="100%" stopColor="#bbf7d0" stopOpacity="0.9" />
                  </linearGradient>
                  <radialGradient id="toolWaveGreenFill" cx="92%" cy="85%" r="70%">
                    <stop offset="0%" stopColor="#4ade80" stopOpacity="0.22" />
                    <stop offset="60%" stopColor="#15803d" stopOpacity="0.05" />
                    <stop offset="100%" stopColor="#15803d" stopOpacity="0" />
                  </radialGradient>
                  <filter id="toolWaveGlowGreen" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="2" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32 L 320 90 Z"
                  fill="url(#toolWaveGreenFill)"
                />
                <path
                  d="M 150 90 C 190 90, 225 65, 255 50 C 275 40, 298 34, 320 32"
                  fill="none"
                  stroke="url(#toolWaveGreenStroke)"
                  strokeWidth="1.8"
                  filter="url(#toolWaveGlowGreen)"
                />
              </svg>
              <div className="course-v2-study-card-content">
                <div className="course-v2-study-icon-tile">
                  <Icon name="tutor" size={20} />
                </div>
                <div className="course-v2-study-text">
                  <h4 className="course-v2-study-title">Ask AI Tutor</h4>
                  <p className="course-v2-study-desc">Grounded in this course</p>
                </div>
                <Icon name="arrow-right" size={16} className="course-v2-study-arrow" />
              </div>
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
