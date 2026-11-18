const PAGE_TITLES = {
  home: "Drizzlearn — AI Learning Workspace",
  courses: "My Courses — Drizzlearn",
  course: "Course Roadmap — Drizzlearn",
  proposal: "Course Proposal — Drizzlearn",
  lesson: "Lesson Workspace — Drizzlearn",
  today: "Today’s Plan — Drizzlearn",
  "study-together": "Study Together — Drizzlearn",
  notes: "Notes — Drizzlearn",
  flashcards: "Flashcards — Drizzlearn",
  practice: "Practice Studio — Drizzlearn",
  progress: "Your Progress — Drizzlearn",
  tutor: "AI Tutor — Drizzlearn",
  settings: "Settings — Drizzlearn",
  profile: "Profile & Settings — Drizzlearn",
  "create-course": "Create Course — Drizzlearn",
  "create/course": "Create Course — Drizzlearn",
  goal: "Create Course — Drizzlearn",
  search: "Search Results — Drizzlearn",
  login: "Sign In — Drizzlearn",
  signup: "Create Account — Drizzlearn",
  auth: "Account — Drizzlearn",
  verify: "Verify Email — Drizzlearn",
  "reset-password": "Reset Password — Drizzlearn",
  verified: "Email Verified — Drizzlearn",
};

const PAGE_DESCRIPTIONS = {
  home: "Turn any learning goal into structured course roadmaps, interactive practice studios, spaced-repetition flashcards, Markdown notes, and grounded AI tutoring.",
  courses: "Browse and manage your personalized AI courses and structured learning roadmaps on Drizzlearn.",
  course: "Follow your step-by-step course curriculum, lesson checkpoints, and modular milestones on Drizzlearn.",
  proposal: "Review and approve your AI-crafted course proposal, syllabus structure, and weekly study budget.",
  lesson: "Deep-dive into concepts, worked examples, and comprehension checkpoints on Drizzlearn.",
  today: "Stay on track with your scheduled daily lessons, spaced reviews, and rebalanced study blocks.",
  "study-together": "Join real-time focus study rooms with synchronized Pomodoro timers and learning partners.",
  notes: "Create, format, and organize rich Markdown study notes linked to your lessons and AI citations.",
  flashcards: "Master concepts faster with cognitive-science spaced repetition, LaTeX math, and AI card generation.",
  practice: "Reinforce understanding with interactive fill-in-the-blanks, quizzes, sequence ordering, and word builders.",
  progress: "Track your completed sessions, checkpoint evidence, and retention mastery across all courses.",
  tutor: "Engage with your personalized AI tutor for explanations, hints, quizzes, and code reviews.",
  settings: "Customize your learner profile, weekly study budget, and notification preferences.",
  profile: "Customize your learner profile, weekly study budget, and notification preferences.",
  "create-course": "Define your subject and capability to generate a structured AI course roadmap on Drizzlearn.",
  "create/course": "Define your subject and capability to generate a structured AI course roadmap on Drizzlearn.",
  goal: "Define your subject and capability to generate a structured AI course roadmap on Drizzlearn.",
  login: "Sign in to your Drizzlearn account to sync your courses, notes, and study progress.",
  signup: "Create your free Drizzlearn account and start learning with your personalized AI study companion.",
};

export function getPageTitle(page) {
  return PAGE_TITLES[page] || "Drizzlearn — AI Learning Workspace";
}

export function getPageDescription(page) {
  return PAGE_DESCRIPTIONS[page] || PAGE_DESCRIPTIONS.home;
}

