/**
 * Drizzlearn Structured Logger & Diagnostics Module
 *
 * Provides:
 * - Leveled logging: DEBUG, INFO, WARN, ERROR
 * - Timestamps in ISO-8601 UTC format
 * - Operational context badges (e.g. [drizzlearn:mongo], [drizzlearn:http])
 * - Sensitive data redaction (passwords, tokens, API keys, connection strings, hashes)
 * - Clear MongoDB query & failure diagnostic tracing with millisecond durations
 * - Safe serialization of errors, circular references, and buffers
 */

export const LOG_LEVELS = Object.freeze({
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  NONE: 100,
});

const SENSITIVE_KEY_PATTERN = /^(password|password_hash|passwordHash|newPassword|currentPassword|confirmPassword|passwd|pwd|token|token_hash|tokenHash|authToken|auth_token|secret|session_secret|authorization|cookie|set-cookie|apiKey|api_key|access_token|refresh_token)$/i;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{30,}$/;
const MONGO_URI_CREDENTIALS_PATTERN = /(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/gi;
const POSTGRES_URI_CREDENTIALS_PATTERN = /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi;
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9_\-\.~+/]+=*/gi;
const GROQ_KEY_PATTERN = /gsk_[A-Za-z0-9]{20,}/gi;
const NVIDIA_KEY_PATTERN = /nvapi-[A-Za-z0-9_\-]{16,}/gi;
const GEMINI_KEY_PATTERN = /(?:AIzaSy[A-Za-z0-9_\-]{33}|AQ\.[A-Za-z0-9_\-]{40,})/gi;
const JWT_PATTERN = /ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g;
const SESSION_COOKIE_PATTERN = /(learnos_session=)[^;\s]+/gi;

/**
 * Sanitizes a string by redacting embedded secrets, URIs with credentials,
 * API keys, JWTs, and bearer tokens.
 */
export function sanitizeString(str) {
  if (typeof str !== "string") return str;
  if (BCRYPT_HASH_PATTERN.test(str)) return "[BCRYPT_HASH_REDACTED]";
  return str
    .replace(MONGO_URI_CREDENTIALS_PATTERN, "$1***$3")
    .replace(POSTGRES_URI_CREDENTIALS_PATTERN, "$1***$3")
    .replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]")
    .replace(GROQ_KEY_PATTERN, "[GROQ_KEY_REDACTED]")
    .replace(NVIDIA_KEY_PATTERN, "nvapi-[REDACTED]")
    .replace(GEMINI_KEY_PATTERN, "[GEMINI_KEY_REDACTED]")
    .replace(JWT_PATTERN, "[JWT_REDACTED]")
    .replace(SESSION_COOKIE_PATTERN, "$1[REDACTED]");
}

/**
 * Recursively sanitizes an arbitrary data structure (object, array, error, primitive).
 * Safely handles circular references, buffers, dates, and max depth limits.
 */
export function sanitize(data, seen = new WeakSet(), depth = 0) {
  if (data === null || data === undefined) return data;

  const type = typeof data;
  if (type === "string") return sanitizeString(data);
  if (type === "number" || type === "boolean" || type === "symbol") return data;
  if (type === "bigint") return data.toString();

  if (depth > 8) return "[MAX_DEPTH_REACHED]";

  if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
    return `<Buffer length=${data.length}>`;
  }
  if (data instanceof Date) {
    return data.toISOString();
  }
  if (data instanceof RegExp) {
    return data.toString();
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: sanitizeString(data.message),
      code: data.code,
      ...(data.cause ? { cause: sanitize(data.cause, seen, depth + 1) } : {}),
      ...(data.stack ? { stack: sanitizeString(data.stack) } : {}),
    };
  }

  if (type === "object") {
    if (seen.has(data)) return "[CIRCULAR]";
    seen.add(data);

    if (Array.isArray(data)) {
      return data.map((item) => sanitize(item, seen, depth + 1));
    }

    const sanitizedObj = {};
    for (const [key, value] of Object.entries(data)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        sanitizedObj[key] = "[REDACTED]";
      } else {
        try {
          sanitizedObj[key] = sanitize(value, seen, depth + 1);
        } catch {
          sanitizedObj[key] = "[UNSERIALIZABLE]";
        }
      }
    }
    return sanitizedObj;
  }

  return String(data);
}

/**
 * Resolves the configured log level threshold from environment variables.
 */
function resolveInitialLevel() {
  const envLevel = (process.env.LOG_LEVEL || "").toUpperCase();
  if (envLevel in LOG_LEVELS) return LOG_LEVELS[envLevel];

  // In automated test runs, keep console output focused unless debugging is requested
  if (process.env.NODE_ENV === "test") {
    return LOG_LEVELS.WARN;
  }
  return LOG_LEVELS.INFO;
}

export class Logger {
  constructor(defaultContext = "drizzlearn") {
    this.defaultContext = defaultContext;
    this.currentLevel = resolveInitialLevel();
    this.ringBuffer = [];
    this.maxBufferSize = 100;
  }

  getLevel() {
    return this.currentLevel;
  }

  setLevel(level) {
    if (typeof level === "string") {
      const upper = level.toUpperCase();
      if (upper in LOG_LEVELS) this.currentLevel = LOG_LEVELS[upper];
    } else if (typeof level === "number") {
      this.currentLevel = level;
    }
  }

