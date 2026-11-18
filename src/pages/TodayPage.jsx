import React, { useState, useMemo, useEffect, useRef } from "react";
import { Icon, Panel, EmptyState, minuteLabel, prettyDate } from "../components/common.jsx";

const STUDY_SLOTS = [
  { hour: 9, min: 0 },   // 9:00 AM
  { hour: 11, min: 0 },  // 11:00 AM
  { hour: 13, min: 30 }, // 1:30 PM
  { hour: 15, min: 30 }, // 3:30 PM
  { hour: 17, min: 30 }, // 5:30 PM
  { hour: 19, min: 0 },  // 7:00 PM
];

export function getTaskTimeMetrics(task, index = 0, totalDayTasks = 1) {
  const baseMinutes = Number(task?.estimated_minutes) || 25;
  let startH = 9;
  let startM = 0;

  if (task?.scheduled_at) {
    const d = new Date(task.scheduled_at);
    if (!Number.isNaN(d.getTime())) {
      startH = d.getHours();
      startM = d.getMinutes();
    }
  }

  // If outside grid bounds (8:00 AM - 8:00 PM) or defaulted to identical evening time (18:00:00) with multiple tasks:
  const isDefaultEvening = (startH === 18 && startM === 0);
  const isOutOfGrid = (startH < 8 || startH >= 20);

  if (isOutOfGrid || (isDefaultEvening && totalDayTasks > 1)) {
    const slot = STUDY_SLOTS[index % STUDY_SLOTS.length];
    startH = slot.hour;
    startM = slot.min;
  }

  const totalStartMin = startH * 60 + startM;
  const totalEndMin = totalStartMin + baseMinutes;
  const endH = Math.floor(totalEndMin / 60) % 24;
  const endM = totalEndMin % 60;

  const pad = (n) => String(n).padStart(2, "0");
  const ampm = startH >= 12 ? "PM" : "AM";
  const h12 = startH % 12 || 12;
  const endAmpm = endH >= 12 ? "PM" : "AM";
  const endH12 = endH % 12 || 12;

  let timeStr;
  if (ampm === endAmpm) {
    timeStr = `${h12}:${pad(startM)} – ${endH12}:${pad(endM)} ${endAmpm}`;
  } else {
    timeStr = `${h12}:${pad(startM)} ${ampm} – ${endH12}:${pad(endM)} ${endAmpm}`;
  }

  return {
    startH,
    startM,
    endH,
    endM,
    duration: baseMinutes,
    timeStr,
  };
}

export function formatTaskTimeSlot(task, index = 0, totalDayTasks = 1) {
  return getTaskTimeMetrics(task, index, totalDayTasks).timeStr;
}

