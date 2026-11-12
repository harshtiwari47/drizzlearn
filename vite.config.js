import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { DEFAULT_MONGO_URI } from "./server/mongo.js";

// Load environment variables from .env into process.env for embedded API middleware
const loadedEnv = loadEnv(process.env.NODE_ENV || "development", process.cwd(), "");
for (const [key, value] of Object.entries(loadedEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}
if (!process.env.DATABASE_URL && !process.env.MONGODB_URI) {
  process.env.DATABASE_URL = DEFAULT_MONGO_URI;
  process.env.MONGODB_URI = DEFAULT_MONGO_URI;
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "drizzlearn-super-secret-session-key-32-chars-long-2026";
}

function apiMiddleware() {
  return {
    name: "api-middleware",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && (req.url.startsWith("/api/") || req.url === "/api" || req.url.startsWith("/api?"))) {
          try {
            const { default: handler } = await import("./server/api.js");
            await handler(req, res);
          } catch (error) {
            console.error("Local API middleware error:", error);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: { code: "SERVER_ERROR", message: error.message } }));
            }
          }
          return;
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && (req.url.startsWith("/api/") || req.url === "/api" || req.url.startsWith("/api?"))) {
          try {
            const { default: handler } = await import("./server/api.js");
            await handler(req, res);
          } catch (error) {
            console.error("Preview API middleware error:", error);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: { code: "SERVER_ERROR", message: error.message } }));
            }
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    apiMiddleware(),
  ],
  server: {
    strictPort: true,
  },
});
