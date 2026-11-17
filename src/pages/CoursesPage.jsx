import React, { useState, useMemo, useCallback } from "react";
import { Icon, EmptyState } from "../components/common.jsx";

// ==========================================
// 1. DECORATIVE HEADER ART FOR CARDS
// ==========================================
function CardHeaderGraphic({ isProposal }) {
  if (isProposal) {
    return (
      <svg className="card-header-art-svg" viewBox="0 0 160 80" fill="none" aria-hidden="true">
        {/* Constellation Network Nodes for Proposal Plan */}
        <circle cx="135" cy="18" r="4.5" fill="#a855f7" fillOpacity="0.85" />
        <circle cx="95" cy="28" r="3.5" fill="#818cf8" fillOpacity="0.75" />
        <circle cx="120" cy="56" r="5" fill="#84cc16" fillOpacity="0.85" />
        <circle cx="68" cy="65" r="3" fill="#c084fc" fillOpacity="0.6" />
        <circle cx="40" cy="35" r="2.5" fill="#a855f7" fillOpacity="0.5" />
        <line x1="135" y1="18" x2="95" y2="28" stroke="#a855f7" strokeWidth="1.2" strokeOpacity="0.4" />
        <line x1="95" y1="28" x2="120" y2="56" stroke="#a855f7" strokeWidth="1.2" strokeOpacity="0.4" />
        <line x1="120" y1="56" x2="68" y2="65" stroke="#84cc16" strokeWidth="1.2" strokeOpacity="0.4" />
        <line x1="135" y1="18" x2="120" y2="56" stroke="#818cf8" strokeWidth="1" strokeOpacity="0.3" />
        <line x1="40" y1="35" x2="95" y2="28" stroke="#a855f7" strokeWidth="0.8" strokeOpacity="0.25" />
        <line x1="40" y1="35" x2="68" y2="65" stroke="#c084fc" strokeWidth="0.8" strokeOpacity="0.25" />
      </svg>
    );
  }

  return (
    <svg className="card-header-art-svg" viewBox="0 0 160 80" fill="none" aria-hidden="true">
      {/* Circuit Trace & Orbital Nodes for Active Learning Path */}
      <path d="M 20 40 L 65 40 L 85 22 L 138 22" stroke="#06b6d4" strokeWidth="1.2" strokeOpacity="0.4" />
      <path d="M 65 40 L 85 58 L 125 58" stroke="#10b981" strokeWidth="1.2" strokeOpacity="0.4" />
      <circle cx="138" cy="22" r="4.5" fill="#06b6d4" fillOpacity="0.85" />
      <circle cx="125" cy="58" r="4" fill="#10b981" fillOpacity="0.85" />
      <rect x="98" y="14" width="16" height="16" rx="3.5" stroke="#06b6d4" strokeWidth="1" strokeOpacity="0.45" />
      <circle cx="65" cy="40" r="2.5" fill="#38bdf8" />
    </svg>
  );
}

// ==========================================
// 2. GHOST CARD (For Single Course Showcase Balance)
// ==========================================
function GhostShowcaseCard({ position, go }) {
  const isLeft = position === "left";
  return (
    <article
      className={`showcase-card showcase-ghost-card ${isLeft ? "is-left" : "is-right"} flex flex-col items-center justify-center p-6 text-center cursor-pointer`}
      onClick={() => go("goal")}
      tabIndex={0}
      role="button"
      aria-label="Create another learning goal"
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go("goal");
        }
      }}
    >
      <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 grid place-items-center text-cyan-400 mb-3">
        <span className="text-xl">✦</span>
      </div>
      <strong className="text-white text-base font-bold mb-1">New Learning Goal</strong>
      <p className="text-xs text-slate-400 max-w-[200px] mb-4">
        Add another skill to your workspace roadmap.
      </p>
      <span className="text-xs font-semibold text-cyan-300 py-1.5 px-3 rounded-lg bg-cyan-500/15 border border-cyan-500/25">
        Create plan ↗
      </span>
    </article>
  );
}