export function TodayPage(p) {
  const { data, updateData, openLesson, request, remote, refreshRemote, flashToast, user } = p;
  
  // Default to Desktop Calendar Grid on desktop (>=1024px), Timeline on mobile
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      return "grid";
    }
    return "timeline";
  });
  
  const [selectedDay, setSelectedDay] = useState("all");
  const [weekOffset, setWeekOffset] = useState(0);
  const [courseFilter, setCourseFilter] = useState("all");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [miniCalMonthOffset, setMiniCalMonthOffset] = useState(0);
  const [rescheduleTask, setRescheduleTask] = useState(null);
  const [targetDateVal, setTargetDateVal] = useState("");
  const [rebalancing, setRebalancing] = useState(false);
  
  const miniCalRef = useRef(null);

  // Close mini-calendar on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (miniCalRef.current && !miniCalRef.current.contains(e.target)) {
        setCalendarOpen(false);
      }
    }
    if (calendarOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [calendarOpen]);

  // Lessons map for lookup of titles and module context
  const allLessons = p.allLessons || [];
  const allLessonsMap = useMemo(() => {
    const map = new Map();
    allLessons.forEach((l) => map.set(l.id, l));
    (data.courses || []).forEach((c) => {
      (c.modules || []).forEach((m) => {
        (m.lessons || []).forEach((l) => {
          if (l.id && !map.has(l.id)) {
            map.set(l.id, { ...l, courseTitle: c.title, moduleTitle: m.title });
          }
        });
      });
    });
    return map;
  }, [allLessons, data.courses]);

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
      .filter((t) => courseFilter === "all" || t.course_id === courseFilter)
      .sort(compareTodayTasks);
  }, [data.tasks, courseFilter]);

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

  // Generate 7-day week data based on weekOffset
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
        tasks: dayTasks,
        pretty: prettyDate(d.toISOString()),
      };
    });

    const monthName = monday.toLocaleString("default", { month: "long" });
    const year = monday.getFullYear();
    const weekStartPretty = monday.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekEndPretty = sunday.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

    return { days, monday, sunday, monthLabel: `${monthName} ${year}`, rangeLabel: `${weekStartPretty} – ${weekEndPretty}` };
  }, [weekOffset, tasks]);

  // Mini Calendar Month Grid
  const miniCalData = useMemo(() => {
    const base = new Date();
    base.setMonth(base.getMonth() + miniCalMonthOffset);
    const year = base.getFullYear();
    const month = base.getMonth();
    const monthName = base.toLocaleString("default", { month: "long" });
    
    const firstDayIndex = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevMonthTotal = new Date(year, month, 0).getDate();

    const cells = [];
    // Previous month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthTotal - i);
      cells.push({
        dayNum: prevMonthTotal - i,
        date: d,
        isCurrentMonth: false,
        isoDate: d.toISOString().slice(0, 10),
      });
    }
    // Current month days
    for (let i = 1; i <= totalDays; i++) {
      const d = new Date(year, month, i);
      const isToday = d.toDateString() === new Date().toDateString();
      cells.push({
        dayNum: i,
        date: d,
        isCurrentMonth: true,
        isToday,
        isoDate: d.toISOString().slice(0, 10),
      });
    }
    // Next month padding to complete 35 or 42 cells
    const remaining = 35 - cells.length;
    for (let i = 1; i <= (remaining >= 0 ? remaining : 42 - cells.length); i++) {
      const d = new Date(year, month + 1, i);
      cells.push({
        dayNum: i,
        date: d,
        isCurrentMonth: false,
        isoDate: d.toISOString().slice(0, 10),
      });
    }

    return { title: `${monthName} ${year}`, cells };
  }, [miniCalMonthOffset]);

  // Current Time Line Offset in Hours (8:00 AM to 8:00 PM)
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTimeTopPx = useMemo(() => {
    if (currentHour < 8 || currentHour >= 20) return null;
    const totalMinutesSince8am = (currentHour - 8) * 60 + currentMin;
    return totalMinutesSince8am * (96 / 60); // 96px per hour (1.6px/min)
  }, [currentHour, currentMin]);

  // User Greeting
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

  const todayTasks = useMemo(() => {
    const todayStr = new Date().toDateString();
    return tasks.filter((t) => new Date(t.scheduled_at || 0).toDateString() === todayStr);
  }, [tasks]);
  const todayCompletedCount = todayTasks.filter((t) => t.status === "completed").length;
  const todayTotalCount = todayTasks.length;
  const todayPercent = todayTotalCount > 0 ? Math.round((todayCompletedCount / todayTotalCount) * 100) : 0;

  // Smooth scroll-reveal observer for timeline list items
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll(".today-v2-day-group, .today-v2-timeline-item").forEach((el) => {
        el.classList.add("is-visible");
      });
      return;
    }

    const timer = setTimeout(() => {
      const elements = document.querySelectorAll(".today-v2-day-group, .today-v2-timeline-item");
      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
            }
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -20px 0px" }
      );

      elements.forEach((el) => observer.observe(el));
      return () => observer.disconnect();
    }, 40);

    return () => clearTimeout(timer);
  }, [tasks, selectedDay, weekOffset, viewMode]);

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

  // Reschedule Task handler
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

  const jumpToDate = (targetDate) => {
    const today = new Date();
    const curDay = today.getDay();
    const diffToMon = (curDay === 0 ? -6 : 1) - curDay;
    const currentMonday = new Date(today);
    currentMonday.setDate(today.getDate() + diffToMon);
    currentMonday.setHours(0, 0, 0, 0);

    const targetDayIndex = (targetDate.getDay() + 6) % 7;
    const targetMonday = new Date(targetDate);
    targetMonday.setDate(targetDate.getDate() - targetDayIndex);
    targetMonday.setHours(0, 0, 0, 0);

    const diffWeeks = Math.round((targetMonday.getTime() - currentMonday.getTime()) / (7 * 86400000));
    setWeekOffset(diffWeeks);
    setSelectedDay(targetDate.toISOString().slice(0, 10));
    setCalendarOpen(false);
  };

  const preferredDays = (data.settings?.preferredStudyDays || [1, 3, 5]).map(Number);
  const hourTicks = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

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

        {/* View Format Selector (Grid for Desktop, Timeline for Focus) */}
        <div className="today-v2-view-toggles" role="group" aria-label="Schedule view format">
          <button
            type="button"
            className={`today-v2-view-btn ${viewMode === "grid" ? "active" : ""}`}
            onClick={() => setViewMode("grid")}
            aria-pressed={viewMode === "grid"}
            title="Desktop Calendar Grid View"
          >
            <Icon name="layout" size={14} />
            <span>Calendar Grid</span>
          </button>
          <button
            type="button"
            className={`today-v2-view-btn ${viewMode === "timeline" ? "active" : ""}`}
            onClick={() => setViewMode("timeline")}
            aria-pressed={viewMode === "timeline"}
            title="Vertical Timetable Timeline"
          >
            <Icon name="clock" size={14} />
            <span>Timeline</span>
          </button>
        </div>
      </header>

      {/* ====================================================================
          VIEW 1: DESKTOP CALENDAR GRID (Matching media_1795017922039_0d0f90e5.jpg)
          ==================================================================== */}
      {viewMode === "grid" && (
        <section className="today-grid-card" aria-label="Weekly study schedule grid">
          {/* Top Control Bar */}
          <div className="today-grid-topbar">
            {/* Date Navigator + Mini-Calendar Popover Trigger */}
            <div className="today-grid-nav-cluster" ref={miniCalRef}>
              <button
                type="button"
                className="today-v2-week-nav-btn"
                title="Previous week"
                aria-label="Previous week"
                onClick={() => setWeekOffset((w) => w - 1)}
              >
                <Icon name="chevronLeft" size={14} />
              </button>

              <button
                type="button"
                className="today-grid-date-btn"
                onClick={() => setCalendarOpen((o) => !o)}
                title="Toggle month calendar"
                aria-expanded={calendarOpen}
              >
                <span>{weekOffset === 0 ? "Today" : weekData.rangeLabel}</span>
                <span className="text-xs text-[#91AA7A]">({weekData.monthLabel})</span>
              </button>

              <button
                type="button"
                className={`today-grid-cal-trigger-btn ${calendarOpen ? "active" : ""}`}
                title="Open calendar picker"
                aria-label="Open calendar picker"
                onClick={() => setCalendarOpen((o) => !o)}
              >
                <Icon name="calendar" size={15} />
              </button>

              <button
                type="button"
                className="today-v2-week-nav-btn"
                title="Next week"
                aria-label="Next week"
                onClick={() => setWeekOffset((w) => w + 1)}
              >
                <Icon name="chevronRight" size={14} />
              </button>

              {/* Floating Mini Calendar Popover (Matching Image 2) */}
              {calendarOpen && (
                <div className="today-grid-mini-cal-popover" role="dialog" aria-label="Month date picker">
                  <div className="today-grid-mini-cal-header">
                    <button
                      type="button"
                      className="today-v2-week-nav-btn"
                      onClick={() => setMiniCalMonthOffset((m) => m - 1)}
                      aria-label="Previous month"
                    >
                      <Icon name="chevronLeft" size={12} />
                    </button>
                    <span className="today-grid-mini-cal-title">{miniCalData.title}</span>
                    <button
                      type="button"
                      className="today-v2-week-nav-btn"
                      onClick={() => setMiniCalMonthOffset((m) => m + 1)}
                      aria-label="Next month"
                    >
                      <Icon name="chevronRight" size={12} />
                    </button>
                  </div>

                  <div className="today-grid-mini-cal-weekdays">
                    {["m", "t", "w", "t", "f", "s", "s"].map((w, i) => (
                      <span key={i} className="today-grid-mini-cal-weekday">{w}</span>
                    ))}
                  </div>

                  <div className="today-grid-mini-cal-days-grid">
                    {miniCalData.cells.map((cell, idx) => {
                      const isSel = selectedDay === cell.isoDate;
                      return (
                        <button
                          key={idx}
                          type="button"
                          className={`today-grid-mini-cal-day-cell ${cell.isCurrentMonth ? "" : "outside-month"} ${cell.isToday ? "is-today" : ""} ${isSel ? "selected" : ""}`}
                          onClick={() => jumpToDate(cell.date)}
                        >
                          {cell.dayNum}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Course Filter Dropdown (Kitai-Gorod selector from Image 2) */}
            <div className="flex items-center gap-3">
              <select
                className="today-grid-filter-select"
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                aria-label="Filter schedule by course"
              >
                <option value="all">All Courses ({data.courses?.length || 0})</option>
                {(data.courses || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>

              {/* Action Cluster */}
              {overdueTasks.length > 0 && (
                <button
                  type="button"
                  className="today-grid-rebalance-btn"
                  onClick={rebalanceSchedule}
                  disabled={rebalancing}
                  title="Rebalance overdue sessions across study days"
                >
                  <Icon name="clock" size={13} />
                  <span>{rebalancing ? "Rebalancing…" : `Rebalance (${overdueTasks.length}) ↻`}</span>
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="today-grid-table-wrap">
            {/* Header Row: Corner + 7 Day Columns */}
            <div className="today-grid-header-row">
              <div className="today-grid-time-corner">Time</div>
              {weekData.days.map((day) => (
                <div
                  key={day.isoDate}
                  className={`today-grid-header-day ${day.isToday ? "is-today" : ""}`}
                >
                  <span className="today-grid-header-day-label">{day.dayName}</span>
                  <span className="today-grid-header-day-num">{day.dayNum}</span>
                </div>
              ))}
            </div>

            {/* Grid Body */}
            <div className="today-grid-body">
              {/* Horizontal Current Time Indicator Line (Matching Image 2) */}
              {currentTimeTopPx !== null && weekOffset === 0 && (
                <div
                  className="today-grid-now-line"
                  style={{ top: `${currentTimeTopPx}px` }}
                  title={`Current time: ${now.toLocaleTimeString()}`}
                >
                  <div className="today-grid-now-dot" />
                </div>
              )}

              {/* Left Time Axis (8:00 AM to 8:00 PM) */}
              <div className="today-grid-time-axis">
                {hourTicks.map((hour) => {
                  const ampm = hour >= 12 ? "PM" : "AM";
                  const h12 = hour % 12 || 12;
                  return (
                    <div key={hour} className="today-grid-time-tick">
                      {h12}:00 {ampm}
                    </div>
                  );
                })}
              </div>

              {/* 7 Columns for Days */}
              {weekData.days.map((day, colIdx) => {
                let lastBottomPx = -1;
                return (
                  <div
                    key={day.isoDate}
                    className={`today-grid-column ${day.isToday ? "is-today" : ""}`}
                  >
                    {/* Hourly dashed dividing lines */}
                    {hourTicks.map((h) => (
                      <div key={h} className="today-grid-slot-hour" />
                    ))}

                    {/* Task Event Blocks inside this day column */}
                    {day.tasks.map((task, taskIdx) => {
                      const isDone = task.status === "completed";
                      const isPractice = task.task_type === "practice";
                      const isReview = task.task_type === "review";
                      const typeKey = isDone ? "completed" : isPractice ? "practice" : isReview ? "review" : "lesson";

                      const lessonMeta = (task.lesson_id && allLessonsMap.get(task.lesson_id)) || null;
                      const taskTitle = task.title || lessonMeta?.title || (task.task_type === "review" ? "Spaced Repetition Review" : task.task_type === "practice" ? "Practice Drill" : "Scheduled Lesson");
                      const courseTitle = task.course_title || lessonMeta?.courseTitle || p.activeCourse?.title || "Curriculum";

                      // Calculate realistic top offset and height inside grid using unified metrics
                      const metrics = getTaskTimeMetrics(task, taskIdx, day.tasks.length);
                      const scale = 96 / 60; // 96px per hour = 1.6px per minute
                      let topPx = Math.max(0, ((metrics.startH - 8) * 60 + metrics.startM) * scale);
                      const heightPx = Math.max(98, Math.round(metrics.duration * scale));

                      // Prevent card collisions on the same day if two tasks share identical slot
                      if (topPx < lastBottomPx + 8) {
                        topPx = lastBottomPx + 8;
                      }
                      lastBottomPx = topPx + heightPx;

                      const timeStr = metrics.timeStr;
                      const animDelayMs = colIdx * 40 + taskIdx * 60;

                      return (
                        <div
                          key={task.id}
                          className={`today-grid-event-block ${typeKey}`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                            animationDelay: `${animDelayMs}ms`,
                          }}
                          onClick={() => handleLaunchTask(task)}
                          title={`${taskTitle} (${timeStr}) - Click to start`}
                        >
                          <div className="today-grid-event-header">
                            <span className="today-grid-event-time">{timeStr}</span>
                            <span className={`today-grid-event-pill ${typeKey}`}>
                              {isDone ? "Done" : task.task_type || "Lesson"}
                            </span>
                          </div>

                          <h5 className="today-grid-event-title">{taskTitle}</h5>

                          <div className="today-grid-event-footer">
                            <span className="today-grid-event-course truncate">
                              {courseTitle}
                            </span>
                            <button
                              type="button"
                              className="today-grid-event-action-icon"
                              title="Reschedule session"
                              onClick={(e) => {
                                e.stopPropagation();
                                openRescheduleModal(task);
                              }}
                            >
                              <Icon name="calendar" size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ====================================================================
          VIEW 2 & 3: TIMELINE & AGENDA VIEWS (Matching Image 1)
          ==================================================================== */}
      {viewMode !== "grid" && (
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

                    {(() => {
                      const nextLessonMeta = next?.lesson_id ? allLessonsMap.get(next.lesson_id) : null;
                      const nextTitle = next?.title || nextLessonMeta?.title || (next?.task_type === "review" ? "Spaced Repetition Review" : next?.task_type === "practice" ? "Checkpoint Practice Drill" : "Scheduled Lesson");
                      const nextCourse = next?.course_title || nextLessonMeta?.courseTitle || p.activeCourse?.title || "Core Curriculum";
                      return (
                        <>
                          <h2 className="today-v2-hero-title">{nextTitle}</h2>
                          <div className="today-v2-hero-meta">
                            <span className="today-v2-hero-course-tag">
                              <Icon name="book" size={14} />
                              <span>{nextCourse}</span>
                            </span>
                            {nextLessonMeta?.moduleTitle && (
                              <>
                                <span>·</span>
                                <span>{nextLessonMeta.moduleTitle}</span>
                              </>
                            )}
                            <span>·</span>
                            <span>{minuteLabel(next?.estimated_minutes || 25)}</span>
                          </div>
                        </>
                      );
                    })()}

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

                            const lessonMeta = (task.lesson_id && allLessonsMap.get(task.lesson_id)) || null;
                            const taskTitle = task.title || lessonMeta?.title || (task.task_type === "review" ? "Spaced Repetition Review" : task.task_type === "practice" ? "Practice Drill & Checkpoint" : "Lesson Session");
                            const courseTitle = task.course_title || lessonMeta?.courseTitle || p.activeCourse?.title || "Curriculum";

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
                                style={{ transitionDelay: `${Math.min(idx * 50, 250)}ms` }}
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

                                    <h4 className="today-v2-card-title" title={taskTitle}>
                                      {taskTitle}
                                    </h4>

                                    <div className="today-v2-card-meta">
                                      <span className="today-v2-card-course">
                                        {courseTitle}
                                      </span>
                                      {lessonMeta?.moduleTitle && (
                                        <>
                                          <span>·</span>
                                          <span>{lessonMeta.moduleTitle}</span>
                                        </>
                                      )}
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
                                      aria-label={`Reschedule ${taskTitle}`}
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

          {/* Right Sidebar: Study Rhythm, Spaced Review & Daily Momentum */}
          <aside className="today-v2-side-col">
            {/* Daily Momentum / Completion Card */}
            <div className="today-v2-side-card">
              <div className="today-v2-side-header">
                <h3 className="today-v2-side-title">
                  <Icon name="check" size={18} />
                  <span>Daily momentum</span>
                </h3>
                <span className="today-v2-stat-pill">{todayPercent}%</span>
              </div>

              <div className="today-v2-stat-display">
                <span className="today-v2-stat-number">{todayCompletedCount}<span className="text-xl text-[#91AA7A]">/{todayTotalCount}</span></span>
                <span className="today-v2-stat-label">completed today</span>
              </div>

              {/* Progress bar */}
              <div className="today-v2-progress-track" role="progressbar" aria-valuenow={todayPercent} aria-valuemin="0" aria-valuemax="100">
                <div className="today-v2-progress-fill" style={{ width: `${todayPercent}%` }} />
              </div>

              <p className="today-v2-side-copy">
                {todayPercent === 100 && todayTotalCount > 0
                  ? "All daily sessions complete! Outstanding consistency."
                  : todayTotalCount === 0
                  ? "No sessions scheduled for today. Take a breather or explore upcoming modules."
                  : `${todayTotalCount - todayCompletedCount} more session${todayTotalCount - todayCompletedCount === 1 ? "" : "s"} to complete today's plan.`}
              </p>
            </div>

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
      )}

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
              <strong>{rescheduleTask.title || "Study Session"}</strong>
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
