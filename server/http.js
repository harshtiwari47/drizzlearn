import { logger, sanitize } from "./logger.js";

export const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
});

export class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    if (details !== null && details !== undefined) {
      this.details = details;
    }
  }
}

export function createErrorPayload(code, message, details = null) {
  return {
    error: {
      code,
      message,
      ...(details !== null && details !== undefined ? { details } : {}),
    },
  };
}

export function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

export function sendError(res, status, code, message, details) {
  if (status >= 500) {
    logger.error(`API error ${status} [${code}]: ${message}`, "drizzlearn:http", { status, code, details });
  } else if (status >= 400) {
    logger.debug(`API client rejection ${status} [${code}]: ${message}`, "drizzlearn:http", { status, code, details });
  }
  sendJson(res, status, createErrorPayload(code, message, details));
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function methodNotAllowed(res, allowed) {
  sendError(res, 405, "METHOD_NOT_ALLOWED", "This action is not available for the requested method.", { allowed });
}

export function safeError(res, error) {
  if (error?.code === "DATABASE_NOT_CONFIGURED") {
    logger.warn(`Database not configured: ${error.message}`, "drizzlearn:db", { code: error.code });
    return sendError(res, 503, error.code, error.message);
  }

  // Handle recoverable database connection / timeout failures
  if (
    error?.code === "DATABASE_UNAVAILABLE" ||
    error?.code === "ECONNREFUSED" ||
    error?.code === "ETIMEDOUT" ||
    error?.name === "MongoServerSelectionError" ||
    error?.name === "MongoNetworkTimeoutError" ||
    error?.name === "MongoNetworkError"
  ) {
    logger.error(`Database service unavailable [${error.code || error.name}]: ${error.message}`, "drizzlearn:db", {
      code: error.code,
      name: error.name,
      error: sanitize(error),
    });
    return sendError(
      res,
      503,
      "DATABASE_UNAVAILABLE",
      "The database service is temporarily unavailable. Please try again shortly.",
      { retryable: true }
    );
  }

  if (String(error?.code || "").startsWith("AI_")) {
    const status =
      error.code === "AI_RATE_LIMIT"
        ? 429
        : error.code === "AI_TIMEOUT"
        ? 504
        : error.code === "AI_PROVIDER_AUTH" ||
          error.code === "AI_PROVIDER_ERROR" ||
          error.code === "AI_PROVIDER_RESPONSE" ||
          error.code === "AI_EMPTY_RESPONSE" ||
          error.code === "AI_INVALID_JSON" ||
          error.code === "AI_INVALID_PLAN" ||
          error.code === "AI_INVALID_LESSON" ||
          error.code === "AI_INVALID_CHECKPOINT" ||
          error.code === "AI_INVALID_PREREQUISITE"
        ? 502
        : 503;

    logger.warn(`AI provider error [${error.code}]: ${error.message || "Unavailable"}`, "drizzlearn:ai", {
      code: error.code,
      status,
      retryable: error.retryable !== false,
    });
    return sendError(res, status, error.code, error.message || "The AI provider is temporarily unavailable.", {
      retryable: error.retryable !== false,
    });
  }

  // Structured diagnostic logging for unexpected internal errors
  logger.error(`LearnOS API error: ${error?.code || error?.message || "unknown"}`, "drizzlearn:http", {
    code: error?.code,
    message: error?.message,
    stack: error?.stack,
  });

  return sendError(res, 500, "INTERNAL_ERROR", "The request could not be completed.");
}

export async function deleteUserAccount({
  userId,
  password,
  query,
  bcrypt,
  sendJson: sendJsonFn = sendJson,
  sendError: sendErrorFn = sendError,
  clearSessionCookie,
  res,
}) {
  if (!userId) return sendErrorFn(res, 401, "UNAUTHORIZED", "Authentication is required.");
  const check = await query("SELECT password_hash FROM users WHERE id=$1", [userId]);
  if (!check.rows[0]) return sendErrorFn(res, 404, "NOT_FOUND", "User was not found.");
  if (password !== undefined && password !== null && password !== "") {
    const match = await bcrypt.compare(String(password), check.rows[0].password_hash);
    if (!match) return sendErrorFn(res, 401, "INVALID_CREDENTIALS", "Password confirmation did not match.");
  }
  await query("DELETE FROM users WHERE id=$1", [userId]);
  const headers = clearSessionCookie ? { "Set-Cookie": clearSessionCookie() } : {};
  return sendJsonFn(res, 200, { deleted: true }, headers);
}