// ==========================================
// 3. DETAILED 3D SHOWCASE CARD (Image 1 & 2 Style)
// ==========================================
function ShowcaseCard({
  course,
  position = "center", // "center", "left", "right"
  data,
  go,
  setProposal,
  updateData,
  confirmDeleteCourse,
  deletingCourseId,
  onClick
}) {
  if (!course) return null;

  const allLessons = (course.modules || []).flatMap(m => m?.lessons || []);
  const courseTasks = (data.tasks || []).filter(t => t.course_id === course.id);
  const done = courseTasks.filter(t => t.status === "completed").length;
  const percent = courseTasks.length ? Math.round((done / courseTasks.length) * 100) : 0;
  const isProposal = course.status === "proposal";
  const levelText = course.current_level || course.currentLevel || "Beginner";
  const durationText = `${course.target_weeks || course.durationWeeks || 8} weeks`;
  const hoursEst = Math.round((course.estimated_minutes || 0) / 60) || (isProposal ? 9 : 8);

  const isCenter = position === "center";
  const posClass = isCenter ? "is-center" : position === "left" ? "is-left" : "is-right";

  return (
    <article
      className={`showcase-card ${posClass} flex flex-col overflow-hidden relative status-${course.status || "active"}`}
      onClick={!isCenter ? onClick : undefined}
      tabIndex={!isCenter ? 0 : -1}
      role={!isCenter ? "button" : "region"}
      aria-label={`${course.title} - ${isCenter ? "Active Card" : position + " Card"}`}
      onKeyDown={(e) => {
        if (!isCenter && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      {/* Glowing Specular Top Highlight */}
      <div className="course-card-glow-bar" aria-hidden="true" />

      {/* Card Header with Category Pill, Status Badge & Art */}
      <div className="showcase-card-header flex items-center justify-between relative px-6 pt-5 pb-3">
        <div className="card-header-art-layer" aria-hidden="true">
          <CardHeaderGraphic isProposal={isProposal} />
        </div>

        <div className="flex items-center gap-2 relative z-10">
          <span className="showcase-cat-pill flex items-center gap-1.5">
            <span className="cat-spark text-cyan-400 text-xs">✦</span>
            <span>{isProposal ? "DRAFT PLAN" : "LEARNING PATH"}</span>
          </span>
        </div>

        <span className={`showcase-status-badge relative z-10 ${isProposal ? "proposal" : "active"}`}>
          <span className="status-dot" />
          {isProposal ? "PROPOSAL" : "ACTIVE"}
        </span>
      </div>

      {/* Card Body */}
      <div className="showcase-card-body flex flex-col flex-1 px-6 pb-6 pt-2 gap-3.5 relative z-10">
        {/* Level & Duration Subtitle */}
        <div className="course-meta-row flex items-center gap-2 text-xs">
          <span className="meta-level-text">{levelText}</span>
          <span className="meta-dot text-slate-500">·</span>
          <span className="meta-duration-text flex items-center gap-1.5 text-slate-400">
            <Icon name="clock" size={13} />
            <span>{durationText}</span>
          </span>
        </div>

        {/* Title */}
        <h3 className="showcase-card-title text-xl font-extrabold text-white leading-snug tracking-tight">
          {course.title}
        </h3>

        {/* Description / Summary */}
        <p className="showcase-card-desc text-xs text-slate-400 leading-relaxed line-clamp-3">
          {course.summary || course.desired_outcome || "A comprehensive learning roadmap structured for step-by-step concept mastery."}
        </p>

        {/* 3 Rounded Stat Chips (Lessons, Modules, Hours) */}
        <div className="showcase-chips-row flex flex-wrap items-center gap-2 mt-1">
          <span className="showcase-chip flex items-center gap-1.5">
            <Icon name="book" size={13} />
            <span>{allLessons.length || 12} lessons</span>
          </span>
          <span className="showcase-chip flex items-center gap-1.5">
            <Icon name="progress" size={13} />
            <span>{course.modules?.length || 6} modules</span>
          </span>
          <span className="showcase-chip flex items-center gap-1.5">
            <Icon name="clock" size={13} />
            <span>{hoursEst} hours</span>
          </span>
        </div>

        {/* Progress Bar Row */}
        <div className="showcase-progress-section flex flex-col gap-1.5 mt-auto pt-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-slate-400 font-medium">Course Progress</span>
            <span className={`progress-value ${percent > 0 ? "text-cyan-400" : "text-white"}`}>
              {percent}%
            </span>
          </div>
          <div className="progress-track w-full">
            <div
              className="progress-fill"
              style={{ width: `${Math.max(percent, percent > 0 ? 4 : 0)}%` }}
            />
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="showcase-actions-row flex items-center justify-between gap-3 pt-3.5 border-t border-white/[0.08] mt-1">
          {isProposal ? (
            <button
              type="button"
              className="showcase-primary-btn flex items-center gap-1.5 cursor-pointer"
              disabled={!isCenter}
              onClick={(e) => {
                e.stopPropagation();
                setProposal?.(course);
                updateData?.(x => ({ ...x, activeCourseId: course.id }));
                go("proposal", { params: { courseId: course.id } });
              }}
            >
              <span>Review plan</span>
              <span className="btn-arrow">↗</span>
            </button>
          ) : (
            <button
              type="button"
              className="showcase-primary-btn flex items-center gap-1.5 cursor-pointer"
              disabled={!isCenter}
              onClick={(e) => {
                e.stopPropagation();
                updateData?.(x => ({ ...x, activeCourseId: course.id }));
                go("course", { params: { courseId: course.id } });
              }}
            >
              <span>Open course</span>
              <span className="btn-arrow">↗</span>
            </button>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              className="showcase-more-btn grid place-items-center cursor-pointer"
              aria-label={`View roadmap for ${course.title}`}
              title="View roadmap"
              disabled={!isCenter}
              onClick={(e) => {
                e.stopPropagation();
                updateData?.(x => ({ ...x, activeCourseId: course.id }));
                if (isProposal) setProposal?.(course);
                go(isProposal ? "proposal" : "course", { params: { courseId: course.id } });
              }}
            >
              ⋯
            </button>
            {confirmDeleteCourse && (
              <button
                type="button"
                className="showcase-delete-btn flex items-center gap-1.5 cursor-pointer"
                aria-label={`Delete ${course.title}`}
                title="Delete course"
                disabled={!isCenter || deletingCourseId === course.id}
                onClick={(e) => {
                  e.stopPropagation();
                  confirmDeleteCourse(course);
                }}
              >
                <Icon name="trash" size={13} />
                <span>Delete</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

// ==========================================
// 4. MAIN COURSES PAGE (Two-Box Grid)
// ==========================================
function CoursesPage(props) {
  const {
    data,
    courseFilter,
    setCourseFilter,
    go,
    updateData,
    setProposal,
    confirmDeleteCourse,
    deletingCourseId
  } = props;

  const courses = data.courses || [];
  const [activeCourseId, setActiveCourseId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filterCounts = useMemo(() => ({
    all: courses.length,
    active: courses.filter(c => c.status === "active").length,
    proposal: courses.filter(c => c.status === "proposal").length,
    completed: courses.filter(c => c.status === "completed").length
  }), [courses]);

  // Filter courses by status and search query
  const visible = useMemo(() => {
    return courses.filter(c => {
      const matchStatus = courseFilter === "all" || c.status === courseFilter;
      const matchSearch =
        !searchQuery.trim() ||
        c.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.summary || "").toLowerCase().includes(searchQuery.toLowerCase());
      return matchStatus && matchSearch;
    });
  }, [courses, courseFilter, searchQuery]);

  // Determine current active index in visible list
  const activeIndex = useMemo(() => {
    if (!visible.length) return 0;
    const foundIdx = visible.findIndex(c => c.id === activeCourseId);
    return foundIdx !== -1 ? foundIdx : 0;
  }, [visible, activeCourseId]);

  // Cards for 3D deck
  const centerCourse = visible[activeIndex] || null;
  const prevCourse = visible.length > 1 ? visible[(activeIndex - 1 + visible.length) % visible.length] : null;
  const nextCourse = visible.length > 2
    ? visible[(activeIndex + 1) % visible.length]
    : (visible.length === 2 && prevCourse?.id !== visible[(activeIndex + 1) % visible.length]?.id
      ? visible[(activeIndex + 1) % visible.length]
      : null);

  const handlePrev = useCallback(() => {
    if (visible.length <= 1) return;
    const prevIdx = (activeIndex - 1 + visible.length) % visible.length;
    setActiveCourseId(visible[prevIdx].id);
  }, [activeIndex, visible]);

  const handleNext = useCallback(() => {
    if (visible.length <= 1) return;
    const nextIdx = (activeIndex + 1) % visible.length;
    setActiveCourseId(visible[nextIdx].id);
  }, [activeIndex, visible]);

  return (
    <div className="courses-page-container flex flex-col gap-6">
      {/* Top Filter & Count Bar */}
      <div className="filter-row flex flex-wrap items-center justify-between gap-3" role="group" aria-label="Filter courses">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["all", "All courses"],
            ["active", "Active"],
            ["proposal", "Proposals"],
            ["completed", "Completed"]
          ].map(([value, label]) => {
            const count = filterCounts[value] ?? 0;
            const isSelected = courseFilter === value;
            return (
              <button
                key={value}
                type="button"
                className={`filter-chip cursor-pointer flex items-center gap-2 ${isSelected ? "selected" : ""}`}
                onClick={() => setCourseFilter(value)}
              >
                <span>{label}</span>
                <span className={`filter-chip-count ${isSelected ? "active" : ""}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="text-xs text-slate-400 font-medium">
          Showing {visible.length} of {courses.length} course{courses.length === 1 ? "" : "s"}
        </div>
      </div>

      {visible.length > 0 ? (
        /* TWO BOXED GRID LAYOUT */
        <div className="courses-two-box-layout gap-6 items-start">
          {/* ========================================================
              BOX 1 (LEFT): 3D PERSPECTIVE CARD SHOWCASE (Image 3 style)
              ======================================================== */}
          <section className="panel courses-showcase-box flex flex-col relative overflow-hidden" aria-label="Featured Course 3D Showcase">
            {/* Ambient Background Glow Layer */}
            <div className="showcase-ambient-glow" aria-hidden="true" />

            {/* Box Header */}
            <div className="panel-head flex items-center justify-between relative z-10 px-5 pt-4 pb-2">
              <div className="panel-title flex items-center gap-2.5">
                <Icon name="spark" />
                <span>Featured Deck</span>
                <span className="text-xs font-normal text-slate-400">
                  ({activeIndex + 1} of {visible.length})
                </span>
              </div>

              {/* Navigation Controls */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="showcase-nav-arrow"
                  disabled={visible.length <= 1}
                  onClick={handlePrev}
                  aria-label="Previous course"
                  title="Previous course"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="showcase-nav-arrow"
                  disabled={visible.length <= 1}
                  onClick={handleNext}
                  aria-label="Next course"
                  title="Next course"
                >
                  ›
                </button>
              </div>
            </div>

            {/* 3D Fanned Card Deck Arena */}
            <div className="courses-3d-stage relative flex items-center justify-center">
              {/* Left Card: Prev Course or Ghost Card */}
              {prevCourse && prevCourse.id !== centerCourse.id ? (
                <ShowcaseCard
                  course={prevCourse}
                  position="left"
                  data={data}
                  go={go}
                  setProposal={setProposal}
                  updateData={updateData}
                  confirmDeleteCourse={confirmDeleteCourse}
                  deletingCourseId={deletingCourseId}
                  onClick={() => setActiveCourseId(prevCourse.id)}
                />
              ) : visible.length === 1 ? (
                <GhostShowcaseCard position="left" go={go} />
              ) : null}

              {/* Center Active Spotlight Card */}
              {centerCourse && (
                <ShowcaseCard
                  course={centerCourse}
                  position="center"
                  data={data}
                  go={go}
                  setProposal={setProposal}
                  updateData={updateData}
                  confirmDeleteCourse={confirmDeleteCourse}
                  deletingCourseId={deletingCourseId}
                />
              )}

              {/* Right Card: Next Course or Ghost Card */}
              {nextCourse && nextCourse.id !== centerCourse.id && nextCourse.id !== prevCourse?.id ? (
                <ShowcaseCard
                  course={nextCourse}
                  position="right"
                  data={data}
                  go={go}
                  setProposal={setProposal}
                  updateData={updateData}
                  confirmDeleteCourse={confirmDeleteCourse}
                  deletingCourseId={deletingCourseId}
                  onClick={() => setActiveCourseId(nextCourse.id)}
                />
              ) : visible.length <= 2 ? (
                <GhostShowcaseCard position="right" go={go} />
              ) : null}
            </div>

            {/* Bottom Indicator Dots */}
            {visible.length > 1 && (
              <div className="showcase-dots-bar flex items-center justify-center gap-2 py-3 border-t border-white/[0.05] relative z-10">
                {visible.map((c, i) => (
                  <button
                    key={c.id || i}
                    type="button"
                    className={`showcase-dot-btn ${i === activeIndex ? "is-active" : ""}`}
                    onClick={() => setActiveCourseId(c.id)}
                    aria-label={`Jump to course ${i + 1}: ${c.title}`}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ========================================================
              BOX 2 (RIGHT): LIST STYLED LIST OF ALL COURSES (Hover Interactive)
              ======================================================== */}
          <section className="panel courses-directory-box flex flex-col relative overflow-hidden" aria-label="All Courses Directory">
            {/* Directory Header */}
            <div className="panel-head flex items-center justify-between relative z-10 px-5 pt-4 pb-3 border-b border-white/[0.06]">
              <div className="panel-title flex items-center gap-2">
                <Icon name="book" />
                <span>All Courses</span>
              </div>
              <span className="directory-count-badge text-xs font-bold px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">
                {visible.length} available
              </span>
            </div>

            {/* Search Filter Input */}
            <div className="directory-search-wrap px-4 py-3 border-b border-white/[0.06] bg-black/20">
              <div className="relative flex items-center w-full">
                <span className="absolute left-3 text-slate-400 pointer-events-none">
                  <Icon name="search" size={14} />
                </span>
                <input
                  type="text"
                  placeholder="Search courses by title or topic..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="directory-search-input w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400/50 transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 text-xs text-slate-400 hover:text-white"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* List Styled List Container with Hover Trigger */}
            <div className="course-list-styled-container flex flex-col gap-2 p-4 overflow-y-auto max-h-[580px] custom-scrollbar">
              {visible.map((course, i) => {
                const isSelected = course.id === (centerCourse?.id || visible[0]?.id);
                const courseTasks = (data.tasks || []).filter(t => t.course_id === course.id);
                const done = courseTasks.filter(t => t.status === "completed").length;
                const percent = courseTasks.length ? Math.round((done / courseTasks.length) * 100) : 0;
                const isProposal = course.status === "proposal";
                const all = (course.modules || []).flatMap(m => m?.lessons || []);

                return (
                  <div
                    key={course.id || i}
                    className={`course-list-row-item ${isSelected ? "active-item" : ""} flex items-center justify-between gap-3 p-3.5 rounded-2xl cursor-pointer transition-all`}
                    onMouseEnter={() => setActiveCourseId(course.id)}
                    onFocus={() => setActiveCourseId(course.id)}
                    onClick={() => setActiveCourseId(course.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`View details for ${course.title}`}
                  >
                    {/* Left: Status Indicator & Info */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="row-item-status-icon flex-shrink-0 grid place-items-center">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            isProposal ? "bg-purple-400 shadow-[0_0_8px_#a855f7]" : "bg-emerald-400 shadow-[0_0_8px_#10b981]"
                          }`}
                        />
                      </div>

                      <div className="flex flex-col min-w-0 flex-1">
                        <strong className="row-item-title text-sm font-bold text-white truncate group-hover:text-cyan-300">
                          {course.title}
                        </strong>
                        <div className="row-item-meta flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                          <span className="text-cyan-400 font-semibold">{course.current_level || "Beginner"}</span>
                          <span>•</span>
                          <span>{course.target_weeks || 8} wks</span>
                          <span>•</span>
                          <span>{all.length} lessons</span>
                        </div>
                      </div>
                    </div>

                    {/* Right: Progress Indicator & Action Arrow */}
                    <div className="row-item-right flex items-center gap-3 flex-shrink-0">
                      <div className="flex flex-col items-end">
                        <span className={`text-xs font-bold ${percent > 0 ? "text-cyan-400" : "text-slate-400"}`}>
                          {percent}%
                        </span>
                        <div className="w-12 h-1 rounded-full bg-white/[0.08] overflow-hidden mt-1">
                          <div
                            className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 rounded-full"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>

                      <span className="row-item-arrow text-slate-400 text-sm font-bold pl-1">
                        ›
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : (
        <EmptyState
          title="No courses found"
          body="Write down the capability you want to build. Sign in to generate a course plan with lessons and practice."
          action="Create a learning goal"
          onAction={() => go("goal")}
        />
      )}
    </div>
  );
}

export { CoursesPage };