export function updateDocumentMeta(page, { url = "", win = typeof window !== "undefined" ? window : null } = {}) {
  if (!win?.document) return;
  const doc = win.document;
  const title = getPageTitle(page);
  const desc = getPageDescription(page);
  doc.title = title;

  if (typeof doc.querySelector === "function") {
    const descMeta = doc.querySelector('meta[name="description"]');
    if (descMeta?.setAttribute) descMeta.setAttribute("content", desc);

    const ogTitle = doc.querySelector('meta[property="og:title"]');
    if (ogTitle?.setAttribute) ogTitle.setAttribute("content", title);

    const ogDesc = doc.querySelector('meta[property="og:description"]');
    if (ogDesc?.setAttribute) ogDesc.setAttribute("content", desc);

    const twTitle = doc.querySelector('meta[name="twitter:title"]');
    if (twTitle?.setAttribute) twTitle.setAttribute("content", title);

    const twDesc = doc.querySelector('meta[name="twitter:description"]');
    if (twDesc?.setAttribute) twDesc.setAttribute("content", desc);

    if (url) {
      const canonical = doc.querySelector('link[rel="canonical"]');
      if (canonical?.setAttribute) canonical.setAttribute("href", url);

      const ogUrl = doc.querySelector('meta[property="og:url"]');
      if (ogUrl?.setAttribute) ogUrl.setAttribute("content", url);
    }
  }
}

