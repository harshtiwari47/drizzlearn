import { getMongoClient, getMongoDb, initMongoIndexes, closeMongo, getMongoUri } from "../server/mongo.js";

const uri = getMongoUri();
console.log(`Connecting to MongoDB at: ${uri.replace(/:([^:@]+)@/, ":****@")}...`);

try {
  const client = await getMongoClient();
  const db = await getMongoDb();
  console.log(`Connected to database: "${db.databaseName}"`);

  console.log("Creating and ensuring collection indexes...");
  await initMongoIndexes();
  console.log("✓ MongoDB indexes created successfully:");
  console.log("  - users (unique email)");
  console.log("  - auth_tokens (unique token_hash, compound user_id + purpose)");
  console.log("  - learning_goals (user_id + status)");
  console.log("  - courses (user_id + status, goal_id)");
  console.log("  - course_modules (unique course_id + position)");
  console.log("  - lessons (unique module_id + position, course_id)");
  console.log("  - study_tasks (user_id + scheduled_at + status, course_id + status)");
  console.log("  - practice_attempts (user_id + created_at)");
  console.log("  - notes (user_id + updated_at, full-text search)");
  console.log("  - flashcards (user_id + due_at)");
  console.log("  - review_events (user_id + reviewed_at)");
  console.log("  - study_rooms (unique room_code, owner_user_id + updated_at)");
  console.log("  - study_room_members (unique room_id + user_id)");
  console.log("  - ai_jobs (user_id + status)");

  console.log("\nDrizzlearn MongoDB schema migration completed successfully.");
} catch (error) {
  console.error("MongoDB migration failed:", error.message);
  if (error.message.includes("SSL routines") || error.message.includes("alert number 80") || error.message.includes("MongoServerSelectionError")) {
    console.error("\n[NOTE] MongoDB Atlas IP Whitelist Notice:");
    console.error("Your IP address is not currently allowed in MongoDB Atlas Network Access.");
    console.error("1. Go to your MongoDB Atlas dashboard: https://cloud.mongodb.com");
    console.error("2. Navigate to Network Access -> IP Access List");
    console.error("3. Click 'Add IP Address' -> Select 'Allow Access from Anywhere' (0.0.0.0/0) or add your current IP.");
    console.error("4. Wait 1 minute and re-run: npm run db:migrate");
  }
  process.exitCode = 1;
} finally {
  await closeMongo();
}
