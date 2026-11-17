import React, { useState, useMemo, useCallback, useTransition, useDeferredValue } from "react";
import { Icon, EmptyState } from "../components/common.jsx";

// ==========================================
// 1. DECORATIVE HEADER ART FOR CARDS
// ==========================================
const CardHeaderGraphic = React.memo(function CardHeaderGraphic({ isProposal }) {
  if (isProposal) {
    return (
      <svg className="card-header-art-svg" viewBox="0 0 160 80" fill="none" aria-hidden="true">
        {/* Constellation Network Nodes for Proposal Plan */}
        <circle cx="135" cy="18" r="4.5" fill="#789FC9" fillOpacity="0.85" />
        <circle cx="95" cy="28" r="3.5" fill="#526F93" fillOpacity="0.75" />
        <circle cx="120" cy="56" r="5" fill="#4A9B66" fillOpacity="0.85" />
        <circle cx="68" cy="65" r="3" fill="#96C3E5" fillOpacity="0.6" />
        <circle cx="40" cy="35" r="2.5" fill="#789FC9" fillOpacity="0.5" />
        <line x1="135" y1="18" x2="95" y2="28" stroke="#526F93" strokeWidth="1.2" strokeOpacity="0.4" />
        <line x1="95" y1="28" x2="120" y2="56" stroke="#789FC9" strokeWidth="1.2" strokeOpacity="0.4" />
        <line x1="120" y1="56" x2="68" y2="65" stroke="#4A9B66" strokeWidth="1.2" strokeOpacity="0.4" />
        <line x1="135" y1="18" x2="120" y2="56" stroke="#96C3E5" strokeWidth="1" strokeOpacity="0.3" />
        <line x1="40" y1="35" x2="95" y2="28" stroke="#526F93" strokeWidth="0.8" strokeOpacity="0.25" />
        <line x1="40" y1="35" x2="68" y2="65" stroke="#96C3E5" strokeWidth="0.8" strokeOpacity="0.25" />
      </svg>
    );
  }

  return (
    <svg className="card-header-art-svg" viewBox="0 0 160 80" fill="none" aria-hidden="true">
      {/* Circuit Trace & Orbital Nodes for Active Learning Path */}
      <path d="M 20 40 L 65 40 L 85 22 L 138 22" stroke="#526F93" strokeWidth="1.2" strokeOpacity="0.5" />
      <path d="M 65 40 L 85 58 L 125 58" stroke="#4A9B66" strokeWidth="1.2" strokeOpacity="0.5" />
      <circle cx="138" cy="22" r="4.5" fill="#789FC9" fillOpacity="0.9" />
      <circle cx="125" cy="58" r="4" fill="#4A9B66" fillOpacity="0.9" />
      <rect x="98" y="14" width="16" height="16" rx="3.5" stroke="#789FC9" strokeWidth="1" strokeOpacity="0.55" />
      <circle cx="65" cy="40" r="2.5" fill="#96C3E5" />
    </svg>
  );
});

