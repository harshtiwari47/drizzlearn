import React, { useState, useMemo } from "react";
import { Icon, Panel, EmptyState, minuteLabel, prettyDate } from "../components/common.jsx";

function formatTaskTimeSlot(task, index = 0) {
  const baseMinutes = Number(task?.estimated_minutes) || 25;
  if (!task?.scheduled_at) {
    const startHour = 9 + Math.floor((index * 45) / 60);
    const startMin = (index * 45) % 60;
    const endTotal = startHour * 60 + startMin + baseMinutes;
    const endH = Math.floor(endTotal / 60);
    const endM = endTotal % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return `${startHour}:${pad(startMin)} – ${endH}:${pad(endM)}`;
  }
  const date = new Date(task.scheduled_at);
  if (Number.isNaN(date.getTime())) return `${baseMinutes}m`;
  let startHour = date.getHours();
  let startMin = date.getMinutes();
  if (startHour === 0 && startMin === 0) {
    startHour = 9;
  }
  if (index > 0 && startHour === 18 && startMin === 0) {
    const totalMin = startHour * 60 + startMin + index * 40;
    startHour = Math.floor(totalMin / 60) % 24;
    startMin = totalMin % 60;
  }
  const endTotal = startHour * 60 + startMin + baseMinutes;
  const endHour = Math.floor(endTotal / 60) % 24;
  const endMin = endTotal % 60;
  const pad = (n) => String(n).padStart(2, "0");
  const ampm = startHour >= 12 ? "PM" : "AM";
  const h12 = startHour % 12 || 12;
  const endAmpm = endHour >= 12 ? "PM" : "AM";
  const endH12 = endHour % 12 || 12;
  return `${h12}:${pad(startMin)} ${ampm} – ${endH12}:${pad(endMin)} ${endAmpm}`;
}