function splitPathAndSearch(rawPath) {
  const str = String(rawPath || "");
  const qIndex = str.indexOf("?");
  if (qIndex === -1) {
    return { pathPart: str, searchPart: "" };
  }
  return {
    pathPart: str.slice(0, qIndex),
    searchPart: str.slice(qIndex + 1),
  };
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parse browser location (History pathname/search + legacy #/hash compatibility)
 * into a canonical route descriptor `{ page, params, query, pathname, isLegacyHash }`.
 */
export function parseLocation(loc = typeof window !== "undefined" ? window.location : null) {
  const rawPathname = typeof loc?.pathname === "string" ? loc.pathname : "";
  const rawSearch = typeof loc?.search === "string" ? loc.search : "";
  const rawHash = typeof loc?.hash === "string" ? loc.hash : "";

  let pathToParse = rawPathname;
  let searchToParse = rawSearch.startsWith("?") ? rawSearch.slice(1) : rawSearch;
  let isLegacyHash = false;

  const trimmedPath = rawPathname.replace(/\/+$/, "") || "/";
  if ((trimmedPath === "/" || trimmedPath === "") && rawHash && rawHash !== "#") {
    const hashBody = rawHash.replace(/^#\/?/, "");
    const { pathPart, searchPart } = splitPathAndSearch(hashBody);
    pathToParse = `/${pathPart.replace(/^\/+/, "")}`;
    if (searchPart) {
      searchToParse = searchToParse ? `${searchToParse}&${searchPart}` : searchPart;
    }
    isLegacyHash = true;
  }

  const normalizedPath = `/${String(pathToParse || "").replace(/^\/+/, "").replace(/\/+$/, "")}`;
  const segments = normalizedPath === "/" ? [] : normalizedPath.slice(1).split("/").map(safeDecode);
  const query = new URLSearchParams(searchToParse);

  let page = "home";
  const params = {};

  if (segments.length === 0) {
    page = "home";
  } else if (segments[0] === "create" && (segments[1] === "course" || segments.length === 1)) {
    page = "create-course";
  } else if (segments[0] === "goal") {
    page = "create-course";
  } else if (segments[0] === "courses" && segments.length >= 2) {
    params.courseId = segments[1];
    page = segments[2] === "proposal" ? "proposal" : "course";
  } else if ((segments[0] === "lessons" || segments[0] === "lesson") && segments.length >= 2) {
    page = "lesson";
    params.lessonId = segments[1];
  } else if (segments[0] === "study-together" && segments.length >= 2) {
    page = "study-together";
    params.roomCode = segments[1].toUpperCase();
  } else if (segments[0] === "practice" && segments.length >= 2) {
    page = "practice";
    params.lessonId = segments[1];
  } else if (segments.length === 1) {
    page = segments[0];
  } else {
    page = segments.join("/");
  }

  if (page === "study-together" && !params.roomCode && query.get("room")) {
    params.roomCode = String(query.get("room")).trim().toUpperCase();
  }

  return {
    page,
    params,
    query,
    pathname: normalizedPath,
    isLegacyHash,
  };
}

/**
 * Build a canonical History API path (plus optional search params) for a route name or path.
 */
export function buildPath(target, { params = {}, query = {} } = {}) {
  const raw = String(target || "home").trim();
  let pathname = "/";

  if (raw.startsWith("/")) {
    pathname = raw || "/";
  } else {
    const cleanName = raw.replace(/^#?\/?/, "");
    const { pathPart, searchPart } = splitPathAndSearch(cleanName);
    const mergedQuery = new URLSearchParams(searchPart);
    if (query instanceof URLSearchParams) {
      for (const [k, v] of query.entries()) {
        if (v !== undefined && v !== null && v !== "") mergedQuery.set(k, String(v));
      }
    } else if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== "") mergedQuery.set(k, String(v));
      }
    }

    if (pathPart === "home" || pathPart === "") {
      pathname = "/";
    } else if (pathPart === "course" && params?.courseId) {
      pathname = `/courses/${encodeURIComponent(params.courseId)}`;
    } else if (pathPart === "proposal" && params?.courseId) {
      pathname = `/courses/${encodeURIComponent(params.courseId)}/proposal`;
    } else if (pathPart === "lesson" && params?.lessonId) {
      pathname = `/lessons/${encodeURIComponent(params.lessonId)}`;
    } else if (pathPart === "study-together" && params?.roomCode) {
      pathname = "/study-together";
      mergedQuery.set("room", String(params.roomCode).trim().toUpperCase());
    } else if (pathPart === "practice" && params?.lessonId) {
      pathname = `/practice/${encodeURIComponent(params.lessonId)}`;
    } else if (pathPart === "create-course" || pathPart === "create/course" || pathPart === "goal") {
      pathname = "/create/course";
    } else {
      pathname = `/${pathPart.replace(/^\/+/, "")}`;
    }

    const qs = mergedQuery.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const queryParams =
    query instanceof URLSearchParams
      ? query
      : new URLSearchParams(
          Object.entries(query || {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
        );
  const qs = queryParams.toString();
  if (!qs) return pathname;
  return pathname.includes("?") ? `${pathname}&${qs}` : `${pathname}?${qs}`;
}

/**
 * Determine whether an anchor click should be handled client-side via History API.
 */
export function shouldInterceptNavClick(event) {
  if (!event || event.defaultPrevented) return false;
  if (typeof event.button === "number" && event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  return true;
}

/**
 * Update browser history cleanly using History API when available (and hash fallback for minimal environments).
 */
export function navigateTo(
  target,
  { params = {}, query = {}, replace = false, scrollTop = true, win = typeof window !== "undefined" ? window : null } = {}
) {
  const nextUrl = buildPath(target, { params, query });
  if (win) {
    const parsed = parseLocation({ pathname: nextUrl.split("?")[0], search: nextUrl.includes("?") ? `?${nextUrl.split("?")[1]}` : "", hash: "" });
    if (typeof win.history?.pushState === "function") {
      const currentFull = `${win.location?.pathname || "/"}${win.location?.search || ""}`;
      if (currentFull !== nextUrl || win.location?.hash) {
        const method = replace && typeof win.history?.replaceState === "function" ? "replaceState" : "pushState";
        win.history[method]({ page: parsed.page, params: parsed.params }, "", nextUrl);
      }
    } else if (win.location) {
      win.location.hash = nextUrl === "/" ? "" : nextUrl;
    }
    if (win.document) {
      updateDocumentMeta(parsed.page, { url: nextUrl, win });
    }
    if (scrollTop && typeof win.scrollTo === "function") {
      win.scrollTo({ top: 0, behavior: "instant" });
    }
  }
  return nextUrl;
}

const NAV_SECTION_MAP = {
  home: "home",
  courses: "courses",
  course: "courses",
  proposal: "courses",
  lesson: "courses",
  "create-course": "courses",
  "create/course": "courses",
  goal: "courses",
  today: "today",
  "study-together": "study-together",
  notes: "notes",
  flashcards: "flashcards",
  practice: "practice",
  progress: "progress",
  tutor: "tutor",
};

/**
 * Resolve which top-level sidebar section owns a given route page.
 */
export function getActiveNav(page) {
  return NAV_SECTION_MAP[page] || null;
}

/**
 * Build contextual back-button and breadcrumb metadata for sub-pages and deep-linked views.
 */
export function getRouteContext({
  page,
  routeParams = {},
  routeQuery = null,
  activeCourse = null,
  activeLesson = null,
  proposalCourse = null,
  pageTitle = "",
  knownTitles = PAGE_TITLES,
} = {}) {
  const courseId = routeParams?.courseId || activeCourse?.id || null;
  const courseTitle = activeCourse?.title || "Course roadmap";
  const lessonTitle = activeLesson?.title || "Lesson workspace";
  const roomCode = String(
    routeParams?.roomCode || (typeof routeQuery?.get === "function" ? routeQuery.get("room") : "") || ""
  )
    .trim()
    .toUpperCase();

  if (page === "course") {
    return {
      back: { label: "Back to My Courses", page: "courses" },
      breadcrumbs: [
        { label: "Home", page: "home" },
        { label: "My Courses", page: "courses" },
        { label: courseTitle, current: true },
      ],
    };
  }

  if (page === "lesson") {
    const hasCourse = Boolean(courseId);
    return {
      back: hasCourse
        ? { label: "Back to Course roadmap", page: "course", params: { courseId } }
        : { label: "Back to My Courses", page: "courses" },
      breadcrumbs: [
        { label: "Home", page: "home" },
        { label: "My Courses", page: "courses" },
        hasCourse
          ? { label: courseTitle, page: "course", params: { courseId } }
          : { label: "Course roadmap", page: "course" },
        { label: lessonTitle, current: true },
      ],
    };
  }

  if (page === "proposal") {
    const draftTitle = proposalCourse?.title || activeCourse?.title || "Course proposal";
    return {
      back: { label: "Back to My Courses", page: "courses" },
      breadcrumbs: [
        { label: "Home", page: "home" },
        { label: "My Courses", page: "courses" },
        { label: "Create a course", page: "create-course" },
        { label: draftTitle, current: true },
      ],
    };
  }

  if (page === "goal" || page === "create-course" || page === "create/course") {
    return {
      back: { label: "Back to My Courses", page: "courses" },
      breadcrumbs: [
        { label: "Home", page: "home" },
        { label: "My Courses", page: "courses" },
        { label: "Create a course", current: true },
      ],
    };
  }

  if (page === "practice" && routeParams?.lessonId) {
    return {
      back: courseId
        ? { label: "Back to Course roadmap", page: "course", params: { courseId } }
        : { label: "Back to Practice", page: "practice" },
      breadcrumbs: [
        { label: "Home", page: "home" },
        { label: "Practice", page: "practice" },
        { label: activeLesson?.title || "Lesson drill", current: true },
      ],
    };
  }

  if (page === "study-together" && roomCode) {
    return {
      back: { label: "Back to Study Together", page: "study-together" },
      breadcrumbs: [
        { label: "Home", page: "home" },
        { label: "Study Together", page: "study-together" },
        { label: `Room ${roomCode}`, current: true },
      ],
    };
  }

  if (["settings", "profile", "search", "verify", "reset-password", "verified"].includes(page) || !knownTitles?.[page]) {
    return {
      back: { label: "Back to Home", page: "home" },
      breadcrumbs: [
        { label: "Home", page: "home" },
        { label: pageTitle || "Workspace", current: true },
      ],
    };
  }

  return null;
}
