/**
 * Drizzlearn Client-Side Workspace Cache & Request Deduplicator
 * Provides multi-tier caching (In-Memory -> IndexedDB -> LocalStorage) with
 * Stale-While-Revalidate semantics and in-flight request deduplication.
 */

const DB_NAME = "drizzlearn-workspace-cache";
const DB_VERSION = 1;
const STORE_NAME = "cache_entries";

const memoryCache = new Map();
const inFlightRequests = new Map();

function resolveIndexedDB(indexedDBImpl) {
  if (indexedDBImpl !== undefined) {
    return indexedDBImpl && typeof indexedDBImpl.open === "function" ? indexedDBImpl : null;
  }
  if (typeof globalThis !== "undefined" && globalThis.indexedDB && typeof globalThis.indexedDB.open === "function") {
    return globalThis.indexedDB;
  }
  return null;
}

function openCacheDb(idb) {
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
  const db = await openCacheDb(idb);
  return new Promise((resolve, reject) => {
    let settled = false;
    let opResult;
    const finishOk = (value) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch (_) {}
      resolve(value);
    };
    const finishErr = (error) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch (_) {}
      reject(error);
    };

    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);

      tx.oncomplete = () => finishOk(opResult);
      tx.onerror = () => finishErr(tx.error || new Error("IndexedDB transaction failed."));
      tx.onabort = () => finishErr(tx.error || new Error("IndexedDB transaction aborted."));

      const maybePromise = operation(store);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise
          .then((res) => { opResult = res; })
          .catch((err) => finishErr(err));
      } else {
        opResult = maybePromise;
      }
    } catch (error) {
      finishErr(error);
    }
  });
}

function readLocalStorageFallback(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`learnos.cache.${key}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeLocalStorageFallback(key, entry) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(`learnos.cache.${key}`, JSON.stringify(entry));
  } catch {}
}

function removeLocalStorageFallback(key) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(`learnos.cache.${key}`);
  } catch {}
}

/**
 * Retrieves a cached entry by key.
 * Returns { hit: boolean, data: any, stale: boolean, timestamp: number }
 */
export async function getWorkspaceCache(key, maxAgeMs = 120000, options = {}) {
  const now = Date.now();
  const idb = resolveIndexedDB(options.indexedDB);

  // 1. Check synchronous in-memory cache
  if (memoryCache.has(key)) {
    const entry = memoryCache.get(key);
    const age = now - (entry.savedAt || 0);
    const isStale = age > maxAgeMs;
    return { hit: true, data: entry.data, stale: isStale, timestamp: entry.savedAt || now };
  }

  // 2. Try IndexedDB
  if (idb) {
    try {
      const entry = await runIdbTransaction(idb, "readonly", (store) => {
        return new Promise((resolve, reject) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
        });
      });

      if (entry && entry.data !== undefined) {
        memoryCache.set(key, entry);
        const age = now - (entry.savedAt || 0);
        const isStale = age > maxAgeMs;
        return { hit: true, data: entry.data, stale: isStale, timestamp: entry.savedAt || now };
      }
    } catch (_) {}
  }

  // 3. Try LocalStorage fallback
  const localEntry = readLocalStorageFallback(key);
  if (localEntry && localEntry.data !== undefined) {
    memoryCache.set(key, localEntry);
    const age = now - (localEntry.savedAt || 0);
    const isStale = age > maxAgeMs;
    return { hit: true, data: localEntry.data, stale: isStale, timestamp: localEntry.savedAt || now };
  }

  return { hit: false, data: null, stale: false, timestamp: 0 };
}

/**
 * Synchronous in-memory lookup. Returns cached data if available and fresh.
 */
export function getSyncWorkspaceCache(key, maxAgeMs = 120000) {
  if (!memoryCache.has(key)) {
    const fallback = readLocalStorageFallback(key);
    if (fallback && fallback.data !== undefined) {
      memoryCache.set(key, fallback);
    }
  }
  if (!memoryCache.has(key)) return null;
  const entry = memoryCache.get(key);
  const age = Date.now() - (entry.savedAt || 0);
  if (age > maxAgeMs) return null;
  return entry.data;
}

/**
 * Stores data into memory and persists to IndexedDB / localStorage.
 */
export async function setWorkspaceCache(key, data, options = {}) {
  const entry = {
    key,
    data,
    savedAt: Date.now(),
  };

  memoryCache.set(key, entry);
  writeLocalStorageFallback(key, entry);

  const idb = resolveIndexedDB(options.indexedDB);
  if (idb) {
    try {
      await runIdbTransaction(idb, "readwrite", (store) => {
        return new Promise((resolve, reject) => {
          const req = store.put(entry);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      });
    } catch (_) {}
  }
}

/**
 * Invalidates a specific cache key or prefix.
 */
export async function invalidateWorkspaceCache(keyOrPrefix, options = {}) {
  for (const k of Array.from(memoryCache.keys())) {
    if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) {
      memoryCache.delete(k);
      removeLocalStorageFallback(k);
    }
  }

  const idb = resolveIndexedDB(options.indexedDB);
  if (idb) {
    try {
      await runIdbTransaction(idb, "readwrite", (store) => {
        return new Promise((resolve, reject) => {
          const req = store.openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              const k = String(cursor.key || "");
              if (k === keyOrPrefix || k.startsWith(keyOrPrefix)) {
                cursor.delete();
              }
              cursor.continue();
            } else {
              resolve();
            }
          };
          req.onerror = () => reject(req.error);
        });
      });
    } catch (_) {}
  }
}

/**
 * Clears all workspace cache entries (e.g. on logout).
 */
export async function clearAllWorkspaceCache(options = {}) {
  memoryCache.clear();
  try {
    if (typeof localStorage !== "undefined") {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("learnos.cache.")) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    }
  } catch (_) {}

  const idb = resolveIndexedDB(options.indexedDB);
  if (idb) {
    try {
      await runIdbTransaction(idb, "readwrite", (store) => {
        return new Promise((resolve, reject) => {
          const req = store.clear();
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
        });
      });
    } catch (_) {}
  }
}

/**
 * Deduplicates in-flight asynchronous requests so identical calls share a single Promise.
 */
export function dedupeRequest(key, fetcherFn) {
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }
  const promise = (async () => {
    try {
      return await fetcherFn();
    } finally {
      inFlightRequests.delete(key);
    }
  })();
  inFlightRequests.set(key, promise);
  return promise;
}
