const DB_NAME = "drizzlearn-practice";
const DB_VERSION = 1;
const STORE_NAME = "sets";

const memorySets = new Map();

/**
 * Builds a user-, lesson-, and mode-scoped cache key for Practice Studio sets.
 */
export function buildPracticeSetKey(userId, lessonId, mode) {
  const userPart = userId ? String(userId).trim() : "anon";
  const lessonPart = lessonId ? String(lessonId).trim() : "none";
  const modePart = mode ? String(mode).trim() : "mixed";
  return `${userPart || "anon"}::${lessonPart || "none"}::${modePart || "mixed"}`;
}

function parsePracticeSetKey(key) {
  const raw = String(key || "");
  const parts = raw.split("::");
  if (parts.length < 3) {
    return {
      userId: parts[0] || "anon",
      lessonId: parts[1] || "none",
      mode: parts[2] || "mixed",
    };
  }
  return {
    userId: parts[0] || "anon",
    lessonId: parts[1] || "none",
    mode: parts.slice(2).join("::") || "mixed",
  };
}

function resolveIndexedDB(indexedDBImpl) {
  if (indexedDBImpl !== undefined) {
    return indexedDBImpl && typeof indexedDBImpl.open === "function" ? indexedDBImpl : null;
  }
  if (typeof globalThis !== "undefined" && globalThis.indexedDB && typeof globalThis.indexedDB.open === "function") {
    return globalThis.indexedDB;
  }
  return null;
}

function openPracticeDb(idb) {
  return new Promise((resolve, reject) => {
    try {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db && !db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
      request.onblocked = () => reject(new Error("IndexedDB open blocked."));
    } catch (error) {
      reject(error);
    }
  });
}

async function runIdbTransaction(idb, mode, operation) {
  const db = await openPracticeDb(idb);
  return new Promise((resolve, reject) => {
    let settled = false;
    let opResult;
    const finishOk = (value) => {
      if (settled) return;
      settled = true;
      try {
        db.close?.();
      } catch {}
      resolve(value);
    };
    const finishErr = (err) => {
      if (settled) return;
      settled = true;
      try {
        db.close?.();
      } catch {}
      reject(err);
    };

    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = operation(store);

      request.onsuccess = () => {
        opResult = request.result;
      };
      request.onerror = () => finishErr(request.error || new Error("IndexedDB request failed."));
      tx.oncomplete = () => finishOk(opResult);
      tx.onerror = () => finishErr(tx.error || new Error("IndexedDB transaction failed."));
      tx.onabort = () => finishErr(tx.error || new Error("IndexedDB transaction aborted."));
    } catch (error) {
      finishErr(error);
    }
  });
}

function buildPracticeRecord(key, payload) {
  const parsed = parsePracticeSetKey(key);
  const data = payload && typeof payload === "object" ? payload : {};
  const exercises = Array.isArray(data.exercises) ? data.exercises : [];
  const progress = data.progress && typeof data.progress === "object" ? data.progress : {};

  return {
    key: String(key),
    userId: String(data.userId || parsed.userId || "anon"),
    lessonId: String(data.lessonId || parsed.lessonId || "none"),
    mode: String(data.mode || parsed.mode || "mixed"),
    lessonTitle: typeof data.lessonTitle === "string" ? data.lessonTitle.trim().slice(0, 160) : "",
    exercises,
    progress: {
      activeIndex: Number.isInteger(Number(progress.activeIndex)) ? Math.max(0, Number(progress.activeIndex)) : 0,
      resultsById: progress.resultsById && typeof progress.resultsById === "object" ? progress.resultsById : {},
      statesById: progress.statesById && typeof progress.statesById === "object" ? progress.statesById : {},
      savedAttemptIds:
        progress.savedAttemptIds && typeof progress.savedAttemptIds === "object" ? progress.savedAttemptIds : {},
    },
    source: data.source || null,
    model: data.model || null,
    failoverCount: Number(data.failoverCount || 0),
    updatedAt: Number(data.updatedAt) || Date.now(),
  };
}

