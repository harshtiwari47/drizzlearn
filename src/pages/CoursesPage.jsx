import React, { useMemo } from "react";
import { Icon, courseCovers } from "../components/common.jsx";

function CoursesPage(p){
  const {data,courseFilter,setCourseFilter,go,updateData}=p;
  const courses = data.courses || [];
  const visible = courses.filter(c => courseFilter === "all" || c.status === courseFilter);
  const filterCounts = React.useMemo(() => ({
    all: courses.length,
    active: courses.filter(c => c.status === "active").length,
    proposal: courses.filter(c => c.status === "proposal").length,
    completed: courses.filter(c => c.status === "completed").length
  }), [courses]);

  return (
    <div className="courses-page-container flex flex-col gap-6">
      {/* Filters row with count pills */}
      <div className="filter-row flex flex-wrap items-center justify-between gap-3" role="group" aria-label="Filter courses">
        <div className="flex flex-wrap items-center gap-2">
          {[["all","All courses"],["active","Active"],["proposal","Proposals"],["completed","Completed"]].map(([value,label]) => {
            const count = filterCounts[value] ?? 0;
            const isSelected = courseFilter === value;
            return (
              <button 
                key={value} 
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

      {visible.length ? (
        <div className="course-library-grid grid grid-cols-1 md:grid-cols-2 gap-6">
          {visible.map((course, i) => {
            const all = (course.modules || []).flatMap(m => m?.lessons || []);
            const courseTasks = (data.tasks || []).filter(t => t.course_id === course.id);
            const done = courseTasks.filter(t => t.status === "completed").length;
            const percent = courseTasks.length ? Math.round(done / courseTasks.length * 100) : 0;
            const coverIdx = i % courseCovers.length;
            const isProposal = course.status === "proposal";
            const levelText = course.current_level || course.currentLevel || "Beginner";
            const durationText = `${course.target_weeks || course.durationWeeks || 8} weeks`;
            const hoursEst = Math.round((course.estimated_minutes || 0) / 60) || 1;

            return (
              <article 
                className={`library-course modern-course-card panel flex flex-col overflow-hidden relative group status-${course.status || "active"}`} 
                key={course.id}
              >
                {/* Glowing Specular Top Highlight */}
                <div className="course-card-glow-bar" aria-hidden="true" />

                {/* Integrated Cover Header */}
                <div 
                  className="library-cover modern-library-cover flex items-center justify-between"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(8, 16, 26, 0.45) 0%, rgba(6, 12, 19, 0.95) 100%), url(${courseCovers[coverIdx]})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center 30%"
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="course-cat-tag flex items-center gap-1.5">
                      <span className="cat-spark text-cyan-400 text-xs">✦</span>
                      <span>{isProposal ? "DRAFT PLAN" : "LEARNING PATH"}</span>
                    </span>
                  </div>
                  <span className={`status-pill modern-status-pill ${course.status}`}>
                    <span className="status-dot" />
                    {course.status}
                  </span>
                </div>

                {/* Card Content */}
                <div className="library-course-content flex flex-col flex-1 p-5 gap-3.5 relative z-10">
                  {/* Level & Duration with high contrast */}
                  <div className="course-meta-small flex items-center gap-2 text-xs">
                    <span className="meta-badge-level">{levelText}</span>
                    <span className="meta-sep text-slate-500">·</span>
                    <span className="meta-badge-duration flex items-center gap-1.5">
                      <Icon name="clock" size={12} />
                      {durationText}
                    </span>
                  </div>

                  {/* Title & Summary */}
                  <div className="flex flex-col gap-1.5">
                    <h2 className="course-card-heading text-lg font-bold text-white tracking-tight group-hover:text-cyan-300 transition-colors">
                      {course.title}
                    </h2>
                    <p className="course-card-desc text-xs text-slate-300 leading-relaxed line-clamp-2">
                      {course.summary || course.desired_outcome}
                    </p>
                  </div>

                  {/* Stats Chips (Lessons, Modules, Hours) */}
                  <div className="course-facts flex flex-wrap items-center gap-2 text-xs mt-1">
                    <span className="course-stat-chip">
                      <Icon name="book" size={13} />
                      <span>{all.length} lessons</span>
                    </span>
                    <span className="course-stat-chip">
                      <Icon name="progress" size={13} />
                      <span>{course.modules?.length || 0} modules</span>
                    </span>
                    <span className="course-stat-chip">
                      <Icon name="clock" size={13} />
                      <span>{hoursEst} hours</span>
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="course-progress-row flex flex-col gap-1.5 mt-auto pt-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-400">Course Progress</span>
                      <span className={`progress-number ${percent > 0 ? "text-cyan-400" : "text-slate-400"}`}>
                        {percent}%
                      </span>
                    </div>
                    <div className="progress-track flex-1 overflow-hidden">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${Math.max(percent, percent > 0 ? 3 : 0)}%` }} 
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="library-actions flex items-center gap-3 pt-3 border-t border-slate-800/60 mt-1">
                    {isProposal ? (
                      <button 
                        className="primary-btn course-open-btn flex items-center gap-1.5" 
                        onClick={() => {
                          p.setProposal(course);
                          updateData(x => ({ ...x, activeCourseId: course.id }));
                          go("proposal", { params: { courseId: course.id } });
                        }}
                      >
                        <span>Review plan</span>
                        <span className="btn-arrow">↗</span>
                      </button>
                    ) : (
                      <button 
                        className="primary-btn course-open-btn flex items-center gap-1.5" 
                        onClick={() => {
                          updateData(x => ({ ...x, activeCourseId: course.id }));
                          go("course", { params: { courseId: course.id } });
                        }}
                      >
                        <span>Open course</span>
                        <span className="btn-arrow">↗</span>
                      </button>
                    )}

                    <div className="library-actions-secondary flex items-center gap-2 ml-auto">
                      <button 
                        type="button" 
                        className="quiet-btn course-more-btn grid place-items-center" 
                        aria-label={`View roadmap for ${course.title}`} 
                        title="View roadmap"
                        onClick={() => {
                          updateData(x => ({ ...x, activeCourseId: course.id }));
                          go(isProposal ? "proposal" : "course", { params: { courseId: course.id } });
                          if (isProposal) p.setProposal(course);
                        }}
                      >
                        ⋯
                      </button>
                      {p.confirmDeleteCourse && (
                        <button 
                          type="button" 
                          className="quiet-btn danger course-delete-btn flex items-center gap-1.5" 
                          aria-label={`Delete ${course.title}`} 
                          title="Delete course"
                          disabled={p.deletingCourseId === course.id} 
                          onClick={() => p.confirmDeleteCourse(course)}
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
          })}
        </div>
      ) : (
        <EmptyState 
          title="No courses yet" 
          body="Write down the capability you want to build. Sign in to generate a course plan with lessons and practice." 
          action="Create a learning goal" 
          onAction={() => go("goal")}
        />
      )}
    </div>
  );
}

export { CoursesPage };
