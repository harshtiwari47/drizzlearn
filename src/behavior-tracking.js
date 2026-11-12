/**
 * Drizzlearn User Behavior Tracking & Learning Telemetry
 * Captures real learner engagement events across courses, lessons, practice,
 * flashcards, tutor discussions, and study sessions to calculate actionable
 * progress parameters, active streaks, retention, and weekly goal velocity.
 */

const BEHAVIOR_STORAGE_KEY = "learnos.behavior.v1";
const BEHAVIOR_AGGREGATES_KEY = "learnos.behavior.aggregates.v1";
const MAX_STORED_EVENTS = 400;

// In-memory fallback for SSR, test environments, or restricted storage
let memoryEvents = [];
let memoryAggregates = {};

function isLocalStorageAvailable() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function safeGetStorage(key) {
  if (!isLocalStorageAvailable()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key, value) {
  if (!isLocalStorageAvailable()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // QuotaExceeded or privacy mode; ignore gracefully
  }
}

/**
 * Return current date formatted as YYYY-MM-DD in local time
 */
export function getLocalDateString(timestamp = Date.now()) {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get all stored raw behavior events
 */
export function getBehaviorEvents() {
  const raw = safeGetStorage(BEHAVIOR_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return memoryEvents;
}

/**
 * Get daily aggregates dictionary { "YYYY-MM-DD": { ... } }
 */
export function getBehaviorAggregates() {
  const raw = safeGetStorage(BEHAVIOR_AGGREGATES_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return memoryAggregates;
}

/**
 * Record a user behavior event with optional payload and metadata.
 * Supported types:
 * - 'page_view'
 * - 'lesson_open'
 * - 'checkpoint_attempt'
 * - 'practice_drill'
 * - 'flashcard_review'
 * - 'flashcard_create'
 * - 'tutor_query'
 * - 'note_save'
 * - 'focus_session'
 * - 'session_heartbeat'
 */
export function recordBehavior(type, payload = {}) {
  const now = Date.now();
  const dateKey = getLocalDateString(now);

  const event = {
    id: `ev-${now}-${Math.random().toString(36).slice(2, 7)}`,
    type: String(type || "action"),
    timestamp: now,
    date: dateKey,
    courseId: payload.courseId || null,
    lessonId: payload.lessonId || null,
    metadata: { ...payload },
  };

  // Update raw events buffer (sliding window)
  const existing = getBehaviorEvents();
  const updatedEvents = [event, ...existing].slice(0, MAX_STORED_EVENTS);
  if (isLocalStorageAvailable()) {
    safeSetStorage(BEHAVIOR_STORAGE_KEY, JSON.stringify(updatedEvents));
  } else {
    memoryEvents = updatedEvents;
  }

  // Update daily aggregated stats
  const aggregates = { ...getBehaviorAggregates() };
  const day = aggregates[dateKey] || {
    date: dateKey,
    activeMinutes: 0,
    pageViews: 0,
    flashcardReviews: 0,
    checkpointAttempts: 0,
    drillsCompleted: 0,
    tutorQueries: 0,
    notesSaved: 0,
    focusMinutes: 0,
    totalEvents: 0,
  };

  day.totalEvents = (day.totalEvents || 0) + 1;

  if (type === "page_view") {
    day.pageViews = (day.pageViews || 0) + 1;
    day.activeMinutes = (day.activeMinutes || 0) + 1;
  } else if (type === "session_heartbeat") {
    day.activeMinutes = (day.activeMinutes || 0) + Number(payload.minutes || 1);
  } else if (type === "checkpoint_attempt") {
    day.checkpointAttempts = (day.checkpointAttempts || 0) + 1;
    day.activeMinutes = (day.activeMinutes || 0) + 3;
  } else if (type === "practice_drill") {
    day.drillsCompleted = (day.drillsCompleted || 0) + 1;
    day.activeMinutes = (day.activeMinutes || 0) + 4;
  } else if (type === "flashcard_review") {
    day.flashcardReviews = (day.flashcardReviews || 0) + 1;
    day.activeMinutes = (day.activeMinutes || 0) + 1;
  } else if (type === "tutor_query") {
    day.tutorQueries = (day.tutorQueries || 0) + 1;
    day.activeMinutes = (day.activeMinutes || 0) + 3;
  } else if (type === "note_save") {
    day.notesSaved = (day.notesSaved || 0) + 1;
    day.activeMinutes = (day.activeMinutes || 0) + 2;
  } else if (type === "focus_session") {
    const mins = Number(payload.minutes || 25);
    day.focusMinutes = (day.focusMinutes || 0) + mins;
    day.activeMinutes = (day.activeMinutes || 0) + mins;
  }

  aggregates[dateKey] = day;
  if (isLocalStorageAvailable()) {
    safeSetStorage(BEHAVIOR_AGGREGATES_KEY, JSON.stringify(aggregates));
  } else {
    memoryAggregates = aggregates;
  }

  return event;
}

/**
 * Clear all behavior logs and aggregates (useful for testing or reset)
 */
export function clearBehaviorData() {
  memoryEvents = [];
  memoryAggregates = {};
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(BEHAVIOR_STORAGE_KEY);
      window.localStorage.removeItem(BEHAVIOR_AGGREGATES_KEY);
    } catch {}
  }
}

/**
 * Calculate consecutive daily active streak from an array of date strings (YYYY-MM-DD).
 */
export function calculateStreak(activeDatesSet) {
  if (!activeDatesSet || activeDatesSet.size === 0) {
    return { streakDays: 0, activeToday: false, status: "inactive" };
  }

  const todayStr = getLocalDateString(Date.now());
  const activeToday = activeDatesSet.has(todayStr);

  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = getLocalDateString(yesterdayDate.getTime());

  // Streak is broken only if neither today nor yesterday had any activity
  if (!activeToday && !activeDatesSet.has(yesterdayStr)) {
    return { streakDays: 0, activeToday: false, status: "broken" };
  }

  let streak = 0;
  const cursor = new Date();
  if (!activeToday) {
    // If not active today yet, check starting from yesterday
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const dStr = getLocalDateString(cursor.getTime());
    if (activeDatesSet.has(dStr)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }

  return {
    streakDays: streak,
    activeToday,
    status: activeToday ? "active" : "pending_today",
  };
}

/**
 * Extract active dates set from workspace data + telemetry aggregates
 */
export function collectActiveDates(workspaceData = {}, behaviorAggregates = {}) {
  const activeDates = new Set();

  // From behavior aggregates (any day with events or minutes)
  Object.keys(behaviorAggregates).forEach(dateStr => {
    const item = behaviorAggregates[dateStr];
    if (item && (item.totalEvents > 0 || item.activeMinutes > 0)) {
      activeDates.add(dateStr);
    }
  });

  // From attempts
  const attempts = workspaceData.attempts || [];
  attempts.forEach(a => {
    if (a.created_at) {
      activeDates.add(getLocalDateString(new Date(a.created_at).getTime()));
    }
  });

  // From completed tasks
  const tasks = workspaceData.tasks || [];
  tasks.forEach(t => {
    if (t.status === "completed" && (t.completed_at || t.scheduled_at)) {
      activeDates.add(getLocalDateString(new Date(t.completed_at || t.scheduled_at).getTime()));
    }
  });

  // From flashcards reviewed recently
  const flashcards = workspaceData.flashcards || [];
  flashcards.forEach(f => {
    if (f.last_reviewed_at) {
      activeDates.add(getLocalDateString(new Date(f.last_reviewed_at).getTime()));
    }
  });

  // From notes created / edited
  const notes = workspaceData.notes || [];
  notes.forEach(n => {
    if (n.updated_at || n.created_at) {
      activeDates.add(getLocalDateString(new Date(n.updated_at || n.created_at).getTime()));
    }
  });

  return activeDates;
}

/**
 * Generate 7-day learning rhythm window (Mon-Sun or past 7 days up to today)
 */
export function generateWeeklyRhythm(behaviorAggregates = {}, workspaceData = {}) {
  const days = [];
  const now = new Date();
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Last 7 days, ending with today
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateString(d.getTime());
    const dayName = dayNames[d.getDay()];
    const label = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const isToday = i === 0;

    const agg = behaviorAggregates[dateStr] || {};
    let eventsCount = agg.totalEvents || 0;
    let minutes = agg.activeMinutes || 0;

    // Supplement with attempts and tasks for this date if telemetry wasn't active
    if (workspaceData.attempts) {
      const matchAttempts = workspaceData.attempts.filter(a =>
        a.created_at && getLocalDateString(new Date(a.created_at).getTime()) === dateStr
      ).length;
      eventsCount += matchAttempts;
      minutes += matchAttempts * 3;
    }
    if (workspaceData.tasks) {
      const matchTasks = workspaceData.tasks.filter(t =>
        t.status === "completed" && (t.completed_at || t.scheduled_at) &&
        getLocalDateString(new Date(t.completed_at || t.scheduled_at).getTime()) === dateStr
      ).length;
      eventsCount += matchTasks;
      minutes += matchTasks * 25;
    }

    days.push({
      dateStr,
      dayName,
      label,
      isToday,
      eventsCount,
      minutes: Math.min(minutes, 360), // clamp for charting
      active: eventsCount > 0 || minutes > 0,
    });
  }

  return days;
}

/**
 * Calculate comprehensive learner metrics combining workspace data, settings,
 * and behavior telemetry.
 */
export function calculateLearnerMetrics(workspaceData = {}, settings = {}) {
  const attempts = workspaceData.attempts || [];
  const tasks = workspaceData.tasks || [];
  const flashcards = workspaceData.flashcards || [];
  const notes = workspaceData.notes || [];
  const courses = workspaceData.courses || [];

  const aggregates = getBehaviorAggregates();
  const events = getBehaviorEvents();

  // 1. Streak
  const activeDates = collectActiveDates(workspaceData, aggregates);
  const streakInfo = calculateStreak(activeDates);

  // 2. Study Time Velocity & Weekly Commitment
  const weeklyGoalMinutes = Math.max(30, Number(settings.weeklyMinutes || 180));
  const rhythm = generateWeeklyRhythm(aggregates, workspaceData);
  const weeklyMinutesSpent = rhythm.reduce((sum, d) => sum + d.minutes, 0);
  const weeklyGoalPct = Math.min(100, Math.round((weeklyMinutesSpent / weeklyGoalMinutes) * 100));

  // 3. Flashcards Retention & Spaced Repetition Mastery
  const flashcardEvents = events.filter(e => e.type === "flashcard_review");
  const ratedGoodOrEasy = flashcardEvents.filter(e => {
    const r = e.metadata?.rating;
    return r === "good" || r === "easy";
  }).length;
  const totalCardReviews = flashcardEvents.length;
  // If we have review events use them, otherwise check flashcards with repetitions
  const masteredCards = flashcards.filter(f => Number(f.repetitions || 0) >= 3 || Number(f.interval_days || 0) >= 7).length;
  const learningCards = flashcards.filter(f => Number(f.repetitions || 0) > 0 && Number(f.repetitions || 0) < 3).length;
  const dueCards = flashcards.filter(f => {
    if (!f.due_at) return true;
    return new Date(f.due_at).getTime() <= Date.now();
  }).length;

  const retentionRate = totalCardReviews > 0
    ? Math.round((ratedGoodOrEasy / totalCardReviews) * 100)
    : flashcards.length > 0 && (masteredCards + learningCards) > 0
      ? Math.round((masteredCards / (masteredCards + learningCards)) * 100)
      : 0;

  // 4. Practice & Checkpoint Mastery
  const passedAttempts = attempts.filter(a => a.score != null && Number(a.score) >= 70);
  const passRate = attempts.length > 0
    ? Math.round((passedAttempts.length / attempts.length) * 100)
    : 0;
  const uniqueMasteredConcepts = [...new Set(passedAttempts.map(a => a.concept).filter(Boolean))];
  const uniquePracticedConcepts = [...new Set(attempts.map(a => a.concept).filter(Boolean))];

  // 5. AI Tutor & Synthesis Depth
  const tutorEvents = events.filter(e => e.type === "tutor_query");
  const tutorModeCounts = {
    explain: tutorEvents.filter(e => (e.metadata?.mode || "").toLowerCase() === "explain").length,
    quiz: tutorEvents.filter(e => (e.metadata?.mode || "").toLowerCase().includes("quiz")).length,
    hint: tutorEvents.filter(e => (e.metadata?.mode || "").toLowerCase().includes("hint")).length,
    review: tutorEvents.filter(e => (e.metadata?.mode || "").toLowerCase().includes("review")).length,
  };

  // 6. Modality Activity Breakdown
  const totalActions = attempts.length + tasks.filter(t => t.status === "completed").length + flashcards.length + notes.length + tutorEvents.length;
  const modalityShares = totalActions > 0 ? {
    roadmap: Math.round((tasks.filter(t => t.status === "completed").length / totalActions) * 100),
    practice: Math.round((attempts.length / totalActions) * 100),
    flashcards: Math.round((flashcards.length / totalActions) * 100),
    tutor: Math.round((tutorEvents.length / totalActions) * 100),
    notes: Math.round((notes.length / totalActions) * 100),
  } : { roadmap: 0, practice: 0, flashcards: 0, tutor: 0, notes: 0 };

  return {
    streak: streakInfo,
    studyTime: {
      weeklyMinutesSpent,
      weeklyGoalMinutes,
      weeklyGoalPct,
      remainingMinutes: Math.max(0, weeklyGoalMinutes - weeklyMinutesSpent),
    },
    rhythm,
    retention: {
      retentionRate,
      totalCardReviews,
      masteredCards,
      learningCards,
      dueCards,
      totalCards: flashcards.length,
    },
    practice: {
      totalAttempts: attempts.length,
      passedAttempts: passedAttempts.length,
      passRate,
      masteredConceptsCount: uniqueMasteredConcepts.length,
      practicedConceptsCount: uniquePracticedConcepts.length,
    },
    tutor: {
      totalInteractions: tutorEvents.length,
      modeCounts: tutorModeCounts,
    },
    synthesis: {
      totalNotes: notes.length,
      totalCourses: courses.length,
      completedTasks: tasks.filter(t => t.status === "completed").length,
      totalTasks: tasks.length,
    },
    modalityShares,
  };
}
