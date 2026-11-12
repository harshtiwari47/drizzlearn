import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL before running database migrations.");
  process.exitCode = 1;
} else {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const sql = await fs.readFile(path.join(root, "db", "schema.sql"), "utf8");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(sql);
    console.log("LearnOS database schema is ready.");
  } catch (error) {
    console.error("LearnOS migration failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
