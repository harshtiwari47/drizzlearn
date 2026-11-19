import React, { useState, useMemo } from "react";
import { Icon, collectAllCourseLessons } from "../components/common.jsx";
import { calculateLearnerMetrics } from "../behavior-tracking.js";
import { EvidenceList } from "./PracticePage.jsx";

function ProgressPage(p) {
  const [courseFilter, setCourseFilter] = useState(() => p.routeQuery?.get?.("course") || "all");
  const allCourses = p.data?.courses || [];
  const allLessons = useMemo(
    () => (p.allLessons?.length ? p.allLessons : collectAllCourseLessons(allCourses, p.lessons, p.activeCourse)),
    [p.allLessons, allCourses, p.lessons, p.activeCourse]
  );
  const lessonCourseMap = useMemo(() => {
    const map = new Map();
    allLessons.forEach(l => {
      if (l.id && l.courseId) map.set(l.id, l.courseId);
    });
    return map;
  }, [allLessons]);

  const scopedTasks = useMemo(
    () => (courseFilter === "all" ? p.data?.tasks || [] : (p.data?.tasks || []).filter(t => t.course_id === courseFilter)),
    [p.data?.tasks, courseFilter]
  );
  const scopedAttempts = useMemo(
    () =>
      courseFilter === "all"
        ? p.data?.attempts || []
        : (p.data?.attempts || []).filter(a => (a.course_id || lessonCourseMap.get(a.lesson_id)) === courseFilter),
    [p.data?.attempts, courseFilter, lessonCourseMap]
  );

  const done = scopedTasks.filter(t => t.status === "completed").length;
  const total = scopedTasks.length;
  const passed = scopedAttempts.filter(a => Number(a.score) >= 70).length;
  const concepts = [...new Set(scopedAttempts.filter(a => Number(a.score) >= 70).map(a => a.concept))];

  const byWeek = Array.from({ length: 6 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (5 - i) * 7);
    const week = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const matches = scopedTasks.filter(t => {
      const d = new Date(t.scheduled_at || 0);
      const diff = (date - d) / (1000 * 60 * 60 * 24);
      return diff >= 0 && diff < 7;
    });
    return {
      week,
      value: matches.filter(t => t.status === "completed").length,
      total: matches.length,
    };
  });

  // Rich User Behavior & Learning Telemetry Metrics
  const metrics = useMemo(() => calculateLearnerMetrics(p.data, p.data?.settings || {}), [p.data]);
  const progressPct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="progress-page-wrapper">
      {/* 1. Header Bar with Eyebrow, Title & Course Selector */}
      <header className="progress-top-bar flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="progress-eyebrow">LEARNING METRICS & MASTERY</span>
          <h1 className="progress-top-heading">Learning Progress</h1>
          <p className="progress-top-subtext">
            Real-time velocity, retention metrics, and concept mastery tracked across your learning goals.
          </p>
        </div>

        {allCourses.length > 0 && (
          <div className="progress-filter-box flex items-center gap-2">
            <label htmlFor="progressCourseFilter" className="progress-filter-label text-xs font-semibold text-learnos-muted">
              Scope:
            </label>
            <div className="relative">
              <select
                id="progressCourseFilter"
                value={courseFilter}
                onChange={e => setCourseFilter(e.target.value)}
                aria-label="Filter progress by course"
                className="progress-course-select"
              >
                <option value="all">All courses ({allCourses.length})</option>
                {allCourses.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </header>

      {/* 2. Primary Behavioral KPI Cards (Glassmorphism + Glowing Accent Orbs) */}
      <div className="progress-kpi-grid">
        {/* KPI 1: Daily Active Streak */}
        <div className="progress-kpi-card streak-card">
          <div className="kpi-card-head flex items-center justify-between">
            <span className="kpi-label">DAILY STREAK</span>
            <span className="kpi-icon-orb orb-amber" aria-hidden="true">
              <Icon name="flame" size={16} />
            </span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value-row">
              <span className="kpi-value-number">{metrics.streak.streakDays}</span>
              <span className="kpi-value-unit">day{metrics.streak.streakDays === 1 ? "" : "s"}</span>
            </div>
            <p className="kpi-caption">
              {metrics.streak.activeToday ? (
                <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                  <span className="kpi-pulse-dot bg-emerald-400" /> Active today · Streak sustained
                </span>
              ) : metrics.streak.streakDays > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-amber-300 font-medium">
                  <span className="kpi-pulse-dot bg-amber-400" /> Practice today to maintain
                </span>
              ) : (
                "Start your learning streak"
              )}
            </p>
          </div>
        </div>

        {/* KPI 2: Weekly Commitment */}
        <div className="progress-kpi-card commitment-card">
          <div className="kpi-card-head flex items-center justify-between">
            <span className="kpi-label">WEEKLY COMMITMENT</span>
            <span className="kpi-icon-orb orb-teal" aria-hidden="true">
              <Icon name="clock" size={16} />
            </span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value-row">
              <span className="kpi-value-number">{metrics.studyTime.weeklyMinutesSpent}</span>
              <span className="kpi-value-unit">/ {metrics.studyTime.weeklyGoalMinutes}m</span>
            </div>
            <div className="kpi-bar-wrap">
              <div
                className="kpi-bar-fill fill-teal"
                style={{ width: `${Math.min(100, metrics.studyTime.weeklyGoalPct)}%` }}
              />
            </div>
            <p className="kpi-caption">
              {metrics.studyTime.weeklyGoalPct}% achieved ·{" "}
              {metrics.studyTime.remainingMinutes > 0
                ? `${metrics.studyTime.remainingMinutes}m remaining`
                : "Weekly target reached"}
            </p>
          </div>
        </div>

        {/* KPI 3: Spaced Retention Rate */}
        <div className="progress-kpi-card retention-card">
          <div className="kpi-card-head flex items-center justify-between">
            <span className="kpi-label">RETENTION RATE</span>
            <span className="kpi-icon-orb orb-violet" aria-hidden="true">
              <Icon name="brain" size={16} />
            </span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value-row">
              <span className="kpi-value-number">{metrics.retention.retentionRate}%</span>
              <span className="kpi-value-unit">recall score</span>
            </div>
            <p className="kpi-caption">
              {metrics.retention.masteredCards} cards mastered · {metrics.retention.totalCardReviews} reviews logged
            </p>
          </div>
        </div>

        {/* KPI 4: Practice Accuracy */}
        <div className="progress-kpi-card accuracy-card">
          <div className="kpi-card-head flex items-center justify-between">
            <span className="kpi-label">PRACTICE ACCURACY</span>
            <span className="kpi-icon-orb orb-lime" aria-hidden="true">
              <Icon name="target" size={16} />
            </span>
          </div>
          <div className="kpi-card-body">
            <div className="kpi-value-row">
              <span className="kpi-value-number">{metrics.practice.passRate}%</span>
              <span className="kpi-value-unit">pass rate</span>
            </div>
            <p className="kpi-caption">
              {metrics.practice.passedAttempts} of {metrics.practice.totalAttempts} attempts passed (≥70%)
            </p>
          </div>
        </div>
      </div>

      {/* 3. Main Dashboard 2-Column Grid */}
      <div className="progress-content-grid">
        {/* Left Column: Study Activity & 7-Day Rhythm */}
        <div className="progress-column flex flex-col gap-5">
          {/* Section: Study Activity */}
          <section className="progress-glass-card">
            <div className="progress-card-head flex items-center justify-between gap-2 flex-wrap">
              <div className="card-head-title flex items-center gap-2.5">
                <span className="card-head-icon-box teal" aria-hidden="true">
                  <Icon name="progress" size={16} />
                </span>
                <h2>Study Activity</h2>
              </div>
              <span className="card-head-badge">
                {courseFilter === "all" ? "All Courses" : "Filtered View"}
              </span>
            </div>

            <div className="progress-card-body flex flex-col gap-5">
              <div className="progress-hero-stat-row flex items-center gap-5">
                <div className="progress-donut-ring" style={{ "--progress": `${progressPct}%` }}>
                  <div className="donut-center">
                    <strong>{progressPct}%</strong>
                    <span>done</span>
                  </div>
                </div>
                <div className="progress-hero-copy">
                  <h3>{done} of {total} sessions completed</h3>
                  <p>Task completion tracks the work you finished across your planned study sessions.</p>
                </div>
              </div>

              {/* 6-Week Activity Chart */}
              <div className="progress-chart-container">
                <span className="chart-title">Weekly Sessions Velocity</span>
                <div className="progress-bars-row">
                  {byWeek.map((item, i) => (
                    <div className="progress-bar-col" key={i}>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{
                            height: `${item.total ? Math.max(12, (item.value / item.total) * 100) : 6}%`,
                          }}
                          title={`${item.value} completed of ${item.total} planned sessions`}
                        />
                      </div>
                      <span className="bar-label">{item.week}</span>
                    </div>
                  ))}
                </div>
                <div className="chart-legend flex items-center gap-4 text-xs mt-3">
                  <span className="flex items-center gap-1.5 text-learnos-muted">
                    <span className="legend-dot active" /> Completed sessions
                  </span>
                  <span className="flex items-center gap-1.5 text-learnos-muted">
                    <span className="legend-dot planned" /> Planned sessions
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Section: 7-Day Learning Rhythm & Modality Breakdown */}
          <section className="progress-glass-card">
            <div className="progress-card-head flex items-center justify-between">
              <div className="card-head-title flex items-center gap-2.5">
                <span className="card-head-icon-box violet" aria-hidden="true">
                  <Icon name="spark" size={16} />
                </span>
                <h2>7-Day Learning Rhythm</h2>
              </div>
              <span className="card-head-sub">Daily engagement</span>
            </div>

            <div className="progress-card-body flex flex-col gap-4">
              <div className="rhythm-bars-grid">
                {metrics.rhythm.map((d, i) => (
                  <div key={i} className={`rhythm-col ${d.isToday ? "is-today" : ""}`}>
                    <div className="rhythm-track">
                      <div
                        className={`rhythm-fill ${d.active ? "active" : ""}`}
                        style={{
                          height: `${d.eventsCount ? Math.max(16, Math.min(100, d.eventsCount * 24)) : 8}%`,
                        }}
                        title={`${d.dayName} (${d.label}): ${d.eventsCount} actions, ~${d.minutes}m`}
                      />
                    </div>
                    <span className="rhythm-day">{d.dayName}</span>
                    {d.isToday && <span className="rhythm-today-badge">TODAY</span>}
                  </div>
                ))}
              </div>

              {/* Modality Distribution without text emojis */}
              <div className="modality-distribution-wrap pt-3 border-t border-learnos-line/20">
                <div className="flex items-center justify-between text-xs text-learnos-muted mb-2.5">
                  <span className="font-semibold text-slate-300">Learning Modality Distribution</span>
                  <span className="text-slate-400">Share of activity</span>
                </div>
                <div className="modality-pills-row">
                  <span className="modality-pill pill-indigo">
                    <Icon name="book" size={13} />
                    <span>Roadmap</span>
                    <strong>{metrics.modalityShares.roadmap}%</strong>
                  </span>
                  <span className="modality-pill pill-lime">
                    <Icon name="zap" size={13} />
                    <span>Practice</span>
                    <strong>{metrics.modalityShares.practice}%</strong>
                  </span>
                  <span className="modality-pill pill-purple">
                    <Icon name="cards" size={13} />
                    <span>Flashcards</span>
                    <strong>{metrics.modalityShares.flashcards}%</strong>
                  </span>
                  <span className="modality-pill pill-teal">
                    <Icon name="tutor" size={13} />
                    <span>AI Tutor</span>
                    <strong>{metrics.modalityShares.tutor}%</strong>
                  </span>
                  <span className="modality-pill pill-amber">
                    <Icon name="notes" size={13} />
                    <span>Notes</span>
                    <strong>{metrics.modalityShares.notes}%</strong>
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Section: Memory & Spaced Repetition Insights */}
          <section className="progress-glass-card">
            <div className="progress-card-head flex items-center justify-between">
              <div className="card-head-title flex items-center gap-2.5">
                <span className="card-head-icon-box pink" aria-hidden="true">
                  <Icon name="cards" size={16} />
                </span>
                <h2>Memory & Spaced Repetition</h2>
              </div>
              <button
                type="button"
                className="progress-head-action-btn"
                onClick={() => p.go("flashcards")}
              >
                Review Cards ↗
              </button>
            </div>

            <div className="progress-card-body">
              <div className="grid grid-cols-3 gap-3">
                <div className="memory-stat-tile tile-green">
                  <span className="tile-label">Mastered</span>
                  <strong className="tile-value">{metrics.retention.masteredCards}</strong>
                  <span className="tile-sub">in long-term loop</span>
                </div>
                <div className="memory-stat-tile tile-purple">
                  <span className="tile-label">Learning</span>
                  <strong className="tile-value">{metrics.retention.learningCards}</strong>
                  <span className="tile-sub">active reviews</span>
                </div>
                <div className="memory-stat-tile tile-teal">
                  <span className="tile-label">Tutor Queries</span>
                  <strong className="tile-value">{metrics.tutor.totalInteractions}</strong>
                  <span className="tile-sub">assisted answers</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column: Concept Mastery & Course Progress */}
        <div className="progress-column flex flex-col gap-5">
          {/* Section: Concept Mastery & Practice Activity */}
          <section className="progress-glass-card">
            <div className="progress-card-head flex items-center justify-between">
              <div className="card-head-title flex items-center gap-2.5">
                <span className="card-head-icon-box emerald" aria-hidden="true">
                  <Icon name="award" size={16} />
                </span>
                <h2>Concept Mastery & Evidence</h2>
              </div>
              <button
                type="button"
                className="progress-head-action-btn"
                onClick={() => p.go("practice")}
              >
                Practice Lab ↗
              </button>
            </div>

            <div className="progress-card-body flex flex-col gap-4">
              <div className="mastery-summary-grid">
                <div className="mastery-summary-cell">
                  <strong>{passed}</strong>
                  <span>checkpoint passes</span>
                </div>
                <div className="mastery-summary-cell">
                  <strong>{concepts.length}</strong>
                  <span>concepts mastered</span>
                </div>
                <div className="mastery-summary-cell">
                  <strong>{scopedAttempts.length}</strong>
                  <span>attempts recorded</span>
                </div>
                <div className="mastery-summary-cell">
                  <strong>{scopedAttempts.length ? Math.round((passed / scopedAttempts.length) * 100) : 0}%</strong>
                  <span>mastery rate</span>
                </div>
              </div>

              {scopedAttempts.length > 0 ? (
                <EvidenceList attempts={scopedAttempts} pageSize={5} showControls={true} />
              ) : (
                <div className="progress-empty-box flex flex-col items-center justify-center p-6 text-center gap-2.5">
                  <div className="empty-box-icon grid place-items-center">
                    <Icon name="practice" size={20} />
                  </div>
                  <h4 className="font-semibold text-slate-200 text-sm">No practice attempts recorded</h4>
                  <p className="text-xs text-learnos-muted max-w-sm">
                    Complete checkpoint exercises or lesson quizzes to test your understanding and unlock mastery badges.
                  </p>
                  <button
                    type="button"
                    className="progress-cta-button mt-1"
                    onClick={() => p.go("practice")}
                  >
                    Start Practice Exercises ↗
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* Section: Course Progress Breakdown */}
          <section className="progress-glass-card">
            <div className="progress-card-head flex items-center justify-between">
              <div className="card-head-title flex items-center gap-2.5">
                <span className="card-head-icon-box blue" aria-hidden="true">
                  <Icon name="book" size={16} />
                </span>
                <h2>Curriculum Progress</h2>
              </div>
              {courseFilter !== "all" && (
                <button
                  type="button"
                  className="progress-head-action-btn"
                  onClick={() => setCourseFilter("all")}
                >
                  Show all courses
                </button>
              )}
            </div>

            <div className="progress-card-body flex flex-col gap-2.5">
              {allCourses.length > 0 ? (
                allCourses.map(c => {
                  const tasks = (p.data?.tasks || []).filter(t => t.course_id === c.id);
                  const complete = tasks.filter(t => t.status === "completed").length;
                  const isSelected = courseFilter === c.id;
                  const pct = tasks.length ? Math.round((complete / tasks.length) * 100) : 0;

                  return (
                    <button
                      type="button"
                      className={`course-progress-row ${isSelected ? "selected" : ""}`}
                      key={c.id}
                      onClick={() => setCourseFilter(isSelected ? "all" : c.id)}
                      aria-pressed={isSelected}
                    >
                      <div className="course-row-left">
                        <strong className="course-row-title">{c.title}</strong>
                        <span className="course-row-sub">
                          {complete} completed of {tasks.length} scheduled tasks
                        </span>
                      </div>
                      <div className="course-row-middle">
                        <div className="course-row-track">
                          <div className="course-row-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="course-row-right">
                        <span className="course-row-pct">{pct}%</span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="progress-empty-box flex flex-col items-center justify-center p-6 text-center gap-2.5">
                  <div className="empty-box-icon grid place-items-center">
                    <Icon name="book" size={20} />
                  </div>
                  <h4 className="font-semibold text-slate-200 text-sm">No courses enrolled</h4>
                  <p className="text-xs text-learnos-muted max-w-sm">
                    Create a learning goal and approve a personalized study plan to track module completion.
                  </p>
                  <button
                    type="button"
                    className="progress-cta-button mt-1"
                    onClick={() => p.go("home")}
                  >
                    Set a Learning Goal ↗
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export { ProgressPage };