  shouldLog(levelNumber) {
    return levelNumber >= this.currentLevel;
  }

  formatEntry({ timestamp, level, context, message, meta }) {
    if (process.env.LOG_FORMAT === "json") {
      return JSON.stringify({
        timestamp,
        level,
        context,
        message,
        ...(meta !== undefined ? { meta: sanitize(meta) } : {}),
      });
    }

    const levelBadge = `[${level.padEnd(5)}]`;
    const contextBadge = `[${context}]`;
    let line = `[${timestamp}] ${levelBadge} ${contextBadge} ${message}`;

    if (meta !== undefined && meta !== null) {
      const sanitized = sanitize(meta);
      if (typeof sanitized === "object" && Object.keys(sanitized).length > 0) {
        try {
          line += ` ${JSON.stringify(sanitized)}`;
        } catch {
          line += " [Metadata serialization error]";
        }
      } else if (typeof sanitized !== "object") {
        line += ` ${sanitized}`;
      }
    }
    return line;
  }

  log(levelName, message, context = null, meta = null) {
    const levelNumber = LOG_LEVELS[levelName] ?? LOG_LEVELS.INFO;
    const timestamp = new Date().toISOString();
    const resolvedContext = context || this.defaultContext;

    const entry = {
      timestamp,
      level: levelName,
      context: resolvedContext,
      message: typeof message === "string" ? message : sanitizeString(String(message)),
      meta,
    };

    // Keep in in-memory ring buffer for diagnostics and test verification
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.maxBufferSize) {
      this.ringBuffer.shift();
    }

    if (!this.shouldLog(levelNumber)) return;

    const formatted = this.formatEntry(entry);

    switch (levelName) {
      case "ERROR":
        console.error(formatted);
        break;
      case "WARN":
        console.warn(formatted);
        break;
      case "INFO":
        console.info(formatted);
        break;
      case "DEBUG":
      default:
        console.debug ? console.debug(formatted) : console.log(formatted);
        break;
    }
  }

  debug(message, context = null, meta = null) {
    this.log("DEBUG", message, context, meta);
  }

  info(message, context = null, meta = null) {
    this.log("INFO", message, context, meta);
  }

  warn(message, context = null, meta = null) {
    this.log("WARN", message, context, meta);
  }

  error(message, context = null, meta = null) {
    this.log("ERROR", message, context, meta);
  }

  /**
   * Creates a child logger with a pre-bound operational context.
   */
  child(childContext) {
    const childInstance = new Logger(childContext);
    childInstance.currentLevel = this.currentLevel;
    return childInstance;
  }

  /**
   * Measures the execution duration of an operation and logs upon completion.
   */
  time(operation, context = null) {
    const start = Date.now();
    const ctx = context || this.defaultContext;
    return (meta = null) => {
      const durationMs = Date.now() - start;
      this.debug(`${operation} completed in ${durationMs}ms`, ctx, { durationMs, ...meta });
      return durationMs;
    };
  }

  /**
   * Logs a successful MongoDB query/action with execution timing.
   */
  logMongoQuery({ collection, action, durationMs, rowCount = null, filter = null, meta = null }) {
    const details = {
      collection,
      action,
      durationMs,
      ...(rowCount !== null ? { rowCount } : {}),
      ...(filter ? { filter: sanitize(filter) } : {}),
      ...(meta ? sanitize(meta) : {}),
    };

    // If explicit query logging is requested or debug level is on
    const msg = `MongoDB: ${collection}.${action} (${durationMs}ms)${rowCount !== null ? ` [${rowCount} rows]` : ""}`;
    if (process.env.LOG_QUERIES === "true") {
      this.info(msg, "drizzlearn:mongo", details);
    } else {
      this.debug(msg, "drizzlearn:mongo", details);
    }
  }

  /**
   * Logs a failed MongoDB query/action with structured diagnostic info.
   */
  logMongoError({ collection, action, durationMs, error, query = null, params = null }) {
    const diagnostic = {
      collection,
      action,
      durationMs,
      errorCode: error?.code || "UNKNOWN_DB_ERROR",
      errorMessage: error?.message || "Unknown database error",
      ...(query ? { query: sanitizeString(query) } : {}),
      ...(params ? { params: sanitize(params) } : {}),
      ...(error?.stack ? { stack: sanitizeString(error.stack) } : {}),
    };

    const msg = `MongoDB query failed: ${collection}.${action} after ${durationMs}ms [${diagnostic.errorCode}]: ${diagnostic.errorMessage}`;
    this.error(msg, "drizzlearn:mongo", diagnostic);
  }

  /**
   * Logs HTTP requests/responses with duration and status code.
   */
  logHttp(method, url, statusCode, durationMs, error = null) {
    const level = statusCode >= 500 ? "ERROR" : statusCode >= 400 ? "WARN" : "INFO";
    const msg = `${method} ${url} ${statusCode} (${durationMs}ms)`;
    const meta = {
      method,
      url,
      statusCode,
      durationMs,
      ...(error ? { error: sanitize(error) } : {}),
    };
    this.log(level, msg, "drizzlearn:http", meta);
  }

  getRecentLogs() {
    return [...this.ringBuffer];
  }

  clearLogs() {
    this.ringBuffer = [];
  }
}

export const logger = new Logger("drizzlearn");
export default logger;
