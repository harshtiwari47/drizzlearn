import "./env.js";
import pg from "pg";
import { getMongoClient, getMongoDb, getCollection, isMongoConfigured, initMongoIndexes } from "./mongo.js";
import { executeMongoQuery } from "./mongo-adapter.js";
import { logger, sanitize } from "./logger.js";

const { Pool } = pg;
let pool;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function isMongoDatabase() {
  if (!databaseConfigured()) return false;
  const uri = process.env.DATABASE_URL || "";
  return uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://");
}

export function getPoolMockState() {
  const connectMocked = Boolean(pool && pool.connect !== Pool.prototype.connect);
  const queryMocked = Boolean(pool && pool.query !== Pool.prototype.query);
  return {
    connectMocked,
    queryMocked,
    pinnedQuery: queryMocked ? pool.query.bind(pool) : null,
  };
}

export function getPool() {
  if (!databaseConfigured()) {
    const error = new Error("Database is not configured. Set DATABASE_URL or MONGODB_URI.");
    error.code = "DATABASE_NOT_CONFIGURED";
    throw error;
  }
  if (!pool) {
    const connStr = process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("mongodb")
      ? process.env.DATABASE_URL
      : "postgres://dummy:dummy@localhost:5432/drizzlearn";
    pool = new Pool({
      connectionString: connStr,
      max: 3,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

export async function query(text, values = []) {
  const startTime = Date.now();
  try {
    let result;
    if (isMongoDatabase() && (!pool || pool.query === Pool.prototype.query)) {
      result = await executeMongoQuery(text, values);
    } else {
      result = await getPool().query(text, values);
    }
    const durationMs = Date.now() - startTime;
    logger.debug(`Database query executed in ${durationMs}ms`, "drizzlearn:db", {
      sql: sanitize(text),
      rowCount: result?.rows?.length ?? 0,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(`Database query failed after ${durationMs}ms [${error?.code || "DB_ERR"}]: ${error?.message || error}`, "drizzlearn:db", {
      sql: sanitize(text),
      code: error?.code,
      durationMs,
    });
    throw error;
  }
}

export async function withTransaction(work) {
  const startTime = Date.now();

  // If pool.connect was mocked (e.g. in test suites) or Postgres is used, use pool transaction
  if (pool && pool.connect !== Pool.prototype.connect) {
    const client = await pool.connect();
    let releaseError;
    try {
      await client.query("BEGIN");
      const value = await work(client);
      await client.query("COMMIT");
      logger.debug(`Transaction committed in ${Date.now() - startTime}ms`, "drizzlearn:db");
      return value;
    } catch (error) {
      logger.warn(`Transaction failed, initiating ROLLBACK: ${error?.message || error}`, "drizzlearn:db", {
        code: error?.code,
      });
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error(`Transaction rollback error: ${rollbackError?.message || rollbackError}`, "drizzlearn:db");
        releaseError = rollbackError;
        if (error && typeof error === "object" && !error.cause) {
          try { error.cause = rollbackError; } catch {}
        }
      }
      throw error;
    } finally {
      client.release(releaseError);
    }
  }

  // If MongoDB is configured, use MongoDB multi-document transaction
  if (isMongoDatabase()) {
    const client = await getMongoClient();
    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        result = await work({
          query: (sql, values) => executeMongoQuery(sql, values, session),
        });
      });
      logger.debug(`MongoDB transaction committed in ${Date.now() - startTime}ms`, "drizzlearn:mongo");
      return result;
    } catch (error) {
      logger.warn(`MongoDB transaction aborted: ${error?.message || error}`, "drizzlearn:mongo", {
        code: error?.code,
      });
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // Standard PostgreSQL transaction
  const client = await getPool().connect();
  let releaseError;
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    logger.debug(`PostgreSQL transaction committed in ${Date.now() - startTime}ms`, "drizzlearn:db");
    return value;
  } catch (error) {
    logger.warn(`PostgreSQL transaction failed, rolling back: ${error?.message || error}`, "drizzlearn:db", {
      code: error?.code,
    });
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      logger.error(`PostgreSQL rollback error: ${rollbackError?.message || rollbackError}`, "drizzlearn:db");
      releaseError = rollbackError;
      if (error && typeof error === "object" && !error.cause) {
        try { error.cause = rollbackError; } catch {}
      }
    }
    throw error;
  } finally {
    client.release(releaseError);
  }
}

export { getMongoClient, getMongoDb, getCollection, initMongoIndexes };
