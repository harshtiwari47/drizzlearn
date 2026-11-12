const DB_NAME = "drizzlearn-tutor";
const DB_VERSION = 1;
const STORE_NAME = "threads";
const MAX_MESSAGES_PER_THREAD = 100;

const memoryThreads = new Map();

/**
 * Builds a user- and lesson-scoped thread key for persisted tutor conversations.
 */
export function buildTutorThreadId(userId, lessonId) {
  const userPart = userId ? String(userId).trim() : "anon";
  const lessonPart = lessonId ? String(lessonId).trim() : "workspace";
  return `${userPart || "anon"}::${lessonPart || "workspace"}`;
}

function parseThreadId(threadId) {
  const raw = String(threadId || "");
  const sepIndex = raw.indexOf("::");
  if (sepIndex < 0) {
    return { userId: "anon", lessonId: raw && raw !== "workspace" ? raw : null };
  }
  const userId = raw.slice(0, sepIndex) || "anon";
  const lessonRaw = raw.slice(sepIndex + 2);
  return {
    userId,
    lessonId: lessonRaw && lessonRaw !== "workspace" ? lessonRaw : null,
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

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((msg) => msg && typeof msg === "object")
    .slice(-MAX_MESSAGES_PER_THREAD)
    .map((msg) => {
      const clean = {
        id: msg.id ? String(msg.id) : undefined,
        role: msg.role === "user" ? "user" : "assistant",
        text: typeof msg.text === "string" ? msg.text : "",
        mode: typeof msg.mode === "string" ? msg.mode : undefined,
        structured: msg.structured && typeof msg.structured === "object" ? msg.structured : null,
        interaction: msg.interaction && typeof msg.interaction === "object" ? msg.interaction : null,
        sources: Array.isArray(msg.sources) ? msg.sources : [],
        source: msg.source || null,
        model: msg.model || null,
        failoverCount: Number(msg.failoverCount || 0),
        isError: Boolean(msg.isError),
        retryPayload: msg.retryPayload && typeof msg.retryPayload === "object" ? msg.retryPayload : undefined,
        createdAt: Number(msg.createdAt) || Date.now(),
      };
      return clean;
    });
}

function buildThreadRecord(threadId, messages, { lessonTitle = "" } = {}) {
  const { userId, lessonId } = parseThreadId(threadId);
  const cleanMessages = sanitizeMessages(messages);
  return {
    threadId: String(threadId),
    userId,
    lessonId,
    lessonTitle: typeof lessonTitle === "string" ? lessonTitle.trim().slice(0, 160) : "",
    messages: cleanMessages,
    updatedAt: Date.now(),
  };
}

function summarizeThreadRecord(record) {
  const msgs = Array.isArray(record?.messages) ? record.messages : [];
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
  return {
    threadId: record.threadId,
    userId: record.userId,
    lessonId: record.lessonId || null,
    lessonTitle: record.lessonTitle || (record.lessonId ? "Lesson thread" : "General workspace"),
    messageCount: msgs.length,
    updatedAt: Number(record.updatedAt) || 0,
    preview: lastMsg?.text ? String(lastMsg.text).replace(/\s+/g, " ").trim().slice(0, 90) : "",
  };
}

function openTutorDb(idb) {
  return new Promise((resolve, reject) => {
    try {
      const request = idb.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (db && !db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "threadId" });
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
  const db = await openTutorDb(idb);
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

/**
 * Loads persisted messages for a tutor thread, falling back to in-memory storage if IndexedDB is unavailable or errors.
 */
export async function loadTutorThread(threadId, { indexedDBImpl } = {}) {
  const key = String(threadId || "");
  if (!key) return [];
  const idb = resolveIndexedDB(indexedDBImpl);
  if (idb) {
    try {
      const record = await runIdbTransaction(idb, "readonly", (store) => store.get(key));
      return Array.isArray(record?.messages) ? record.messages : [];
    } catch {
      const fallback = memoryThreads.get(key);
      return Array.isArray(fallback?.messages) ? fallback.messages : [];
    }
  }
  const fallback = memoryThreads.get(key);
  return Array.isArray(fallback?.messages) ? fallback.messages : [];
}

/**
 * Saves messages and per-message interactive state for a tutor thread.
 */
export async function saveTutorThread(threadId, messages, { indexedDBImpl, lessonTitle = "" } = {}) {
  const key = String(threadId || "");
  if (!key) return { saved: false, fallback: true };
  const record = buildThreadRecord(key, messages, { lessonTitle });
  memoryThreads.set(key, record);

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
 * Clears a persisted tutor thread from IndexedDB and the in-memory fallback.
 */
export async function clearTutorThread(threadId, { indexedDBImpl } = {}) {
  const key = String(threadId || "");
  if (!key) return { cleared: false, fallback: true };
  memoryThreads.delete(key);

  const idb = resolveIndexedDB(indexedDBImpl);
  if (!idb) {
    return { cleared: true, fallback: true };
  }

  try {
    await runIdbTransaction(idb, "readwrite", (store) => store.delete(key));
    return { cleared: true, fallback: false };
  } catch {
    return { cleared: true, fallback: true };
  }
}

/**
 * Lists saved tutor thread summaries strictly scoped to the given userId.
 */
export async function listTutorThreads(userId, { indexedDBImpl } = {}) {
  const resolvedUserId = userId ? String(userId).trim() : "anon";
  const prefix = `${resolvedUserId}::`;
  const idb = resolveIndexedDB(indexedDBImpl);

  const filterAndSort = (records) =>
    (Array.isArray(records) ? records : [])
      .filter((rec) => rec && typeof rec.threadId === "string" && rec.threadId.startsWith(prefix))
      .map(summarizeThreadRecord)
      .sort((a, b) => b.updatedAt - a.updatedAt);

  if (idb) {
    try {
      const records = await runIdbTransaction(idb, "readonly", (store) => store.getAll());
      return filterAndSort(records);
    } catch {
      return filterAndSort([...memoryThreads.values()]);
    }
  }
  return filterAndSort([...memoryThreads.values()]);
}
