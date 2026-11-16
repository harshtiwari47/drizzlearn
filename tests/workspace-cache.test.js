import test from "node:test";
import assert from "node:assert/strict";
import {
  getWorkspaceCache,
  getSyncWorkspaceCache,
  setWorkspaceCache,
  invalidateWorkspaceCache,
  clearAllWorkspaceCache,
  dedupeRequest,
} from "../src/workspace-cache.js";

test("workspace-cache stores and retrieves items with in-memory and local storage", async () => {
  const localStorageMock = new Map();
  globalThis.localStorage = {
    getItem: (k) => localStorageMock.get(k) || null,
    setItem: (k, v) => localStorageMock.set(k, String(v)),
    removeItem: (k) => localStorageMock.delete(k),
    get length() { return localStorageMock.size; },
    key: (i) => Array.from(localStorageMock.keys())[i] || null,
  };

  await setWorkspaceCache("test:note", { id: "n1", title: "My Note" });

  // Synchronous lookup
  const sync = getSyncWorkspaceCache("test:note", 10000);
  assert.equal(sync?.id, "n1");
  assert.equal(sync?.title, "My Note");

  // Asynchronous lookup
  const res = await getWorkspaceCache("test:note", 10000);
  assert.equal(res.hit, true);
  assert.equal(res.stale, false);
  assert.equal(res.data.id, "n1");
});

test("workspace-cache detects stale items beyond maxAgeMs", async () => {
  await setWorkspaceCache("test:stale", { val: 42 });

  // Query with 0ms TTL so it immediately reports stale
  const res = await getWorkspaceCache("test:stale", -1);
  assert.equal(res.hit, true);
  assert.equal(res.stale, true);
  assert.equal(res.data.val, 42);
});

test("workspace-cache invalidates by key and prefix", async () => {
  await setWorkspaceCache("course:c1", { id: "c1", modules: [] });
  await setWorkspaceCache("course:c2", { id: "c2", modules: [] });
  await setWorkspaceCache("notes", [{ id: "n1" }]);

  await invalidateWorkspaceCache("course:c1");
  const c1 = await getWorkspaceCache("course:c1");
  assert.equal(c1.hit, false);

  const c2 = await getWorkspaceCache("course:c2");
  assert.equal(c2.hit, true);

  await invalidateWorkspaceCache("course:");
  const c2After = await getWorkspaceCache("course:c2");
  assert.equal(c2After.hit, false);

  const notes = await getWorkspaceCache("notes");
  assert.equal(notes.hit, true);
});

test("workspace-cache clearAll removes all items", async () => {
  await setWorkspaceCache("key1", "val1");
  await setWorkspaceCache("key2", "val2");

  await clearAllWorkspaceCache();
  const k1 = await getWorkspaceCache("key1");
  const k2 = await getWorkspaceCache("key2");
  assert.equal(k1.hit, false);
  assert.equal(k2.hit, false);
});

test("dedupeRequest shares in-flight promises and executes fetcher once", async () => {
  let callCount = 0;
  const slowFetcher = async () => {
    callCount++;
    await new Promise((r) => setTimeout(r, 50));
    return { data: "success", count: callCount };
  };

  const [res1, res2, res3] = await Promise.all([
    dedupeRequest("concurrent:key", slowFetcher),
    dedupeRequest("concurrent:key", slowFetcher),
    dedupeRequest("concurrent:key", slowFetcher),
  ]);

  assert.equal(callCount, 1, "Fetcher should have been called exactly once for 3 concurrent requests");
  assert.deepEqual(res1, res2);
  assert.deepEqual(res2, res3);

  // Subsequent call after settled executes new fetch
  const res4 = await dedupeRequest("concurrent:key", slowFetcher);
  assert.equal(callCount, 2);
  assert.equal(res4.count, 2);
});
