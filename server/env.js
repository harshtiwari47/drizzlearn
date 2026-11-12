import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MONGO_URI } from "./mongo.js";

/**
 * Loads environment variables from .env and .env.local into process.env.
 * Does not overwrite existing variables.
 */
export function loadEnvFiles() {
  const root = process.cwd();
  for (const filename of [".env", ".env.local"]) {
    const fullPath = path.resolve(root, filename);
    if (!fs.existsSync(fullPath)) continue;

    try {
      if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile(fullPath);
      } else {
        const lines = fs.readFileSync(fullPath, "utf8").split("\n");
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || line.startsWith("#")) continue;
          const eq = line.indexOf("=");
          if (eq !== -1) {
            const k = line.slice(0, eq).trim();
            const v = line.slice(eq + 1).trim();
            if (process.env[k] === undefined) {
              process.env[k] = v;
            }
          }
        }
      }
    } catch {
      // Ignore file reading errors
    }
  }

  // Provide fallback to configured MongoDB URI if not explicitly removed by test suites
  if (!process.env.DATABASE_URL && !process.env.MONGODB_URI && process.env.NODE_ENV !== "test") {
    process.env.DATABASE_URL = DEFAULT_MONGO_URI;
    process.env.MONGODB_URI = DEFAULT_MONGO_URI;
  }
}

// Auto-load when imported in non-test environments
if (process.env.NODE_ENV !== "test") {
  loadEnvFiles();
}
