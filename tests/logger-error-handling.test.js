import test from "node:test";
import assert from "node:assert/strict";
import {
  logger,
  Logger,
  LOG_LEVELS,
  sanitize,
  sanitizeString,
} from "../server/logger.js";
import {
  sendJson,
  sendError,
  safeError,
  createErrorPayload,
  HttpError,
  HTTP_STATUS,
} from "../server/http.js";

test("Structured Logger: Log Levels, Formatting, and Operational Context", async (t) => {
  await t.test("exports standard log levels in ascending severity order", () => {
    assert.equal(typeof LOG_LEVELS.DEBUG, "number");
    assert.equal(typeof LOG_LEVELS.INFO, "number");
    assert.equal(typeof LOG_LEVELS.WARN, "number");
    assert.equal(typeof LOG_LEVELS.ERROR, "number");
    assert.ok(LOG_LEVELS.DEBUG < LOG_LEVELS.INFO);
    assert.ok(LOG_LEVELS.INFO < LOG_LEVELS.WARN);
    assert.ok(LOG_LEVELS.WARN < LOG_LEVELS.ERROR);
  });

  await t.test("formats log lines with ISO timestamps, level badges, and operational context", () => {
    const customLogger = new Logger("drizzlearn:test");
    const entry = {
      timestamp: "2026-11-11T16:00:00.000Z",
      level: "INFO",
      context: "drizzlearn:mongo",
      message: "Query executed successfully",
      meta: { collection: "users", durationMs: 4.2 },
    };

    const formatted = customLogger.formatEntry(entry);
    assert.match(formatted, /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    assert.match(formatted, /\[INFO \]/);
    assert.match(formatted, /\[drizzlearn:mongo\]/);
    assert.match(formatted, /Query executed successfully/);
    assert.match(formatted, /"collection":"users"/);
    assert.match(formatted, /"durationMs":4.2/);
  });

  await t.test("records log entries into diagnostic ring buffer", () => {
    const testLogger = new Logger("drizzlearn:buffer");
    testLogger.clearLogs();
    testLogger.info("Learner enrolled", "drizzlearn:course", { courseId: "c1" });
    testLogger.warn("Approaching weekly budget", "drizzlearn:task", { remainingMin: 15 });
    testLogger.error("Failed checkpoint evaluation", "drizzlearn:ai", { code: "AI_TIMEOUT" });

    const recent = testLogger.getRecentLogs();
    assert.equal(recent.length, 3);
    assert.equal(recent[0].level, "INFO");
    assert.equal(recent[0].context, "drizzlearn:course");
    assert.equal(recent[1].level, "WARN");
    assert.equal(recent[2].level, "ERROR");
    assert.equal(recent[2].context, "drizzlearn:ai");
  });

  await t.test("supports child loggers with pre-bound operational context", () => {
    const child = logger.child("drizzlearn:retrieval");
    assert.equal(child.defaultContext, "drizzlearn:retrieval");
  });

  await t.test("time helper calculates and logs duration in milliseconds", async () => {
    const testLogger = new Logger("drizzlearn:timer");
    const end = testLogger.time("Vector embedding lookup", "drizzlearn:retrieval");
    await new Promise((r) => setTimeout(r, 15));
    const duration = end({ items: 5 });
    assert.ok(duration >= 10, `Duration should be >= 10ms, was ${duration}ms`);
  });
});

test("Safe Logging: Sensitive Data Redaction & Sanitization", async (t) => {
  await t.test("redacts sensitive object keys (passwords, tokens, secrets, cookies)", () => {
    const payload = {
      email: "learner@drizzlearn.com",
      password: "SuperSecretPassword123!",
      password_hash: "$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM",
      token: "secret-auth-token-42",
      token_hash: "hash999",
      apiKey: "nvapi-abcdef1234567890abcdef",
      cookie: "learnos_session=abc.def",
      regularField: "active",
      profile: {
        newPassword: "NewSecretPassword!",
        notification_preferences: { study: true },
      },
    };

    const sanitized = sanitize(payload);
    assert.equal(sanitized.email, "learner@drizzlearn.com");
    assert.equal(sanitized.password, "[REDACTED]");
    assert.equal(sanitized.password_hash, "[REDACTED]");
    assert.equal(sanitized.token, "[REDACTED]");
    assert.equal(sanitized.token_hash, "[REDACTED]");
    assert.equal(sanitized.apiKey, "[REDACTED]");
    assert.equal(sanitized.cookie, "[REDACTED]");
    assert.equal(sanitized.regularField, "active");
    assert.equal(sanitized.profile.newPassword, "[REDACTED]");
    assert.deepEqual(sanitized.profile.notification_preferences, { study: true });
  });

  await t.test("sanitizes MongoDB and PostgreSQL connection strings with credentials", () => {
    const mongoUri = "mongodb+srv://admin_user:P%40ssw0rd99@cluster0.v3zhmlg.mongodb.net/drizzlearn?retryWrites=true";
    const postgresUri = "postgres://postgres_user:secret_pg_pass@localhost:5432/drizzlearn";

    const sanitizedMongo = sanitizeString(mongoUri);
    assert.ok(!sanitizedMongo.includes("P%40ssw0rd99"), "Password must be stripped from Mongo URI");
    assert.ok(sanitizedMongo.includes("mongodb+srv://admin_user:***@cluster0.v3zhmlg.mongodb.net"));

    const sanitizedPg = sanitizeString(postgresUri);
    assert.ok(!sanitizedPg.includes("secret_pg_pass"), "Password must be stripped from Postgres URI");
    assert.ok(sanitizedPg.includes("postgres://postgres_user:***@localhost:5432"));
  });

  await t.test("redacts Bearer tokens, NVIDIA API keys, and session cookies in strings", () => {
    const bearer = "Authorization: Bearer ya29.a0AfH6SMDI_secret_token_value_12345";
    assert.equal(sanitizeString(bearer), "Authorization: Bearer [REDACTED]");

    const nvKey = "Calling provider with nvapi-abcdef1234567890abcdef123456";
    assert.equal(sanitizeString(nvKey), "Calling provider with nvapi-[REDACTED]");

    const cookieStr = "Cookie: theme=dark; learnos_session=eyJhbGciOiJIUzI1NiJ9.test; lang=en";
    assert.equal(sanitizeString(cookieStr), "Cookie: theme=dark; learnos_session=[REDACTED]; lang=en");
  });

  await t.test("detects and redacts standalone bcrypt hashes in parameters or values", () => {
    const hash = "$2b$10$wE0p7zYtN.oN1Q6m6D8qgeM5Z5eJ8lq2W3e4r5t6y7u8i9o0p1a2s";
    assert.equal(sanitize(hash), "[BCRYPT_HASH_REDACTED]");

    const sqlParams = ["learner@example.com", "Learner Name", hash];
    const sanitizedParams = sanitize(sqlParams);
    assert.equal(sanitizedParams[0], "learner@example.com");
    assert.equal(sanitizedParams[1], "Learner Name");
    assert.equal(sanitizedParams[2], "[BCRYPT_HASH_REDACTED]");
  });

  await t.test("safely handles circular references and Errors without crashing", () => {
    const circular = { name: "cycle" };
    circular.self = circular;

    const sanitizedCircular = sanitize(circular);
    assert.equal(sanitizedCircular.name, "cycle");
    assert.equal(sanitizedCircular.self, "[CIRCULAR]");

    const err = new Error("Connection failed to mongodb+srv://user:pass123@cluster.mongodb.net");
    err.code = "ECONNREFUSED";
    const sanitizedErr = sanitize(err);
    assert.equal(sanitizedErr.name, "Error");
    assert.equal(sanitizedErr.code, "ECONNREFUSED");
    assert.ok(!sanitizedErr.message.includes("pass123"));
    assert.ok(sanitizedErr.message.includes("***@cluster.mongodb.net"));
  });
});

test("Clear MongoDB Query Logging & Diagnostic Tracing", async (t) => {
  await t.test("logMongoQuery traces collection, action, duration, and row counts", () => {
    const testLogger = new Logger("drizzlearn:mongo-test");
    testLogger.clearLogs();
    testLogger.setLevel("DEBUG");

    testLogger.logMongoQuery({
      collection: "courses",
      action: "find",
      durationMs: 3.5,
      rowCount: 4,
      filter: { user_id: "u123", status: "active" },
    });

    const logs = testLogger.getRecentLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, "DEBUG");
    assert.equal(logs[0].context, "drizzlearn:mongo");
    assert.ok(logs[0].message.includes("courses.find (3.5ms) [4 rows]"));
    assert.equal(logs[0].meta.collection, "courses");
    assert.equal(logs[0].meta.durationMs, 3.5);
    assert.equal(logs[0].meta.rowCount, 4);
  });

  await t.test("logMongoError records comprehensive diagnostic info on query failures", () => {
    const testLogger = new Logger("drizzlearn:mongo-test");
    testLogger.clearLogs();

    const dbError = new Error("Write conflict in transaction");
    dbError.code = 112;

    testLogger.logMongoError({
      collection: "users",
      action: "updateOne",
      durationMs: 12.8,
      error: dbError,
      query: "UPDATE users SET password_hash=$1 WHERE id=$2",
      params: ["$2b$10$abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM", "user-uuid"],
    });

    const logs = testLogger.getRecentLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].level, "ERROR");
    assert.equal(logs[0].context, "drizzlearn:mongo");
    assert.ok(logs[0].message.includes("MongoDB query failed: users.updateOne after 12.8ms"));

    const diag = logs[0].meta;
    assert.equal(diag.collection, "users");
    assert.equal(diag.action, "updateOne");
    assert.equal(diag.errorCode, 112);
    assert.equal(diag.durationMs, 12.8);
    assert.equal(diag.params[0], "[BCRYPT_HASH_REDACTED]", "Password hash in SQL parameters must be redacted");
    assert.equal(diag.params[1], "user-uuid");
  });
});

