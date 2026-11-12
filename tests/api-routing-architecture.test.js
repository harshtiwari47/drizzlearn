import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import serverApiHandler from "../server/api.js";
import vercelApiHandler from "../api/handler.js";
import rootHandler from "../api/[...path].js";

test("server/api.js, api/handler.js, and api/[...path].js all export matching API handler", async () => {
  assert.equal(typeof serverApiHandler, "function");
  assert.equal(typeof vercelApiHandler, "function");
  assert.equal(typeof rootHandler, "function");

  const runHealth = async (handler) => {
    let statusCode = 0;
    const headers = new Map();
    let responseBody = "";
    await handler(
      {
        url: "/api/health",
        method: "GET",
        headers: {},
      },
      {
        statusCode: 200,
        setHeader(k, v) { headers.set(k.toLowerCase(), v); },
        end(data = "") { responseBody = data; },
      }
    );
    return { statusCode, headers, body: JSON.parse(responseBody || "{}") };
  };

  const res1 = await runHealth(serverApiHandler);
  assert.equal(res1.body.ok, true);
  assert.equal(res1.body.service, "learnos-api");

  const res2 = await runHealth(vercelApiHandler);
  assert.equal(res2.body.ok, true);
  assert.equal(res2.body.service, "learnos-api");

  const res3 = await runHealth(rootHandler);
  assert.equal(res3.body.ok, true);
  assert.equal(res3.body.service, "learnos-api");
});

test("vite.config.js configures embedded middleware for /api/* on dev and preview servers", async () => {
  const config = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");
  assert.match(config, /configureServer\s*\(server\)/);
  assert.match(config, /configurePreviewServer\s*\(server\)/);
  assert.match(config, /server\.middlewares\.use/);
  assert.match(config, /import\("\.\/server\/api\.js"\)/);
});

test("vercel.json rewrites /api/* to api/handler.js for production execution", async () => {
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.ok(Array.isArray(vercel.rewrites), "vercel.json should contain rewrites");
  const apiRewrite = vercel.rewrites.find(r => r.source === "/api/(.*)" && r.destination === "/api/handler.js");
  assert.ok(apiRewrite, "vercel.json should rewrite /api/(.*) to /api/handler.js");
  assert.ok(vercel.functions["api/handler.js"], "vercel.json should declare api/handler.js function");
  assert.ok(vercel.functions["api/[...path].js"], "vercel.json should preserve api/[...path].js function");
});
