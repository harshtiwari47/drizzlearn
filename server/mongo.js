import { MongoClient } from "mongodb";
import { logger, sanitize } from "./logger.js";

let mongoClient = null;
let mongoDb = null;

export const DEFAULT_MONGO_URI = "mongodb+srv://hrsrix_db_user:R0seeAXuSKbIQu97@cluster0.v3zhmlg.mongodb.net/drizzlearn?retryWrites=true&w=majority";

export function getMongoUri() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  if (uri && uri.startsWith("mongodb")) return uri;
  return DEFAULT_MONGO_URI;
}

export function isMongoConfigured() {
  const uri = process.env.MONGODB_URI || process.env.DATABASE_URL;
  return Boolean(uri && uri.startsWith("mongodb"));
}

export async function getMongoClient() {
  if (!mongoClient) {
    const uri = getMongoUri();
    const startTime = Date.now();
    logger.info("Connecting to MongoDB cluster...", "drizzlearn:mongo", { uri: sanitize(uri) });
    mongoClient = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
    });
    try {
      await mongoClient.connect();
      const durationMs = Date.now() - startTime;
      logger.info(`Connected to MongoDB successfully in ${durationMs}ms`, "drizzlearn:mongo");
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.error(`Failed to connect to MongoDB after ${durationMs}ms`, "drizzlearn:mongo", {
        error: err.message,
        code: err.code,
        uri: sanitize(uri),
      });
      mongoClient = null;
      throw err;
    }
  }
  return mongoClient;
}

export async function getMongoDb(dbName = "drizzlearn") {
  if (!mongoDb) {
    const client = await getMongoClient();
    mongoDb = client.db(dbName);
  }
  return mongoDb;
}

export async function getCollection(name) {
  const db = await getMongoDb();
  return db.collection(name);
}

export async function closeMongo() {
  if (mongoClient) {
    logger.debug("Closing MongoDB connection pool", "drizzlearn:mongo");
    try {
      await mongoClient.close();
    } catch {}
    mongoClient = null;
    mongoDb = null;
  }
}

export async function initMongoIndexes() {
  const startTime = Date.now();
  logger.info("Initializing MongoDB indexes...", "drizzlearn:mongo");
  const db = await getMongoDb();

  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db.collection("auth_tokens").createIndex({ token_hash: 1 }, { unique: true });
  await db.collection("auth_tokens").createIndex({ user_id: 1, purpose: 1 });
  await db.collection("learning_goals").createIndex({ user_id: 1, status: 1 });
  await db.collection("courses").createIndex({ user_id: 1, status: 1 });
  await db.collection("courses").createIndex({ goal_id: 1 });
  await db.collection("course_modules").createIndex({ course_id: 1, position: 1 }, { unique: true });
  await db.collection("lessons").createIndex({ module_id: 1, position: 1 }, { unique: true });
  await db.collection("lessons").createIndex({ course_id: 1 });
  await db.collection("study_tasks").createIndex({ user_id: 1, scheduled_at: 1, status: 1 });
  await db.collection("study_tasks").createIndex({ course_id: 1, status: 1 });
  await db.collection("practice_attempts").createIndex({ user_id: 1, created_at: -1 });
  await db.collection("notes").createIndex({ user_id: 1, updated_at: -1 });
  await db.collection("flashcards").createIndex({ user_id: 1, due_at: 1 });
  await db.collection("review_events").createIndex({ user_id: 1, reviewed_at: -1 });
  await db.collection("study_rooms").createIndex({ room_code: 1 }, { unique: true });
  await db.collection("study_rooms").createIndex({ owner_user_id: 1, updated_at: -1 });
  await db.collection("study_room_members").createIndex({ room_id: 1, user_id: 1 }, { unique: true });
  await db.collection("ai_jobs").createIndex({ user_id: 1, status: 1 });
  await db.collection("rag_chunks").createIndex(
    { user_id: 1, source_type: 1, source_id: 1, chunk_index: 1 },
    { unique: true }
  );
  await db.collection("rag_chunks").createIndex({ user_id: 1, source_type: 1 });
  await db.collection("rag_chunks").createIndex({ user_id: 1, course_id: 1 });
  await db.collection("rag_chunks").createIndex({ user_id: 1, updated_at: -1 });

  const durationMs = Date.now() - startTime;
  logger.info(`Initialized MongoDB indexes in ${durationMs}ms`, "drizzlearn:mongo");
  return true;
}