// ==========================================
// 2. COURSE PROGRESS GAUGE & MILESTONES (React.memo)
// ==========================================
const CourseProgressGauge = React.memo(function CourseProgressGauge({
  percent = 0,
  done = 0,
  total = 0,
  modulesCount = 6
}) {
  const segCount = Math.min(modulesCount || 5, 8);

  return (
    <div className="unique-progress-card p-3 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center gap-3.5 relative overflow-hidden">
      {/* Ambient Radial Core Light */}
      <div
        className="absolute -right-4 -top-4 w-20 h-20 rounded-full bg-[#789FC9]/[0.08] blur-xl pointer-events-none"
        aria-hidden="true"
      />

      {/* Micro Radial Gauge */}
      <div className="unique-radial-meter relative flex-shrink-0 grid place-items-center w-12 h-12">
        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
          <circle
            cx="22"
            cy="22"
            r="18"
            fill="none"
            stroke="rgba(150, 195, 229, 0.15)"
            strokeWidth="3.5"
          />
          <circle
            cx="22"
            cy="22"
            r="18"
            fill="none"
            stroke="#4A9B66"
            strokeWidth="3.5"
            strokeDasharray={113.1}
            strokeDashoffset={113.1 - (113.1 * Math.max(percent, percent > 0 ? 5 : 0)) / 100}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <span className="absolute font-display font-extrabold text-[11px] text-[#EEF6FB]">
          {percent}%
        </span>
      </div>

      {/* Milestone Info & Segmented Capsule Track */}
      <div className="flex flex-col flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-1.5">
          <span className="text-[10px] font-bold tracking-wider text-[#607586] uppercase font-display">
            Course Progress
          </span>
          <span className="text-[11px] font-semibold text-[#96C3E5] truncate">
            {done > 0 ? `${done} / ${total} lessons` : `${modulesCount} modules`}
          </span>
        </div>

        {/* Segmented Milestone Capsules Track */}
        <div className="milestone-capsules-track flex items-center gap-1.5 w-full">
          {Array.from({ length: segCount }).map((_, idx) => {
            const segPercent = ((idx + 1) / segCount) * 100;
            const isComplete = percent >= segPercent;
            const isCurrent = !isComplete && (idx === 0 || percent >= (idx / segCount) * 100);

            return (
              <div
                key={idx}
                className={`milestone-capsule flex-1 h-2 rounded-full transition-all duration-300 ${
                  isComplete
                    ? "bg-[#4A9B66] shadow-[0_0_8px_rgba(74,155,102,0.65)]"
                    : isCurrent && percent > 0
                    ? "bg-[#4A9B66]/35 border border-[#4A9B66] animate-pulse"
                    : "bg-white/[0.08]"
                }`}
                title={`Module ${idx + 1}`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
});

// ==========================================
// 3. GHOST CARD (For Single Course Showcase Balance)
// ==========================================
const GhostShowcaseCard = React.memo(function GhostShowcaseCard({ position, go }) {
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
      <div className="w-12 h-12 rounded-2xl bg-[#526F93]/20 border border-[#789FC9]/30 grid place-items-center text-[#96C3E5] mb-3">
        <span className="text-xl">✦</span>
      </div>
      <strong className="text-[#EEF6FB] text-base font-bold mb-1">New Learning Goal</strong>
      <p className="text-xs text-[#607586] max-w-[200px] mb-4">
        Add another skill to your workspace roadmap.
      </p>
      <span className="text-xs font-semibold text-[#EEF6FB] py-1.5 px-3 rounded-lg bg-[#526F93]/35 border border-[#789FC9]/50 shadow-[0_0_12px_rgba(120,159,201,0.25)]">
        Create plan ↗
      </span>
    </article>
  );
});

// ==========================================
// 4. DETAILED 3D SHOWCASE CARD (React.memo with O(1) stats)
// ==========================================
const ShowcaseCard = React.memo(function ShowcaseCard({
  course,
  position = "center",
  stats,
  go,
  setProposal,
  updateData,
  confirmDeleteCourse,
  deletingCourseId,
  onClick
}) {
  if (!course) return null;

  const isProposal = course.status === "proposal";
  const levelText = course.current_level || course.currentLevel || "Beginner";
  const durationText = `${course.target_weeks || course.durationWeeks || 8} weeks`;
  const hoursEst = Math.round((course.estimated_minutes || 0) / 60) || (isProposal ? 9 : 8);

  const isCenter = position === "center";
  const posClass = isCenter ? "is-center" : position === "left" ? "is-left" : "is-right";

  const allLessonsCount = stats?.allLessonsCount ?? 12;
  const doneLessons = stats?.completed ?? 0;
  const totalTasks = stats?.total ?? allLessonsCount;
  const progressPercent = stats?.percent ?? 0;
  const modulesCount = (course.modules || []).length || 6;

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
        <div className="flex items-center gap-2 relative z-10">
          {isProposal && (
            <span className="showcase-cat-pill flex items-center gap-1.5">
              <span className="cat-spark text-[#789FC9] text-xs">✦</span>
              <span>DRAFT PLAN</span>
            </span>
          )}
        </div>

        {isProposal ? (
          <span className="showcase-status-badge proposal relative z-10">
            <span className="status-dot" />
            PROPOSAL
          </span>
        ) : course.status === "suspended" ? (
          <span className="showcase-status-badge suspended relative z-10">
            <span className="status-dot" />
            SUSPENDED
          </span>
        ) : null}
      </div>

      {/* Card Body */}
      <div className="showcase-card-body flex flex-col flex-1 px-6 pb-6 pt-2 gap-3.5 relative z-10">
        {/* Level & Duration Subtitle */}
        <div className="course-meta-row flex items-center gap-2 text-xs">
          <span className="meta-level-text">{levelText}</span>
          <span className="meta-dot text-[#789FC9]/60">·</span>
          <span className="meta-duration-text flex items-center gap-1.5 text-[#96C3E5]/90">
            <Icon name="clock" size={13} />
            <span>{durationText}</span>
          </span>
        </div>

        {/* Title */}
        <h3 className="showcase-card-title text-xl font-extrabold text-[#EEF6FB] leading-snug tracking-tight">
          {course.title}
        </h3>

        {/* Description / Summary */}
        <p className="showcase-card-desc text-xs text-[#CDE2F4] leading-relaxed line-clamp-3">
          {course.summary || course.desired_outcome || "A comprehensive learning roadmap structured for step-by-step concept mastery."}
        </p>

        {/* 3 Rounded Stat Chips (Lessons, Modules, Hours) */}
        <div className="showcase-chips-row flex flex-wrap items-center gap-2 mt-1">
          <span className="showcase-chip flex items-center gap-1.5">
            <Icon name="book" size={13} />
            <span>{allLessonsCount} lessons</span>
          </span>
          <span className="showcase-chip flex items-center gap-1.5">
            <Icon name="progress" size={13} />
            <span>{modulesCount} modules</span>
          </span>
          <span className="showcase-chip flex items-center gap-1.5">
            <Icon name="clock" size={13} />
            <span>{hoursEst} hours</span>
          </span>
        </div>

        {/* Unique Curriculum Milestone Progression UI */}
        <div className="showcase-unique-progress flex flex-col gap-2 mt-auto pt-3">
          <CourseProgressGauge
            percent={progressPercent}
            done={doneLessons}
            total={totalTasks}
            modulesCount={modulesCount}
          />
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

          {confirmDeleteCourse && (
            <div className="flex items-center ml-auto">
              <button
                type="button"
                className="showcase-delete-icon-btn grid place-items-center cursor-pointer"
                aria-label={`Delete ${course.title}`}
                title="Delete course"
                disabled={!isCenter || deletingCourseId === course.id}
                onClick={(e) => {
                  e.stopPropagation();
                  confirmDeleteCourse(course);
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
});

// ==========================================
// 5. DIRECTORY LIST ROW ITEM (React.memo)
// ==========================================
const CourseDirectoryItem = React.memo(function CourseDirectoryItem({
  course,
  isSelected,
  stats,
  index,
  onSelect,
  onHover
}) {
  const allLessonsCount = stats?.allLessonsCount ?? 12;
  const percent = stats?.percent ?? 0;

  return (
    <div
      className={`course-list-row-item ${isSelected ? "active-item" : ""} flex items-center justify-between gap-3 p-3.5 rounded-2xl cursor-pointer transition-all`}
      style={{ animationDelay: `${index * 0.07 + 0.08}s` }}
      onMouseEnter={() => onHover(course.id)}
      onFocus={() => onHover(course.id)}
      onClick={() => onSelect(course.id)}
      tabIndex={0}
      role="button"
      aria-label={`View details for ${course.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(course.id);
        }
      }}
    >
      {/* Left: Info */}
      <div className="flex flex-col min-w-0 flex-1">
        <strong className="row-item-title text-sm font-bold text-[#EEF6FB] truncate group-hover:text-white">
          {course.title}
        </strong>
        <div className="row-item-meta flex items-center gap-1.5 text-[11px] text-[#607586] mt-0.5">
          <span className="text-[#96C3E5] font-semibold">{course.current_level || "Beginner"}</span>
          <span>•</span>
          <span>{course.target_weeks || 8} wks</span>
          <span>•</span>
          <span>{allLessonsCount} lessons</span>
        </div>
      </div>

      {/* Right: Progress Indicator & Action Arrow */}
      <div className="row-item-right flex items-center gap-3 flex-shrink-0">
        <div className="flex flex-col items-end">
          <span className={`text-xs font-bold ${percent > 0 ? "text-[#4A9B66]" : "text-[#607586]"}`}>
            {percent}%
          </span>
          <div className="w-12 h-1 rounded-full bg-white/[0.08] overflow-hidden mt-1">
            <div
              className="h-full bg-gradient-to-r from-[#789FC9] to-[#4A9B66] rounded-full"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <span className="row-item-arrow text-[#96C3E5] text-sm font-bold pl-1">
          ›
        </span>
      </div>
    </div>
  );
});

// ==========================================
// 6. TOP FILTER ROW COMPONENT (React.memo)
// ==========================================
const CoursesFilterBar = React.memo(function CoursesFilterBar({
  courseFilter,
  filterCounts,
  visibleCount,
  totalCount,
  onFilterChange,
  isPending
}) {
  const filterOptions = useMemo(() => [
    ["all", "All courses"],
    ["active", "Active"],
    ["proposal", "Proposals"],
    ["completed", "Completed"]
  ], []);

  return (
    <div className="filter-row flex flex-wrap items-center justify-between gap-3" role="group" aria-label="Filter courses">
      <div className="flex flex-wrap items-center gap-2">
        {filterOptions.map(([value, label]) => {
          const count = filterCounts[value] ?? 0;
          const isSelected = courseFilter === value;
          return (
            <button
              key={value}
              type="button"
              className={`filter-chip cursor-pointer flex items-center gap-2 ${isSelected ? "selected" : ""} ${isPending && isSelected ? "opacity-80" : ""}`}
              onClick={() => onFilterChange(value)}
            >
              <span>{label}</span>
              <span className={`filter-chip-count ${isSelected ? "active" : ""}`}>{count}</span>
            </button>
          );
        })}
      </div>
      <div className="text-xs text-[#607586] font-medium">
        Showing {visibleCount} of {totalCount} course{totalCount === 1 ? "" : "s"}
      </div>
    </div>
  );
});

// ==========================================
// 7. 3D PERSPECTIVE CARDS STAGE (React.memo)
// ==========================================
const Courses3DStage = React.memo(function Courses3DStage({
  visible,
  centerCourse,
  prevCourse,
  nextCourse,
  activeIndex,
  statsMap,
  go,
  setProposal,
  updateData,
  confirmDeleteCourse,
  deletingCourseId,
  onPrev,
  onNext,
  onSelectId
}) {
  return (
    <section className="panel courses-showcase-box flex flex-col relative" aria-label="Featured Course 3D Showcase">
      {/* Animated Moving Color Aura at Center */}
      <div className="showcase-center-moving-glow" aria-hidden="true" />
      <div className="showcase-ambient-glow" aria-hidden="true" />

      {/* 3D Fanned Card Deck Arena */}
      <div className="courses-3d-stage relative flex items-center justify-center">
        {/* Left Side Navigation Arrow */}
        <button
          type="button"
          className="showcase-side-nav-arrow is-prev"
          disabled={visible.length <= 1}
          onClick={onPrev}
          aria-label="Previous course"
          title="Previous course"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Left Card: Prev Course or Ghost Card */}
        {prevCourse && prevCourse.id !== centerCourse?.id ? (
          <ShowcaseCard
            course={prevCourse}
            position="left"
            stats={statsMap.get(prevCourse.id)}
            go={go}
            setProposal={setProposal}
            updateData={updateData}
            confirmDeleteCourse={confirmDeleteCourse}
            deletingCourseId={deletingCourseId}
            onClick={() => onSelectId(prevCourse.id)}
          />
        ) : visible.length === 1 ? (
          <GhostShowcaseCard position="left" go={go} />
        ) : null}

        {/* Center Active Spotlight Card */}
        {centerCourse && (
          <ShowcaseCard
            course={centerCourse}
            position="center"
            stats={statsMap.get(centerCourse.id)}
            go={go}
            setProposal={setProposal}
            updateData={updateData}
            confirmDeleteCourse={confirmDeleteCourse}
            deletingCourseId={deletingCourseId}
          />
        )}

        {/* Right Card: Next Course or Ghost Card */}
        {nextCourse && nextCourse.id !== centerCourse?.id && nextCourse.id !== prevCourse?.id ? (
          <ShowcaseCard
            course={nextCourse}
            position="right"
            stats={statsMap.get(nextCourse.id)}
            go={go}
            setProposal={setProposal}
            updateData={updateData}
            confirmDeleteCourse={confirmDeleteCourse}
            deletingCourseId={deletingCourseId}
            onClick={() => onSelectId(nextCourse.id)}
          />
        ) : visible.length <= 2 ? (
          <GhostShowcaseCard position="right" go={go} />
        ) : null}

        {/* Right Side Navigation Arrow */}
        <button
          type="button"
          className="showcase-side-nav-arrow is-next"
          disabled={visible.length <= 1}
          onClick={onNext}
          aria-label="Next course"
          title="Next course"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Bottom Indicator Dots */}
      {visible.length > 1 && (
        <div className="showcase-dots-bar flex items-center justify-center gap-2 py-3 border-t border-white/[0.05] relative z-10">
          {visible.map((c, i) => (
            <button
              key={c.id || i}
              type="button"
              className={`showcase-dot-btn ${i === activeIndex ? "is-active" : ""}`}
              onClick={() => onSelectId(c.id)}
              aria-label={`Jump to course ${i + 1}: ${c.title}`}
            />
          ))}
        </div>
      )}
    </section>
  );
});

// ==========================================
// 8. DIRECTORY LIST BOX (React.memo with custom icon & logo-matched title)
// ==========================================
const CoursesDirectory = React.memo(function CoursesDirectory({
  visible,
  activeCourseId,
  searchQuery,
  onSearchChange,
  onClearSearch,
  statsMap,
  onHoverCourse,
  onSelectCourse
}) {
  return (
    <section className="panel courses-directory-box flex flex-col relative overflow-hidden" aria-label="All Courses Directory">
      {/* Directory Header with Brand Cyan Title & Curriculum Book Icon */}
      <div className="panel-head flex items-center justify-between relative z-10 px-5 pt-4 pb-3 border-b border-white/[0.06]">
        <div className="panel-title flex items-center gap-2.5">
          {/* Custom Open Learning Catalog Book Icon */}
          <span className="courses-directory-icon-wrap" aria-hidden="true">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </span>
          {/* Matches Brand Logo 'LEARN' Electric Cyan */}
          <span className="courses-directory-title">All Courses</span>
        </div>
        <span className="directory-count-badge text-xs font-bold px-2.5 py-0.5 rounded-full bg-[#526F93]/20 text-[#96C3E5] border border-[#789FC9]/30">
          {visible.length} available
        </span>
      </div>

      {/* Search Filter Input */}
      <div className="directory-search-wrap px-4 py-3 border-b border-white/[0.06] bg-black/25">
        <div className="relative flex items-center w-full">
          <span className="absolute left-3 text-[#607586] pointer-events-none">
            <Icon name="search" size={14} />
          </span>
          <input
            type="text"
            placeholder="Search courses by title or topic..."
            value={searchQuery}
            onChange={onSearchChange}
            className="directory-search-input w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-white/[0.04] border border-white/[0.08] text-[#EEF6FB] placeholder-[#607586] focus:outline-none focus:border-[#789FC9]/60 transition-colors"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={onClearSearch}
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
          const isSelected = course.id === (activeCourseId || visible[0]?.id);
          const stats = statsMap.get(course.id);

          return (
            <CourseDirectoryItem
              key={course.id || i}
              course={course}
              isSelected={isSelected}
              stats={stats}
              index={i}
              onSelect={onSelectCourse}
              onHover={onHoverCourse}
            />
          );
        })}
      </div>
    </section>
  );
});

// ==========================================
// 9. MAIN COURSES PAGE (React 19 System Architecture)
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

  // React 19 useTransition: non-blocking state updates for hover and filter switching
  const [isPending, startTransition] = useTransition();

  // React 19 useDeferredValue: keep search input typing instantaneous while deferring list filtering
  const deferredSearchQuery = useDeferredValue(searchQuery);

  // Fast O(tasks) aggregation map cached for all courses
  const statsMap = useMemo(() => {
    const map = new Map();
    const tasks = data.tasks || [];

    // Prepopulate map for all courses
    for (let i = 0; i < courses.length; i++) {
      const c = courses[i];
      const allLessons = (c.modules || []).flatMap(m => m?.lessons || []);
      map.set(c.id, {
        total: 0,
        completed: 0,
        percent: 0,
        allLessonsCount: allLessons.length || 12
      });
    }

    // Single pass over tasks
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      const s = map.get(t.course_id);
      if (s) {
        s.total += 1;
        if (t.status === "completed") {
          s.completed += 1;
        }
      }
    }

    // Finalize percentage
    for (const s of map.values()) {
      if (s.total > 0) {
        s.percent = Math.round((s.completed / s.total) * 100);
      }
    }

    return map;
  }, [courses, data.tasks]);

  // Fast filter counts computation
  const filterCounts = useMemo(() => {
    let active = 0;
    let proposal = 0;
    let completed = 0;
    for (let i = 0; i < courses.length; i++) {
      const st = courses[i].status;
      if (st === "active") active++;
      else if (st === "proposal") proposal++;
      else if (st === "completed") completed++;
    }
    return {
      all: courses.length,
      active,
      proposal,
      completed
    };
  }, [courses]);

  // Filter courses by status and deferred search query
  const visible = useMemo(() => {
    const q = deferredSearchQuery.trim().toLowerCase();
    return courses.filter(c => {
      const matchStatus = courseFilter === "all" || c.status === courseFilter;
      if (!matchStatus) return false;
      if (!q) return true;
      return (
        (c.title || "").toLowerCase().includes(q) ||
        (c.summary || "").toLowerCase().includes(q)
      );
    });
  }, [courses, courseFilter, deferredSearchQuery]);

  // Active index determination
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

  // Transitions for responsive interactions
  const handleFilterChange = useCallback((value) => {
    startTransition(() => {
      setCourseFilter(value);
    });
  }, [setCourseFilter]);

  const handleHoverCourse = useCallback((id) => {
    startTransition(() => {
      setActiveCourseId(id);
    });
  }, []);

  const handleSelectCourse = useCallback((id) => {
    startTransition(() => {
      setActiveCourseId(id);
    });
  }, []);

  const handlePrev = useCallback(() => {
    if (visible.length <= 1) return;
    const prevIdx = (activeIndex - 1 + visible.length) % visible.length;
    startTransition(() => {
      setActiveCourseId(visible[prevIdx].id);
    });
  }, [activeIndex, visible]);

  const handleNext = useCallback(() => {
    if (visible.length <= 1) return;
    const nextIdx = (activeIndex + 1) % visible.length;
    startTransition(() => {
      setActiveCourseId(visible[nextIdx].id);
    });
  }, [activeIndex, visible]);

  const handleSearchChange = useCallback((e) => {
    setSearchQuery(e.target.value);
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
  }, []);

  return (
    <div className="courses-page-container flex flex-col gap-6">
      {/* Top Filter & Count Bar */}
      <CoursesFilterBar
        courseFilter={courseFilter}
        filterCounts={filterCounts}
        visibleCount={visible.length}
        totalCount={courses.length}
        onFilterChange={handleFilterChange}
        isPending={isPending}
      />

      {visible.length > 0 ? (
        /* TWO BOXED GRID LAYOUT */
        <div className="courses-two-box-layout items-start">
          {/* BOX 1 (LEFT): 3D PERSPECTIVE CARD SHOWCASE */}
          <Courses3DStage
            visible={visible}
            centerCourse={centerCourse}
            prevCourse={prevCourse}
            nextCourse={nextCourse}
            activeIndex={activeIndex}
            statsMap={statsMap}
            go={go}
            setProposal={setProposal}
            updateData={updateData}
            confirmDeleteCourse={confirmDeleteCourse}
            deletingCourseId={deletingCourseId}
            onPrev={handlePrev}
            onNext={handleNext}
            onSelectId={handleSelectCourse}
          />

          {/* BOX 2 (RIGHT): LIST STYLED LIST OF ALL COURSES */}
          <CoursesDirectory
            visible={visible}
            activeCourseId={centerCourse?.id || visible[0]?.id}
            searchQuery={searchQuery}
            onSearchChange={handleSearchChange}
            onClearSearch={handleClearSearch}
            statsMap={statsMap}
            onHoverCourse={handleHoverCourse}
            onSelectCourse={handleSelectCourse}
          />
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