export function TodayPage(p) {
  const { data, updateData, openLesson, request, remote, refreshRemote, flashToast, user } = p;
  const [selectedDay, setSelectedDay] = useState("all");
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewMode, setViewMode] = useState("timeline"); // "timeline" | "compact"
  const [rescheduleTask, setRescheduleTask] = useState(null);
  const [targetDateVal, setTargetDateVal] = useState("");
  const [rebalancing, setRebalancing] = useState(false);

  // Roadmap & task sorting
  const { lessonOrderMap, courseOrderMap } = useMemo(() => {
    const lessonsByOrder = new Map(), coursesByOrder = new Map();
    (data.courses || []).forEach((course, cIdx) => {
      if (course?.id) coursesByOrder.set(course.id, cIdx);
      (course?.modules || []).forEach((mod, mIdx) => {
        const mPos = Number(mod?.position) || mIdx + 1;
        (mod?.lessons || []).forEach((lesson, lIdx) => {
          const lPos = Number(lesson?.position) || lIdx + 1;
          if (lesson?.id) lessonsByOrder.set(lesson.id, cIdx * 1_000_000 + mPos * 1_000 + lPos);
        });
      });
    });
    return { lessonOrderMap: lessonsByOrder, courseOrderMap: coursesByOrder };
  }, [data.courses]);

  const taskTypeRank = (t) => t?.task_type === "lesson" ? 0 : t?.task_type === "practice" ? 1 : 2;
  const roadmapRank = (t) => {
    if (t?.lesson_id && lessonOrderMap.has(t.lesson_id)) return lessonOrderMap.get(t.lesson_id);
    const cIdx = courseOrderMap.get(t?.course_id) ?? 999;
    if (Number(t?.module_position) > 0) {
      return cIdx * 1_000_000 + Number(t.module_position) * 1_000 + (Number(t?.lesson_position) || 0);
    }
    return cIdx * 1_000_000 + 999_000;
  };
  const dayStartMs = (iso) => {
    const d = new Date(iso || 0);
    return Number.isNaN(d.getTime()) ? 0 : new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const compareTodayTasks = (a, b) => {
    const dayDiff = dayStartMs(a.scheduled_at) - dayStartMs(b.scheduled_at);
    if (dayDiff !== 0) return dayDiff;
    const roadDiff = roadmapRank(a) - roadmapRank(b);
    if (roadDiff !== 0) return roadDiff;
    const typeDiff = taskTypeRank(a) - taskTypeRank(b);
    if (typeDiff !== 0) return typeDiff;
    return new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0);
  };

  const weekAgo = Date.now() - 7 * 86400000;
  const tasks = useMemo(() => {
    return [...(data.tasks || [])]
      .filter((t) => t.status !== "completed" || new Date(t.scheduled_at || 0).getTime() >= weekAgo)
      .sort(compareTodayTasks);
  }, [data.tasks]);

  const next = useMemo(() => tasks.find((t) => t.status !== "completed"), [tasks]);

  const groups = useMemo(() => {
    return tasks.reduce((acc, t) => {
      const key = prettyDate(t.scheduled_at);
      (acc[key] ??= []).push(t);
      return acc;
    }, {});
  }, [tasks]);

  const overdueTasks = useMemo(() => {
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    return (data.tasks || []).filter(
      (t) => t.status === "overdue" || (t.status !== "completed" && t.scheduled_at && new Date(t.scheduled_at).getTime() < startOfToday)
    );
  }, [data.tasks]);

  // Generate 7-day week strip based on weekOffset
  const weekData = useMemo(() => {
    const now = new Date();
    const curDay = now.getDay();
    const diffToMon = (curDay === 0 ? -6 : 1) - curDay;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMon + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);

    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const isoDate = d.toISOString().slice(0, 10);
      const isToday = d.toDateString() === now.toDateString();
      const dayLetters = ["M", "T", "W", "T", "F", "S", "S"];
      const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const dayTasks = tasks.filter((t) => {
        if (!t.scheduled_at) return false;
        return new Date(t.scheduled_at).toISOString().slice(0, 10) === isoDate;
      });
      return {
        date: d,
        isoDate,
        dayNum: d.getDate(),
        dayLetter: dayLetters[i],
        dayName: dayNames[i],
        isToday,
        hasTasks: dayTasks.length > 0,
        taskCount: dayTasks.length,
        pretty: prettyDate(d.toISOString()),
      };
    });

    const monthName = monday.toLocaleString("default", { month: "long" });
    const year = monday.getFullYear();
    return { days, monthLabel: `${monthName} ${year}` };
  }, [weekOffset, tasks]);

  // Personalized Greeting
  const learnerName = user?.fullName || data?.settings?.fullName || "Learner";
  const firstName = learnerName.split(/\s+/)[0] || "Learner";
  const greetingText = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return `Good morning, ${firstName}`;
    if (h < 18) return `Good afternoon, ${firstName}`;
    return `Good evening, ${firstName}`;
  }, [firstName]);

  const todayCount = tasks.filter((t) => new Date(t.scheduled_at || 0).toDateString() === new Date().toDateString() && t.status !== "completed").length;
  const totalIncomplete = (data.tasks || []).filter((t) => t.status !== "completed").length;

  // Rebalance Schedule logic
  async function rebalanceSchedule() {
    if (rebalancing) return;
    setRebalancing(true);
    const preferred = (data.settings.preferredStudyDays?.length ? data.settings.preferredStudyDays : [1, 3, 5]).map(Number);
    const sessionBudget = Number(data.settings.sessionMinutes) || 120;
    const incomplete = (data.tasks || []).filter((t) => t.status !== "completed").sort((a, b) => {
      const roadDiff = roadmapRank(a) - roadmapRank(b);
      if (roadDiff !== 0) return roadDiff;
      const typeDiff = taskTypeRank(a) - taskTypeRank(b);
      if (typeDiff !== 0) return typeDiff;
      return new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0);
    });
    if (!incomplete.length) {
      flashToast("No incomplete sessions to rebalance.");
      setRebalancing(false);
      return;
    }
    function nextStudyDay(start) {
      const d = new Date(start);
      while (!preferred.includes(d.getDay())) {
        d.setDate(d.getDate() + 1);
      }
      return d;
    }
    let cursor = new Date();
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(18, 0, 0, 0);
    let targetDay = nextStudyDay(cursor);
    let dayMinutes = 0;
    const updates = [];
    for (const task of incomplete) {
      const taskMinutes = Number(task.estimated_minutes) || 30;
      if (dayMinutes > 0 && dayMinutes + taskMinutes > sessionBudget) {
        const nextDay = new Date(targetDay);
        nextDay.setDate(nextDay.getDate() + 1);
        targetDay = nextStudyDay(nextDay);
        dayMinutes = 0;
      }
      updates.push({ id: task.id, scheduled_at: new Date(targetDay.getTime() + updates.length * 1000).toISOString() });
      dayMinutes += taskMinutes;
    }
    try {
      if (remote) {
        for (const u of updates) {
          await request(`tasks/${u.id}/reschedule`, { method: "POST", body: JSON.stringify({ scheduledAt: u.scheduled_at }) });
        }
        await refreshRemote();
      } else {
        updateData((d) => ({
          ...d,
          tasks: d.tasks.map((t) => {
            const m = updates.find((u) => u.id === t.id);
            return m ? { ...t, scheduled_at: m.scheduled_at, status: "rescheduled" } : t;
          }),
        }));
      }
      flashToast("Schedule rebalanced smoothly across your study rhythm.");
    } catch (error) {
      flashToast(error.message || "Failed to rebalance schedule.");
    } finally {
      setRebalancing(false);
    }
  }

  // Reschedule single task
  function openRescheduleModal(task) {
    setRescheduleTask(task);
    const initialIso = task.scheduled_at ? new Date(task.scheduled_at).toISOString().slice(0, 10) : new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    setTargetDateVal(initialIso);
  }

  async function applyReschedule(dateString) {
    if (!rescheduleTask || !dateString) return;
    const date = new Date(`${dateString}T18:00:00`);
    if (Number.isNaN(date.getTime())) {
      flashToast("Please pick a valid date.");
      return;
    }
    try {
      if (remote) {
        await request(`tasks/${rescheduleTask.id}/reschedule`, {
          method: "POST",
          body: JSON.stringify({ scheduledAt: date.toISOString() }),
        });
      }
      updateData((d) => ({
        ...d,
        tasks: d.tasks.map((t) =>
          t.id === rescheduleTask.id ? { ...t, scheduled_at: date.toISOString(), status: "rescheduled" } : t
        ),
      }));
      if (remote) await refreshRemote();
      flashToast("Session rescheduled. Progress preserved.");
    } catch (error) {
      flashToast(error.message || "Could not reschedule session.");
    } finally {
      setRescheduleTask(null);
    }
  }

  const handleLaunchTask = (task) => {
    if (!task) return;
    if (task.task_type === "review") p.go("flashcards");
    else if (task.task_type === "practice") {
      if (task.lesson_id) openLesson(task.lesson_id);
      else p.go("practice");
    } else if (task.task_type === "roadmap" || task.task_type === "milestone") p.go("course");
    else if (task.lesson_id) openLesson(task.lesson_id);
    else p.go("courses");
  };

  const preferredDays = (data.settings?.preferredStudyDays || [1, 3, 5]).map(Number);

  return (
    <div className="today-v2-container">
      {/* Header Greeting Bar */}
      <header className="today-v2-greeting-bar" aria-label="Today summary">
        <div className="today-v2-greeting-main">
          <h1 className="today-v2-greeting-title">
            <span>{greetingText}!</span>
            <span className="greeting-wave" aria-hidden="true">👋</span>
          </h1>
          <p className="today-v2-greeting-sub">
            <span className="today-v2-greeting-badge">
              <Icon name="calendar" size={13} />
              <span>{todayCount} {todayCount === 1 ? "session" : "sessions"} today</span>
            </span>
            <span>·</span>
            <span>{totalIncomplete} total in your current roadmap</span>
          </p>
        </div>

        <div className="today-v2-view-toggles" role="group" aria-label="View format">
          <button
            type="button"
            className={`today-v2-view-btn ${viewMode === "timeline" ? "active" : ""}`}
            onClick={() => setViewMode("timeline")}
            aria-pressed={viewMode === "timeline"}
          >
            <Icon name="clock" size={14} />
            <span>Timetable</span>
          </button>
          <button
            type="button"
            className={`today-v2-view-btn ${viewMode === "compact" ? "active" : ""}`}
            onClick={() => setViewMode("compact")}
            aria-pressed={viewMode === "compact"}
          >
            <Icon name="list" size={14} />
            <span>Agenda</span>
          </button>
        </div>
      </header>

      {/* Main Two-Column Bento Layout */}
      <div className="today-v2-grid">
        <main className="today-v2-main-col">
          {/* Featured Hero "Now / Next Up" Card (Matching Image 1) */}
          {next && (
            <section className="today-v2-hero-card" aria-label="Featured next study session">
              <div className="today-v2-hero-ambient-glow" aria-hidden="true" />
              <div className="today-v2-hero-inner">
                <div className="today-v2-hero-content">
                  <div className="today-v2-hero-tag-row">
                    <span className="today-v2-hero-now-badge">
                      <span className="today-v2-pulse-dot" aria-hidden="true" />
                      <span>{next.status === "in_progress" ? "Now" : "Up Next"}</span>
                    </span>
                    <span className="today-v2-hero-time-pill">
                      <Icon name="clock" size={13} />
                      <span>{formatTaskTimeSlot(next, 0)}</span>
                    </span>
                  </div>

                  <h2 className="today-v2-hero-title">{next.title}</h2>

                  <div className="today-v2-hero-meta">
                    <span className="today-v2-hero-course-tag">
                      <Icon name="book" size={14} />
                      <span>{next.course_title || p.activeCourse?.title || "Core Curriculum"}</span>
                    </span>
                    <span>·</span>
                    <span>{minuteLabel(next.estimated_minutes || 25)}</span>
                  </div>

                  <div className="today-v2-hero-action-row">
                    <button
                      className="today-v2-hero-cta"
                      type="button"
                      onClick={() => handleLaunchTask(next)}
                    >
                      <Icon name="play" size={16} />
                      <span>{next.task_type === "review" ? "Start review" : next.task_type === "practice" ? "Start practice drill" : "Join the lesson"}</span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  </div>
                </div>

                {/* Glass Graphic Tile (Stylized Graph from Mockup 1) */}
                <div className="today-v2-hero-graphic-tile" aria-hidden="true">
                  <div className="today-v2-graphic-reflection" />
                  <svg className="today-v2-graphic-svg" viewBox="0 0 72 64" fill="none">
                    <defs>
                      <linearGradient id="todayBarGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.85" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.2" />
                      </linearGradient>
                      <linearGradient id="todayLineGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#38bdf8" />
                        <stop offset="50%" stopColor="#818cf8" />
                        <stop offset="100%" stopColor="#c084fc" />
                      </linearGradient>
                    </defs>
                    <rect x="8" y="34" width="10" height="26" rx="4" fill="url(#todayBarGrad)" />
                    <rect x="24" y="24" width="10" height="36" rx="4" fill="url(#todayBarGrad)" />
                    <rect x="40" y="14" width="10" height="46" rx="4" fill="url(#todayBarGrad)" />
                    <rect x="56" y="28" width="10" height="32" rx="4" fill="url(#todayBarGrad)" />
                    <path d="M12 28L28 18L45 10L61 20" stroke="url(#todayLineGrad)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="28" r="4" fill="#090e17" stroke="#38bdf8" strokeWidth="2.5" />
                    <circle cx="28" cy="18" r="4" fill="#090e17" stroke="#818cf8" strokeWidth="2.5" />
                    <circle cx="45" cy="10" r="4" fill="#090e17" stroke="#c084fc" strokeWidth="2.5" />
                    <circle cx="61" cy="20" r="4" fill="#090e17" stroke="#c084fc" strokeWidth="2.5" />
                  </svg>
                </div>
              </div>
            </section>
          )}

          {/* Overdue / Missed Sessions Alert Banner */}
          {overdueTasks.length > 0 && (
            <aside className="today-v2-overdue-alert" role="alert" aria-label="Missed study sessions notice">
              <div className="today-v2-alert-copy">
                <div className="today-v2-alert-icon-box" aria-hidden="true">
                  <Icon name="clock" size={17} />
                </div>
                <div>
                  <strong className="block text-white font-semibold">
                    {overdueTasks.length} overdue or missed {overdueTasks.length === 1 ? "session" : "sessions"}
                  </strong>
                  <span className="text-xs text-learnos-muted">Keep your rhythm on track by auto-rebalancing across your study days.</span>
                </div>
              </div>
              <button
                className="today-v2-rebalance-btn"
                type="button"
                disabled={rebalancing}
                onClick={rebalanceSchedule}
              >
                {rebalancing ? <><span className="btn-spinner" /> Rebalancing…</> : <>Rebalance schedule ↻</>}
              </button>
            </aside>
          )}

          {/* Interactive Week Strip & Month Navigation (Matching Image 1 & 2) */}
          <nav className="today-v2-week-strip-card" aria-label="Weekly timetable navigation">
            <div className="today-v2-week-strip-header">
              <div className="today-v2-week-month-nav">
                <button
                  type="button"
                  className="today-v2-week-nav-btn"
                  title="Previous week"
                  aria-label="Previous week"
                  onClick={() => setWeekOffset((w) => w - 1)}
                >
                  <Icon name="chevronLeft" size={15} />
                </button>
                <span className="today-v2-week-month-label">{weekData.monthLabel}</span>
                <button
                  type="button"
                  className="today-v2-week-nav-btn"
                  title="Next week"
                  aria-label="Next week"
                  onClick={() => setWeekOffset((w) => w + 1)}
                >
                  <Icon name="chevronRight" size={15} />
                </button>
              </div>

              <div className="today-v2-week-actions">
                <button
                  type="button"
                  className={`today-v2-pill-btn ${weekOffset === 0 ? "active" : ""}`}
                  onClick={() => {
                    setWeekOffset(0);
                    setSelectedDay(new Date().toISOString().slice(0, 10));
                  }}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`today-v2-pill-btn ${selectedDay === "all" ? "active" : ""}`}
                  onClick={() => setSelectedDay("all")}
                >
                  All Days
                </button>
              </div>
            </div>

            {/* 7 Days Row */}
            <div className="today-v2-week-days-row" role="tablist" aria-label="Days of week">
              {weekData.days.map((day) => {
                const isSelected = selectedDay === day.isoDate;
                return (
                  <button
                    key={day.isoDate}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`today-v2-day-chip ${day.isToday ? "is-today" : ""} ${isSelected ? "selected" : ""}`}
                    onClick={() => setSelectedDay(day.isoDate)}
                  >
                    <span className="today-v2-day-name">{day.dayName}</span>
                    <span className="today-v2-day-number">{day.dayNum}</span>
                    <span className={`today-v2-day-dot ${day.hasTasks ? "has-tasks" : ""}`} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Vertical Timetable / Timeline List */}
          <div className="today-v2-timeline-section">
            {tasks.length > 0 ? (
              Object.entries(groups)
                .filter(([dayPretty, dayTasks]) => {
                  if (selectedDay === "all") return true;
                  return dayTasks.some((t) => {
                    if (!t.scheduled_at) return false;
                    return new Date(t.scheduled_at).toISOString().slice(0, 10) === selectedDay;
                  });
                })
                .map(([dayPretty, dayTasks]) => {
                  const completedCount = dayTasks.filter((t) => t.status === "completed").length;
                  const allDone = completedCount === dayTasks.length;
                  return (
                    <section key={dayPretty} className="today-v2-day-group" aria-label={`Schedule for ${dayPretty}`}>
                      <div className="today-v2-day-header">
                        <h3 className="today-v2-day-header-title">
                          <span>{dayPretty}</span>
                          {dayPretty === prettyDate(new Date().toISOString()) && (
                            <span className="today-v2-day-header-pill">Today</span>
                          )}
                        </h3>
                        <span className={`today-v2-day-completion-tag ${allDone ? "all-done" : ""}`}>
                          {completedCount} / {dayTasks.length} complete
                        </span>
                      </div>

                      <div className="today-v2-timeline-track">
                        <div className="today-v2-timeline-spine" aria-hidden="true" />

                        {dayTasks.map((task, idx) => {
                          const isDone = task.status === "completed";
                          const isPractice = task.task_type === "practice";
                          const isReview = task.task_type === "review";
                          const typeKey = isDone ? "completed" : isPractice ? "practice" : isReview ? "review" : "lesson";
                          const timeStr = formatTaskTimeSlot(task, idx);

                          const actionLabel = isDone
                            ? "Review"
                            : isReview
                            ? "Review ↗"
                            : isPractice
                            ? "Practice ↗"
                            : "Start Lesson ↗";

                          const btnClass = isDone
                            ? "completed-btn"
                            : isReview
                            ? "review-btn"
                            : isPractice
                            ? "practice-btn"
                            : "";

                          return (
                            <article
                              key={task.id}
                              className="today-v2-timeline-item"
                              data-task-type={task.task_type || "lesson"}
                              data-task-status={task.status}
                            >
                              {/* Milestone Node on Spine */}
                              <div className={`today-v2-milestone-node ${typeKey}`} aria-hidden="true">
                                {isDone ? (
                                  <Icon name="check" size={11} />
                                ) : (
                                  <span className="today-v2-milestone-inner-dot" />
                                )}
                              </div>

                              {/* Timetable Card */}
                              <div className={`today-v2-timetable-card ${typeKey}`}>
                                <div className="today-v2-card-main">
                                  <div className="today-v2-card-top-row">
                                    <span className="today-v2-card-time">{timeStr}</span>
                                    <span className={`today-v2-type-pill ${typeKey}`}>
                                      {isDone ? "Completed" : task.task_type || "Lesson"}
                                    </span>
                                    {task.status === "in_progress" && (
                                      <span className="today-v2-type-pill lesson">In Progress</span>
                                    )}
                                  </div>

                                  <h4 className="today-v2-card-title" title={task.title}>
                                    {task.title}
                                  </h4>

                                  <div className="today-v2-card-meta">
                                    <span className="today-v2-card-course">
                                      {task.course_title || p.activeCourse?.title || "Curriculum"}
                                    </span>
                                    <span>·</span>
                                    <span>{minuteLabel(task.estimated_minutes || 25)}</span>
                                  </div>
                                </div>

                                <div className="today-v2-card-actions">
                                  <button
                                    type="button"
                                    className={`today-v2-card-btn ${btnClass}`}
                                    onClick={() => handleLaunchTask(task)}
                                  >
                                    <span>{actionLabel}</span>
                                  </button>

                                  <button
                                    type="button"
                                    className="today-v2-card-reschedule-btn"
                                    title="Reschedule session"
                                    aria-label={`Reschedule ${task.title}`}
                                    onClick={() => openRescheduleModal(task)}
                                  >
                                    <Icon name="calendar" size={15} />
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })
            ) : (
              <EmptyState
                title="No study sessions scheduled yet"
                body="Build your course plan and approved roadmap sessions will appear on this interactive timetable."
                action="Explore courses"
                onAction={() => p.go("courses")}
              />
            )}
          </div>
        </main>

        {/* Right Sidebar: Study Rhythm, Review Due & Habits */}
        <aside className="today-v2-side-col">
          {/* Study Rhythm Glass Panel */}
          <div className="today-v2-side-card">
            <div className="today-v2-side-header">
              <h3 className="today-v2-side-title">
                <Icon name="calendar" size={18} />
                <span>Study rhythm</span>
              </h3>
            </div>

            <div className="today-v2-stat-display">
              <span className="today-v2-stat-number">{totalIncomplete}</span>
              <span className="today-v2-stat-label">sessions remaining</span>
            </div>

            <p className="today-v2-side-copy">
              Plans are paced around your {Number(data.settings?.sessionMinutes) || 120} min session budget.
            </p>

            <div className="today-v2-days-pills-row" aria-label="Preferred study days">
              {["S", "M", "T", "W", "T", "F", "S"].map((letter, i) => (
                <span
                  key={i}
                  className={`today-v2-day-indicator ${preferredDays.includes(i) ? "active" : ""}`}
                  title={`${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i]} ${preferredDays.includes(i) ? "(Study Day)" : ""}`}
                >
                  {letter}
                </span>
              ))}
            </div>

            <button
              type="button"
              className="today-v2-side-link-btn"
              onClick={() => p.go("settings")}
            >
              <span>Edit study schedule in Settings</span>
              <span aria-hidden="true">↗</span>
            </button>
          </div>

          {/* Review Due Glass Panel */}
          {(p.dueCards?.length > 0 || tasks.length > 0) && (
            <div className="today-v2-side-card">
              <div className="today-v2-side-header">
                <h3 className="today-v2-side-title review-title">
                  <Icon name="cards" size={18} />
                  <span>Spaced Review</span>
                </h3>
              </div>

              <div className="today-v2-stat-display">
                <span className="today-v2-stat-number review-color">{p.dueCards?.length || 0}</span>
                <span className="today-v2-stat-label">cards due now</span>
              </div>

              <p className="today-v2-side-copy">
                Prompt spaced repetition recall to lock lessons into your long-term memory.
              </p>

              <button
                type="button"
                className="today-v2-side-cta-btn"
                onClick={() => p.go("flashcards")}
              >
                <span>Launch Spaced Review</span>
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          )}
        </aside>
      </div>

      {/* Reschedule Modal */}
      {rescheduleTask && (
        <div
          className="today-v2-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reschedule-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setRescheduleTask(null);
          }}
        >
          <div className="today-v2-modal-card">
            <div className="today-v2-modal-header">
              <h3 id="reschedule-modal-title" className="today-v2-modal-title">Reschedule Session</h3>
              <button
                type="button"
                className="today-v2-modal-close"
                aria-label="Close modal"
                onClick={() => setRescheduleTask(null)}
              >
                ✕
              </button>
            </div>

            <div className="today-v2-modal-task-preview">
              <span className="text-xs text-learnos-muted">Task to move</span>
              <strong>{rescheduleTask.title}</strong>
              <small className="text-learnos-muted">
                Currently: {prettyDate(rescheduleTask.scheduled_at)}
              </small>
            </div>

            <div className="today-v2-presets-row">
              <button
                type="button"
                className="today-v2-preset-chip"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 1);
                  setTargetDateVal(d.toISOString().slice(0, 10));
                }}
              >
                Tomorrow
              </button>
              <button
                type="button"
                className="today-v2-preset-chip"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 3);
                  setTargetDateVal(d.toISOString().slice(0, 10));
                }}
              >
                In 3 Days
              </button>
              <button
                type="button"
                className="today-v2-preset-chip"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 7);
                  setTargetDateVal(d.toISOString().slice(0, 10));
                }}
              >
                Next Week
              </button>
            </div>

            <div className="today-v2-date-input-wrap">
              <label htmlFor="reschedule-date-picker">Target Date</label>
              <input
                id="reschedule-date-picker"
                type="date"
                className="today-v2-date-input"
                value={targetDateVal}
                onChange={(e) => setTargetDateVal(e.target.value)}
              />
            </div>

            <div className="today-v2-modal-actions">
              <button
                type="button"
                className="today-v2-modal-cancel"
                onClick={() => setRescheduleTask(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="today-v2-modal-save"
                onClick={() => applyReschedule(targetDateVal)}
              >
                Save Date
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
