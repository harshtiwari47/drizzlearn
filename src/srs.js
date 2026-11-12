/**
 * Evidence-based Spaced Repetition Scheduler (SM-2+ / FSRS-inspired DSR hybrid).
 * Shared by both backend review endpoints and frontend review UI previews.
 */

const VALID_RATINGS = new Set(["Again", "Hard", "Good", "Easy"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toValidDate(now) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/**
 * Compute the next review schedule for a flashcard given a learner recall rating.
 * - New / Learning cards step cleanly through intra-day (10m, 12h) and graduating (1d, 3d, 4d) steps.
 * - Review cards scale intervals using calibrated ease while avoiding severe "ease hell".
 * - Lapses ("Again" on graduated review cards) increment `lapses`, transition to `relearning`,
 *   and surface leech status when `lapses >= 6`.
 */
export function scheduleFlashcardReview(card = {}, rating = "Good", now = new Date()) {
  if (!VALID_RATINGS.has(rating)) {
    throw new Error(`Invalid flashcard rating: ${rating}`);
  }

  const baseNow = toValidDate(now);
  const prevInterval = Math.max(0, Number(card?.interval_days) || 0);
  const prevEase = clamp(Number(card?.ease) || 2.5, 1.3, 3.0);
  const prevReps = Math.max(0, Number(card?.repetitions) || 0);
  const prevLapses = Math.max(0, Number(card?.lapses) || 0);
  const inferredState = prevInterval >= 2 ? "review" : prevInterval === 1 ? "learning" : "new";
  const prevState =
    typeof card?.state === "string" && ["new", "learning", "review", "relearning"].includes(card.state)
      ? card.state
      : inferredState;

  let days = 0;
  let dueMs = baseNow.getTime();
  let nextEase = prevEase;
  let nextState = prevState;
  let nextLapses = prevLapses;

  if (rating === "Again") {
    days = 0;
    dueMs = baseNow.getTime() + 10 * 60 * 1000;
    nextEase = clamp(Number((prevEase - 0.2).toFixed(2)), 1.3, 3.0);
    if (prevState === "review" || prevInterval >= 2) {
      nextLapses = prevLapses + 1;
      nextState = "relearning";
    } else {
      nextState = "learning";
    }
  } else if (prevInterval === 0) {
    // Initial learning or relearning phase
    if (rating === "Hard") {
      days = 0;
      dueMs = baseNow.getTime() + 12 * 60 * 60 * 1000;
      nextState = prevState === "relearning" ? "relearning" : "learning";
    } else if (rating === "Good") {
      days = 1;
      dueMs = baseNow.getTime() + 86400000;
      nextState = "learning";
    } else {
      // Easy immediate graduation
      days = 4;
      dueMs = baseNow.getTime() + 4 * 86400000;
      nextEase = clamp(Number((prevEase + 0.15).toFixed(2)), 1.3, 3.0);
      nextState = "review";
    }
  } else if (prevInterval === 1) {
    // Second graduating step
    if (rating === "Hard") {
      days = 1;
      nextEase = clamp(Number((prevEase - 0.08).toFixed(2)), 1.3, 3.0);
      nextState = "learning";
    } else if (rating === "Good") {
      days = 3;
      nextState = "review";
    } else {
      days = 5;
      nextEase = clamp(Number((prevEase + 0.15).toFixed(2)), 1.3, 3.0);
      nextState = "review";
    }
    dueMs = baseNow.getTime() + days * 86400000;
  } else {
    // Graduated review phase (prevInterval >= 2)
    const hardDays = Math.max(1, Math.round(prevInterval * 1.2));
    const goodMultiplier = prevReps === 0 && prevInterval === 2 ? 2.0 : clamp(prevEase * 0.85, 1.5, 2.6);
    const rawGoodDays = Math.max(hardDays + (prevInterval >= 3 ? 1 : 0), Math.round(prevInterval * goodMultiplier));
    const goodDays = prevReps === 0 && prevInterval === 2 ? 4 : rawGoodDays;
    const easyDays = Math.max(goodDays + 1, Math.round(prevInterval * Math.max(2.3, prevEase)));

    if (rating === "Hard") {
      days = hardDays;
      nextEase = clamp(Number((prevEase - 0.08).toFixed(2)), 1.3, 3.0);
    } else if (rating === "Good") {
      days = goodDays;
    } else {
      days = easyDays;
      nextEase = clamp(Number((prevEase + 0.15).toFixed(2)), 1.3, 3.0);
    }
    nextState = "review";
    dueMs = baseNow.getTime() + days * 86400000;
  }

  const easeDelta = Number((nextEase - prevEase).toFixed(2));
  const nextReps = prevReps + 1;

  return {
    due_at: new Date(dueMs).toISOString(),
    interval_days: days,
    ease: nextEase,
    easeDelta,
    repetitions: nextReps,
    lapses: nextLapses,
    state: nextState,
    is_leech: nextLapses >= 6,
  };
}

/**
 * Format an upcoming review delay cleanly for rating buttons (e.g. "10m", "12h", "4d", "2mo").
 */
export function formatReviewIntervalLabel(intervalDays, dueAt, now = new Date()) {
  const days = Number(intervalDays);
  if (Number.isFinite(days) && days >= 1) {
    if (days >= 365) {
      const years = Math.round((days / 365) * 10) / 10;
      return `${years}y`;
    }
    if (days >= 30) {
      const months = Math.round((days / 30) * 10) / 10;
      return `${months}mo`;
    }
    return `${days}d`;
  }
  const baseMs = toValidDate(now).getTime();
  const dueMs = new Date(dueAt || baseMs).getTime();
  const diffMin = Math.max(1, Math.round((dueMs - baseMs) / 60000));
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.max(1, Math.round(diffMin / 60));
  return `${diffHours}h`;
}

/**
 * Preview next review labels for all four recall buttons on a card.
 */
export function previewFlashcardIntervals(card = {}, now = new Date()) {
  const result = {};
  for (const rating of ["Again", "Hard", "Good", "Easy"]) {
    const next = scheduleFlashcardReview(card, rating, now);
    result[rating] = formatReviewIntervalLabel(next.interval_days, next.due_at, now);
  }
  return result;
}