test("Consistent & Proper HTTP Error Responses", async (t) => {
  const createMockResponse = () => {
    const headers = new Map();
    let body = "";
    return {
      statusCode: 200,
      setHeader: (k, v) => headers.set(k.toLowerCase(), v),
      end: (val) => { body = val; },
      getStatus: () => this?.statusCode,
      getBody: () => body,
      getJson: () => JSON.parse(body),
      getHeader: (k) => headers.get(k.toLowerCase()),
    };
  };

  await t.test("standardized JSON error payload format { error: { code, message, details? } }", () => {
    const payloadWithoutDetails = createErrorPayload("INVALID_INPUT", "A title is required.");
    assert.deepEqual(payloadWithoutDetails, {
      error: { code: "INVALID_INPUT", message: "A title is required." },
    });

    const payloadWithDetails = createErrorPayload("INVALID_POMODORO", "Invalid focus duration.", {
      min: 5,
      max: 90,
    });
    assert.deepEqual(payloadWithDetails, {
      error: {
        code: "INVALID_POMODORO",
        message: "Invalid focus duration.",
        details: { min: 5, max: 90 },
      },
    });
  });

  await t.test("sendError correctly sets status code and sends standardized error", () => {
    const res = createMockResponse();
    sendError(res, 404, "NOT_FOUND", "Lesson was not found.");
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.getJson(), {
      error: { code: "NOT_FOUND", message: "Lesson was not found." },
    });
    assert.equal(res.getHeader("content-type"), "application/json; charset=utf-8");
    assert.equal(res.getHeader("cache-control"), "no-store");
  });

  await t.test("safeError maps DATABASE_NOT_CONFIGURED to 503 Service Unavailable", () => {
    const res = createMockResponse();
    safeError(res, { code: "DATABASE_NOT_CONFIGURED", message: "Configure MONGODB_URI in environment." });
    assert.equal(res.statusCode, 503);
    const body = res.getJson();
    assert.equal(body.error.code, "DATABASE_NOT_CONFIGURED");
    assert.equal(body.error.message, "Configure MONGODB_URI in environment.");
  });

  await t.test("safeError maps DATABASE_UNAVAILABLE / connection failures to recoverable 503", () => {
    const res = createMockResponse();
    const mongoNetError = new Error("Server selection timed out after 8000 ms");
    mongoNetError.name = "MongoServerSelectionError";

    safeError(res, mongoNetError);
    assert.equal(res.statusCode, 503);
    const body = res.getJson();
    assert.equal(body.error.code, "DATABASE_UNAVAILABLE");
    assert.ok(body.error.message.includes("database service is temporarily unavailable"));
    assert.equal(body.error.details.retryable, true);
  });

  await t.test("safeError maps AI taxonomy to correct 429, 504, 502, 503 status codes with retryable flag", () => {
    const cases = [
      { code: "AI_RATE_LIMIT", expectedStatus: 429 },
      { code: "AI_TIMEOUT", expectedStatus: 504 },
      { code: "AI_PROVIDER_ERROR", expectedStatus: 502 },
      { code: "AI_INVALID_PLAN", expectedStatus: 502 },
      { code: "AI_UNKNOWN_SPECIALIST", expectedStatus: 503 },
    ];

    for (const { code, expectedStatus } of cases) {
      const res = createMockResponse();
      safeError(res, { code, message: `Operation failed with ${code}` });
      assert.equal(res.statusCode, expectedStatus);
      const json = res.getJson();
      assert.equal(json.error.code, code);
      assert.equal(typeof json.error.details.retryable, "boolean");
    }
  });

  await t.test("safeError suppresses internal database errors, SQL text, and stack traces from client", () => {
    const res = createMockResponse();
    const internalErr = new Error("syntax error at or near 'SELECT * FROM users' at client.js:42:10");
    internalErr.stack = "Error: syntax error...\n    at pgClient.query (/app/node_modules/pg/client.js:123)";

    safeError(res, internalErr);
    assert.equal(res.statusCode, 500);
    const json = res.getJson();
    assert.deepEqual(json, {
      error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
    });
    assert.equal(res.getBody().includes("syntax error"), false);
    assert.equal(res.getBody().includes("client.js"), false);
  });

  await t.test("HttpError class enables typed error throwing with status and code", () => {
    const err = new HttpError(403, "FORBIDDEN", "You do not own this course proposal.", { courseId: "c1" });
    assert.equal(err.status, 403);
    assert.equal(err.code, "FORBIDDEN");
    assert.equal(err.message, "You do not own this course proposal.");
    assert.deepEqual(err.details, { courseId: "c1" });
  });

  await t.test("HTTP_STATUS contains standard HTTP status code definitions", () => {
    assert.equal(HTTP_STATUS.OK, 200);
    assert.equal(HTTP_STATUS.BAD_REQUEST, 400);
    assert.equal(HTTP_STATUS.UNAUTHORIZED, 401);
    assert.equal(HTTP_STATUS.FORBIDDEN, 403);
    assert.equal(HTTP_STATUS.NOT_FOUND, 404);
    assert.equal(HTTP_STATUS.METHOD_NOT_ALLOWED, 405);
    assert.equal(HTTP_STATUS.CONFLICT, 409);
    assert.equal(HTTP_STATUS.RATE_LIMITED, 429);
    assert.equal(HTTP_STATUS.INTERNAL_ERROR, 500);
    assert.equal(HTTP_STATUS.BAD_GATEWAY, 502);
    assert.equal(HTTP_STATUS.SERVICE_UNAVAILABLE, 503);
    assert.equal(HTTP_STATUS.GATEWAY_TIMEOUT, 504);
  });
});