function summarizePracticeRecord(record) {
  const exercises = Array.isArray(record?.exercises) ? record.exercises : [];
  const resultsById = record?.progress?.resultsById || {};
  const resultEntries = Object.values(resultsById);
  return {
    key: record.key,
    userId: record.userId,
    lessonId: record.lessonId,
    mode: record.mode,
    lessonTitle: record.lessonTitle || "",
    exerciseCount: exercises.length,
    completedCount: resultEntries.length,
    correctCount: resultEntries.filter((entry) => entry?.correct === true).length,
    source: record.source || null,
    model: record.model || null,
    updatedAt: Number(record.updatedAt) || 0,
  };
}

/**
 * Loads a cached Practice Studio exercise set and progress for the given key.
 */
export async function loadPracticeSet(key, { indexedDBImpl } = {}) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return null;
  const idb = resolveIndexedDB(indexedDBImpl);
  if (idb) {
    try {
      const record = await runIdbTransaction(idb, "readonly", (store) => store.get(cleanKey));
      return record ? buildPracticeRecord(cleanKey, record) : null;
    } catch {
      const fallback = memorySets.get(cleanKey);
      return fallback ? buildPracticeRecord(cleanKey, fallback) : null;
    }
  }
  const fallback = memorySets.get(cleanKey);
  return fallback ? buildPracticeRecord(cleanKey, fallback) : null;
}

/**
 * Persists a generated Practice Studio exercise set and learner progress to IndexedDB (with Map fallback).
 */
export async function savePracticeSet(key, payload, { indexedDBImpl } = {}) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return { saved: false, fallback: true };
  const record = buildPracticeRecord(cleanKey, {
    ...(payload && typeof payload === "object" ? payload : {}),
    updatedAt: Date.now(),
  });
  memorySets.set(cleanKey, record);

  const idb = resolveIndexedDB(indexedDBImpl);
  if (!idb) {
    return { saved: true, fallback: true };
  }

  try {
    await runIdbTransaction(idb, "readwrite", (store) => store.put(record));
    return { saved: true, fallback: false };
  } catch {
    return { saved: true, fallback: true };
  }
}

/**
 * Clears a cached Practice Studio exercise set from IndexedDB and the in-memory fallback.
 */
export async function clearPracticeSet(key, { indexedDBImpl } = {}) {
  const cleanKey = String(key || "").trim();
  if (!cleanKey) return { cleared: false, fallback: true };
  memorySets.delete(cleanKey);

  const idb = resolveIndexedDB(indexedDBImpl);
  if (!idb) {
    return { cleared: true, fallback: true };
  }

  try {
    await runIdbTransaction(idb, "readwrite", (store) => store.delete(cleanKey));
    return { cleared: true, fallback: false };
  } catch {
    return { cleared: true, fallback: true };
  }
}

/**
 * Lists cached Practice Studio mode summaries strictly scoped to (userId, lessonId).
 */
export async function listLessonPracticeModes(userId, lessonId, { indexedDBImpl } = {}) {
  const userPart = userId ? String(userId).trim() : "anon";
  const lessonPart = lessonId ? String(lessonId).trim() : "none";
  if (!lessonId) return [];
  const prefix = `${userPart || "anon"}::${lessonPart}::`;
  const idb = resolveIndexedDB(indexedDBImpl);

  const filterAndSort = (records) =>
    (Array.isArray(records) ? records : [])
      .filter((rec) => rec && typeof rec.key === "string" && rec.key.startsWith(prefix))
      .map(summarizePracticeRecord)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  if (idb) {
    try {
      const records = await runIdbTransaction(idb, "readonly", (store) => store.getAll());
      return filterAndSort(records);
    } catch {
      return filterAndSort([...memorySets.values()]);
    }
  }
  return filterAndSort([...memorySets.values()]);
}
