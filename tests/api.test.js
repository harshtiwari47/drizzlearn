import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/[...path].js";

async function callApi({ path, method = "GET", body, headers = {} }) {
  const responseHeaders = new Map();
  const response = {
    statusCode: 200,
    setHeader(name, value) { responseHeaders.set(name.toLowerCase(), value); },
    end(value = "") { this.body = value; },
  };
  const request = {
    url: `/api/${path}`,
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  };
  await handler(request, response);
  return {
    status: response.statusCode,
    headers: responseHeaders,
    json: response.body ? JSON.parse(response.body) : null,
  };
}

test("health endpoint reports a healthy serverless API", async () => {
  const result = await callApi({ path: "health" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { ok: true, service: "learnos-api", runtime: "nodejs" });
  assert.match(result.headers.get("content-type"), /application\/json/);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("signup rejects missing and malformed account details", async (t) => {
  for (const body of [
    { fullName: "H", email: "harsh@example.com", password: "long-enough-pass" },
    { fullName: "Harsh", email: "not-an-email", password: "long-enough-pass" },
    { fullName: "Harsh", email: "harsh@example.com", password: "short" },
  ]) {
    await t.test(JSON.stringify(body), async () => {
      const result = await callApi({ path: "auth/signup", method: "POST", body });
      assert.equal(result.status, 400);
      assert.equal(result.json.error.code, "INVALID_SIGNUP");
    });
  }
});

test("auth endpoints validate token and password before database access", async (t) => {
  await t.test("verification rejects a short token", async () => {
    const result = await callApi({ path: "auth/verify", method: "POST", body: { token: "short" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_TOKEN");
  });

  await t.test("password reset rejects passwords under ten characters", async () => {
    const result = await callApi({ path: "auth/reset-password", method: "POST", body: { token: "token-value-long-enough", password: "tiny" } });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_PASSWORD");
  });

  await t.test("malformed JSON becomes a client error", async () => {
    const result = await callApi({ path: "auth/verify", method: "POST", body: "{" });
    assert.equal(result.status, 400);
    assert.equal(result.json.error.code, "INVALID_JSON");
  });
});

test("protected learning routes reject unauthenticated requests", async (t) => {
  const routes = [
    ["GET", "courses"], ["GET", "goals"], ["GET", "tasks"], ["GET", "notes"],
    ["GET", "flashcards"], ["GET", "progress"], ["GET", "settings"], ["GET", "home"],
    ["POST", "notes"], ["POST", "flashcards"], ["POST", "practice"], ["POST", "tutor"],
    ["GET", "study-rooms"], ["POST", "study-rooms"], ["POST", "study-rooms/ABCDEF12/timer"],
  ];
  for (const [method, path] of routes) {
    await t.test(`${method} /api/${path}`, async () => {
      const result = await callApi({ path, method, body: {} });
      assert.equal(result.status, 401);
      assert.equal(result.json.error.code, "UNAUTHENTICATED");
    });
  }
});

test("unconfigured database failures return a safe 503 response", async () => {
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const result = await callApi({ path: "auth/login", method: "POST", body: { email: "harsh@example.com", password: "long-enough-pass" } });
    assert.equal(result.status, 503);
    assert.equal(result.json.error.code, "DATABASE_NOT_CONFIGURED");
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});
