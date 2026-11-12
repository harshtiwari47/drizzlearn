import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import {
  DEFAULT_GEMINI_FALLBACK_MODELS,
  DEFAULT_NVIDIA_FALLBACK_MODELS,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_NVIDIA_MODEL,
  aiError,
  executeWithModelFailover,
  getCandidates,
  getModelPoolStatus,
  getProviders,
  recordFailure,
  recordSuccess,
  resetModelManager,
  selectCandidateQueue,
} from "../server/model-manager.js";
import { generatePlan, tutorReply } from "../server/ai.js";

const ENV_KEYS = [
  "NVIDIA_API_KEY",
  "AI_API_KEY",
  "NVIDIA_BASE_URL",
  "AI_BASE_URL",
  "NVIDIA_MODEL",
  "AI_MODEL",
  "NVIDIA_FALLBACK_MODELS",
  "NVIDIA_TIMEOUT_MS",
  "NVIDIA_REQUEST_BUDGET_MS",
  "GEMINI_TIMEOUT_MS",
  "AI_TIMEOUT_MS",
  "AI_ATTEMPT_TIMEOUT_MS",
  "AI_REQUEST_BUDGET_MS",
  "AI_TTFT_TIMEOUT_MS",
  "AI_CHUNK_IDLE_TIMEOUT_MS",
  "AI_BATCH_MODULES",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_BASE_URL",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODELS",
  "AI_PROVIDER",
  "NODE_ENV",
];

function withEnvironment(values, work) {
  const before = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = String(value);
  }
  return Promise.resolve()
    .then(work)
    .finally(() => {
      for (const key of ENV_KEYS) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    });
}

function installFetch(t, handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  t.after(() => {
    globalThis.fetch = original;
  });
}

function providerResponse(content, status = 200, headers = {}) {
  if (status !== 200) {
    return new Response("provider detail must not leak", { status, headers });
  }
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status, headers: { "content-type": "application/json", ...headers } }
  );
}

const goal = {
  topic: "SQL analytics",
  desired_outcome: "Write analytical SQL queries against realistic data.",
  current_level: "Beginner",
  purpose: "Prepare for an interview",
  weekly_minutes: 180,
  target_weeks: 6,
  target_date: null,
};

const source = {
  id: "note:owned-note",
  type: "note",
  title: "Learner's SQL notes",
  excerpt: "Joins combine related rows from tables.",
};

function validOutline() {
  return {
    title: "SQL analytics",
    summary: goal.desired_outcome,
    durationWeeks: 6,
    assumptions: ["Assumes basic computer use."],
    modules: [
      {
        position: 1,
        title: "Query foundations",
        objective: "Select and filter records.",
        rationale: "Build query basics.",
        prerequisites: [],
        sourceRefs: [source.id],
        lessons: [{ position: 1, title: "Filter a table", objective: "Use SELECT and WHERE.", prerequisites: [] }],
      },
      {
        position: 2,
        title: "Relational queries",
        objective: "Combine related records.",
        rationale: "Support realistic analysis.",
        prerequisites: [1],
        sourceRefs: [source.id],
        lessons: [{ position: 1, title: "Join two tables", objective: "Use JOIN on keys.", prerequisites: ["Filter a table"] }],
      },
      {
        position: 3,
        title: "Analysis project",
        objective: "Answer a question with a repeatable query.",
        rationale: "Demonstrate the outcome.",
        prerequisites: [2],
        sourceRefs: [source.id],
        lessons: [{ position: 1, title: "Build an analysis", objective: "Aggregate and validate totals.", prerequisites: ["Join two tables"] }],
      },
    ],
  };
}

function validLessonDraft() {
  return {
    lessons: [
      {
        modulePosition: 1,
        lessonPosition: 1,
        content: "Read a small table, select required columns, and filter rows using WHERE before aggregating.",
        workedExample: "Filter orders where status equals shipped and inspect row counts.",
        estimatedMinutes: 20,
        sourceRefs: [source.id],
      },
      {
        modulePosition: 2,
        lessonPosition: 1,
        content: "A join matches rows using related keys between tables. Verify key uniqueness to prevent duplication.",
        workedExample: "Join orders to customers on customer_id and verify row counts match.",
        estimatedMinutes: 25,
        sourceRefs: [source.id],
      },
      {
        modulePosition: 3,
        lessonPosition: 1,
        content: "Combine filters, joins, and GROUP BY to answer a concrete question and reconcile totals against raw tables.",
        workedExample: "Group paid orders by region and compare totals with base order rows.",
        estimatedMinutes: 30,
        sourceRefs: [source.id],
      },
    ],
  };
}

function validAssessments() {
  return {
    checkpoints: [
      {
        modulePosition: 1,
        lessonPosition: 1,
        question: "Which clause filters rows?",
        options: ["WHERE", "ORDER BY", "SELECT"],
        answerIndex: 0,
        explanation: "WHERE filters rows before projection or sorting.",
      },
      {
        modulePosition: 2,
        lessonPosition: 1,
        question: "What should an ON clause connect?",
        options: ["Related keys", "Two unrelated totals", "Column aliases"],
        answerIndex: 0,
        explanation: "ON specifies the relationship key between joined tables.",
      },
      {
        modulePosition: 3,
        lessonPosition: 1,
        question: "How do you validate an aggregation query?",
        options: ["Compare totals against source rows", "Drop all filters", "Rename columns"],
        answerIndex: 0,
        explanation: "Reconciling totals confirms no unintended row multiplication occurred.",
      },
    ],
  };
}

function responseForAgent(system) {
  if (system.includes("curriculum and prerequisite planner")) return validOutline();
  if (system.includes("lesson-content designer")) return validLessonDraft();
  if (system.includes("assessment designer")) return validAssessments();
  if (system.includes("Repair this Drizzlearn course proposal")) return validOutline();
  throw new Error("Unexpected AI role in test: " + system.slice(0, 80));
}

test.beforeEach(() => {
  resetModelManager();
});

test("multi-model candidate resolution respects AI_PROVIDER, prioritizes configured models, handles ladders vs custom URLs, and flags gemma", async () => {
  // 1. Default provider order (nvidia then gemini) with standard URLs expands full ladders
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      GEMINI_API_KEY: "AIza-test",
    },
    async () => {
      const providers = getProviders();
      assert.deepEqual(
        providers.map((p) => p.name),
        ["nvidia", "gemini"]
      );
      assert.equal(providers[0].model, DEFAULT_NVIDIA_MODEL);
      assert.equal(providers[1].model, DEFAULT_GEMINI_MODEL);
      assert.deepEqual(providers[0].models, [
        DEFAULT_NVIDIA_MODEL,
        ...DEFAULT_NVIDIA_FALLBACK_MODELS.filter((m) => m !== DEFAULT_NVIDIA_MODEL),
      ]);
      assert.deepEqual(providers[1].models, [...DEFAULT_GEMINI_FALLBACK_MODELS]);

      const candidates = getCandidates();
      assert.equal(candidates.length, providers[0].models.length + providers[1].models.length);
      assert.equal(candidates[0].name, "nvidia");
      assert.equal(candidates[0].isPrimary, true);
      assert.equal(candidates[0].supportsJsonFormat, true);

      const gemma = candidates.find((c) => c.model === "gemma-4-31b-it");
      assert.ok(gemma, "gemma-4-31b-it should appear in default Gemini ladder");
      assert.equal(gemma.supportsJsonFormat, false);

      const nonGemmaGemini = candidates.find((c) => c.model === "gemini-3.5-flash-lite");
      assert.equal(nonGemmaGemini.supportsJsonFormat, true);
    }
  );

  // 2. AI_PROVIDER=gemini puts gemini first and prioritizes configured primary models without duplication
  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gemini-custom-fast",
    },
    async () => {
      const providers = getProviders();
      assert.deepEqual(
        providers.map((p) => p.name),
        ["gemini", "nvidia"]
      );
      assert.equal(providers[0].models[0], "gemini-custom-fast");
      assert.equal(providers[0].models.length, DEFAULT_GEMINI_FALLBACK_MODELS.length + 1);
      assert.equal(providers[1].models[0], "nvidia/llama-3.3-nemotron-super-49b-v1.5");
      assert.equal(providers[1].models.filter((m) => m === "nvidia/llama-3.3-nemotron-super-49b-v1.5").length, 1);
    }
  );

  // 3. Custom mock URLs stay focused to the configured primary model unless explicit fallback list is provided
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_BASE_URL: "https://nvidia.test/v1",
      NVIDIA_MODEL: "custom/nv-model",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_BASE_URL: "https://gemini.test/v1beta/openai",
      GEMINI_MODEL: "gemma-4-31b-it",
    },
    async () => {
      const candidates = getCandidates();
      assert.deepEqual(
        candidates.map((c) => ({ name: c.name, model: c.model, supportsJsonFormat: c.supportsJsonFormat })),
        [
          { name: "nvidia", model: "custom/nv-model", supportsJsonFormat: true },
          { name: "gemini", model: "gemma-4-31b-it", supportsJsonFormat: false },
        ]
      );
    }
  );

  // 4. Explicit CSV fallback overrides custom URL contraction
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_BASE_URL: "https://nvidia.test/v1",
      NVIDIA_MODEL: "m1",
      NVIDIA_FALLBACK_MODELS: "m2, m3, m1",
    },
    async () => {
      const candidates = getCandidates();
      assert.deepEqual(
        candidates.map((c) => c.model),
        ["m1", "m2", "m3"]
      );
    }
  );
});

test("executeWithModelFailover continuously fails over across 429, 503, and stalled abort to 200", async () => {
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "model-1",
      NVIDIA_FALLBACK_MODELS: "model-2,model-3,model-4",
    },
    async () => {
      const candidates = getCandidates();
      assert.equal(candidates.length, 4);

      const attempts = [];
      const res = await executeWithModelFailover({
        stageName: "unit-failover",
        candidates,
        deadline: Date.now() + 5_000,
        perAttemptTimeoutMs: 40,
        executeFn: async (candidate, timeoutMs) => {
          attempts.push(candidate.model);
          if (candidate.model === "model-1") {
            throw aiError("AI_RATE_LIMIT", "Rate limited", { retryable: true, status: 429 });
          }
          if (candidate.model === "model-2") {
            throw aiError("AI_PROVIDER_ERROR", "High demand", { retryable: true, status: 503 });
          }
          if (candidate.model === "model-3") {
            await new Promise((_resolve, reject) => {
              const t = setTimeout(() => reject(aiError("AI_TIMEOUT", "Stalled")), timeoutMs);
              t.unref?.();
            });
          }
          if (candidate.model === "model-4") {
            return "recovered-payload";
          }
          throw new Error("Unexpected candidate");
        },
      });

      assert.equal(res.result, "recovered-payload");
      assert.equal(res.failoverCount, 3);
      assert.equal(res.model, "model-4");
      assert.deepEqual(res.attemptedModels, ["model-1", "model-2", "model-3", "model-4"]);
      assert.deepEqual(attempts, ["model-1", "model-2", "model-3", "model-4"]);
    }
  );
});

test("generatePlan & tutorReply continuously fail over across 429, 503, empty/404 and keep sticky healthy model", async (t) => {
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "model-1",
      NVIDIA_FALLBACK_MODELS: "model-2,model-3,model-4",
    },
    async () => {
      const seenModels = [];
      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        seenModels.push(body.model);
        if (body.model === "model-1") return providerResponse("", 429);
        if (body.model === "model-2") return providerResponse("", 503);
        if (body.model === "model-3") return providerResponse("   ", 200);
        if (body.model === "model-4") {
          return providerResponse(responseForAgent(body.messages[0].content));
        }
        throw new Error(`Unexpected model ${body.model}`);
      });

      const plan = await generatePlan(goal, { memory: [source] });
      assert.equal(plan.failoverCount, 3);
      assert.equal(plan.modelUsed, "model-4");
      assert.equal(plan.providerUsed, "nvidia");
      assert.equal(plan.modules.length, 3);
      // 4 calls for outline (m1->m2->m3->m4), then sticky model-4 for lesson_draft & assessment_draft (total 6)
      assert.deepEqual(seenModels, ["model-1", "model-2", "model-3", "model-4", "model-4", "model-4"]);
    }
  );

  resetModelManager();

  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gem-1",
      GEMINI_FALLBACK_MODELS: "gem-2,gem-3,gem-4",
    },
    async () => {
      const seenModels = [];
      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        seenModels.push(body.model);
        if (body.model === "gem-1") return providerResponse("", 429);
        if (body.model === "gem-2") return providerResponse("", 503);
        if (body.model === "gem-3") return providerResponse("", 404);
        if (body.model === "gem-4") {
          return providerResponse("Grounded tutor explanation [note:owned-note]");
        }
        throw new Error(`Unexpected model ${body.model}`);
      });

      const reply = await tutorReply({
        context: { title: "SQL joins" },
        mode: "Explain",
        prompt: "Explain joins",
        memory: [source],
      });

      assert.equal(reply.source, "gemini");
      assert.equal(reply.model, "gem-4");
      assert.equal(reply.failoverCount, 3);
      assert.match(reply.text, /Grounded tutor explanation/);
      assert.deepEqual(seenModels, ["gem-1", "gem-2", "gem-3", "gem-4"]);
    }
  );
});

test("gemma-4-31b-it fallback omits response_format and appends JSON instruction to system message", async (t) => {
  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gemini-3.5-flash-lite",
      GEMINI_FALLBACK_MODELS: "gemma-4-31b-it",
    },
    async () => {
      const requests = [];
      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        requests.push(body);
        if (body.model === "gemini-3.5-flash-lite") {
          return providerResponse("", 503);
        }
        if (body.model === "gemma-4-31b-it") {
          if (body.messages[0].content.includes("learning tutor")) {
            return providerResponse("Plain text tutor answer");
          }
          return providerResponse(responseForAgent(body.messages[0].content));
        }
        throw new Error(`Unexpected model ${body.model}`);
      });

      const plan = await generatePlan(goal, { memory: [source] });
      assert.equal(plan.modelUsed, "gemma-4-31b-it");
      assert.equal(plan.failoverCount, 1);

      const primaryReq = requests.find((r) => r.model === "gemini-3.5-flash-lite");
      assert.deepEqual(primaryReq.response_format, { type: "json_object" });

      const gemmaPlanReqs = requests.filter((r) => r.model === "gemma-4-31b-it");
      assert.equal(gemmaPlanReqs.length, 3);
      for (const req of gemmaPlanReqs) {
        assert.equal("response_format" in req, false, "gemma must omit response_format");
        assert.equal(req.messages[0].role, "system");
        assert.match(
          req.messages[0].content,
          /Return ONLY a valid raw JSON object without markdown code fences or extra commentary\.$/
        );
      }

      // When json=false (tutorReply), gemma should not receive the JSON system guard
      const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain" });
      assert.equal(reply.model, "gemma-4-31b-it");
      const tutorReq = requests[requests.length - 1];
      assert.equal("response_format" in tutorReq, false);
      assert.doesNotMatch(tutorReq.messages[0].content, /Return ONLY a valid raw JSON object/);
    }
  );
});

test("circuit breaker state machine: closed -> open -> half_open -> closed recovery", async (t) => {
  const realDateNow = Date.now;
  let fakeNow = 1_700_000_000_000;
  Date.now = () => fakeNow;
  t.after(() => {
    Date.now = realDateNow;
  });

  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "m1",
      NVIDIA_FALLBACK_MODELS: "m2,m3",
    },
    async () => {
      const candidates = getCandidates();
      const [c1, c2, c3] = candidates;

      // 1. Failure trips m1 to open with cooldownRemainingMs > 0
      recordFailure(c1, aiError("AI_RATE_LIMIT", "429", { retryable: true, status: 429 }), 25);
      let status = getModelPoolStatus();
      let m1State = status.models.find((m) => m.model === "m1");
      assert.equal(m1State.status, "open");
      assert.equal(m1State.consecutiveFailures, 1);
      assert.ok(m1State.cooldownRemainingMs > 0 && m1State.cooldownRemainingMs <= 15_000);

      // 2. Subsequent routing puts healthy closed models (m2, m3) ahead of open m1
      const ordered = selectCandidateQueue(candidates);
      assert.deepEqual(
        ordered.map((c) => c.model),
        ["m2", "m3", "m1"]
      );

      // Verify executeWithModelFailover automatically routes to m2 instead of open m1
      const called = [];
      const res = await executeWithModelFailover({
        stageName: "circuit-route",
        candidates,
        deadline: fakeNow + 30_000,
        executeFn: async (candidate) => {
          called.push(candidate.model);
          return `from-${candidate.model}`;
        },
      });
      assert.equal(res.model, "m2");
      assert.deepEqual(called, ["m2"]);

      // 3. Trip m2 with 404 (300s cooldown) and m3 with 503 (15s -> advance past m1's 15s cooldown but before m2's 300s)
      fakeNow += 1_000;
      recordFailure(c2, aiError("AI_PROVIDER_ERROR", "404", { retryable: true, status: 404 }), 10);
      recordFailure(c3, aiError("AI_PROVIDER_ERROR", "503", { retryable: true, status: 503 }), 10);

      // Advance clock so m1's 15s cooldown has elapsed while m2 (300s) and m3 (15s + 1000ms) are still open
      fakeNow += 14_500; // total elapsed since m1 failure = 15_500ms; since m3 failure = 14_500ms
      status = getModelPoolStatus();
      m1State = status.models.find((m) => m.model === "m1");
      const m2State = status.models.find((m) => m.model === "m2");
      const m3State = status.models.find((m) => m.model === "m3");
      assert.equal(m1State.status, "half_open");
      assert.equal(m1State.cooldownRemainingMs, 0);
      assert.equal(m2State.status, "open");
      assert.equal(m3State.status, "open");

      // half_open m1 should now be ordered ahead of open m3 and m2
      const halfOpenQueue = selectCandidateQueue(candidates);
      assert.equal(halfOpenQueue[0].model, "m1");

      // 4. Successful probe on half_open m1 recovers it back to closed
      const recovery = await executeWithModelFailover({
        stageName: "half-open-probe",
        candidates,
        deadline: fakeNow + 30_000,
        executeFn: async (candidate) => `recovered-${candidate.model}`,
      });
      assert.equal(recovery.model, "m1");

      status = getModelPoolStatus();
      m1State = status.models.find((m) => m.model === "m1");
      assert.equal(m1State.status, "closed");
      assert.equal(m1State.consecutiveFailures, 0);
      assert.equal(m1State.cooldownRemainingMs, 0);
    }
  );
});

test("auth error (401/403) immediately skips remaining models of failed provider and switches to next provider or throws AI_PROVIDER_AUTH", async (t) => {
  // 1. Cross-provider fast switch on 401: nvidia (4 models) -> skip remaining 3 -> gemini 200
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-bad-secret",
      GEMINI_API_KEY: "AIza-good-secret",
    },
    async () => {
      const attempted = [];
      installFetch(t, async (url, options) => {
        const body = JSON.parse(options.body);
        attempted.push({ url, model: body.model });
        if (url.includes("nvidia.com")) {
          return new Response("invalid nvapi-bad-secret", { status: 401 });
        }
        return providerResponse("Gemini rescued after 401");
      });

      const reply = await tutorReply({
        context: { title: "Auth switch" },
        mode: "Explain",
        prompt: "Help",
      });

      assert.equal(reply.source, "gemini");
      assert.equal(reply.model, DEFAULT_GEMINI_MODEL);
      assert.equal(reply.failoverCount, 1);
      assert.equal(attempted.length, 2, "must skip remaining 3 NVIDIA models immediately");
      assert.ok(attempted[0].url.includes("nvidia.com"));
      assert.ok(attempted[1].url.includes("googleapis.com"));
    }
  );

  resetModelManager();

  // 2. Single provider configured with 9 models: 403 throws AI_PROVIDER_AUTH immediately after 1 call
  await withEnvironment(
    {
      GEMINI_API_KEY: "AIza-revoked-secret",
    },
    async () => {
      let calls = 0;
      installFetch(t, async () => {
        calls += 1;
        return new Response("forbidden AIza-revoked-secret", { status: 403 });
      });

      const candidates = getCandidates();
      assert.equal(candidates.length, DEFAULT_GEMINI_FALLBACK_MODELS.length);

      await assert.rejects(
        tutorReply({ context: { title: "Lesson" }, mode: "Explain", prompt: "Help" }),
        (error) => {
          assert.equal(error.code, "AI_PROVIDER_AUTH");
          assert.doesNotMatch(error.message, /AIza-revoked-secret|forbidden/);
          return true;
        }
      );
      assert.equal(calls, 1, "403 must throw AI_PROVIDER_AUTH immediately without trying 8 fallback models");
    }
  );
});

test("shared deadline enforcement stops switching immediately when budget is exhausted", async () => {
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "m1",
      NVIDIA_FALLBACK_MODELS: "m2,m3,m4",
    },
    async () => {
      const candidates = getCandidates();

      // Case A: Already expired deadline fails immediately with 0 attempts
      let calls = 0;
      await assert.rejects(
        executeWithModelFailover({
          stageName: "expired-deadline",
          candidates,
          deadline: Date.now() - 5,
          executeFn: async () => {
            calls += 1;
            return "never";
          },
        }),
        (err) => err.code === "AI_TIMEOUT"
      );
      assert.equal(calls, 0);

      resetModelManager();

      // Case B: Attempt #1 stalls until deadline is exhausted -> throws AI_TIMEOUT without touching m2..m4
      const attempted = [];
      const started = Date.now();
      await assert.rejects(
        executeWithModelFailover({
          stageName: "exhausted-midflight",
          candidates,
          deadline: Date.now() + 55,
          perAttemptTimeoutMs: 55,
          executeFn: async (candidate, timeoutMs) => {
            attempted.push(candidate.model);
            await new Promise((_resolve, reject) => {
              const t = setTimeout(() => reject(aiError("AI_TIMEOUT", "Timed out")), timeoutMs + 10);
              t.unref?.();
            });
          },
        }),
        (err) => err.code === "AI_TIMEOUT"
      );
      assert.ok(Date.now() - started < 1_000);
      assert.deepEqual(attempted, ["m1"], "must not switch to m2..m4 once deadline budget is exhausted");

      resetModelManager();

      // Case C: Attempt #1 throws retryable 429 after budget has <=25ms remaining -> stops switching immediately
      const realNow = Date.now;
      let fakeNow = realNow();
      Date.now = () => fakeNow;
      try {
        const attemptedOnRateLimit = [];
        await assert.rejects(
          executeWithModelFailover({
            stageName: "exhausted-after-429",
            candidates,
            deadline: fakeNow + 50,
            perAttemptTimeoutMs: 100,
            executeFn: async (candidate) => {
              attemptedOnRateLimit.push(candidate.model);
              fakeNow += 35; // 15ms remaining <= 25ms cutoff
              throw aiError("AI_RATE_LIMIT", "Rate limited", { retryable: true, status: 429 });
            },
          }),
          (err) => err.code === "AI_RATE_LIMIT"
        );
        assert.deepEqual(attemptedOnRateLimit, ["m1"], "must not switch when <= 25ms remains in deadline");
      } finally {
        Date.now = realNow;
      }
    }
  );
});

test("sanitized telemetry (getModelPoolStatus & GET /api/ai/status) exposes health without leaking secrets", async (t) => {
  const secretNv = "nvapi-very-secret-nvidia-key-999";
  const secretGem = "AIzaSyVerySecretGeminiKey888";
  const secretGoogle = "AQ.VerySecretGoogleToken777";

  await withEnvironment(
    {
      NVIDIA_API_KEY: secretNv,
      GEMINI_API_KEY: secretGem,
      GOOGLE_API_KEY: secretGoogle,
      NVIDIA_MODEL: "nv-primary",
      NVIDIA_FALLBACK_MODELS: "nv-backup",
      GEMINI_MODEL: "gem-primary",
      GEMINI_FALLBACK_MODELS: "gemma-4-31b-it",
      NODE_ENV: "test",
    },
    async () => {
      const candidates = getCandidates();
      await executeWithModelFailover({
        stageName: "telemetry-check",
        candidates,
        deadline: Date.now() + 5_000,
        executeFn: async (candidate) => {
          if (candidate.model === "nv-primary") {
            throw aiError("AI_RATE_LIMIT", "429", { retryable: true, status: 429 });
          }
          return "ok";
        },
      });

      const status = getModelPoolStatus();
      assert.equal(status.configured, true);
      assert.deepEqual(status.summary.configuredProviders, ["nvidia", "gemini"]);
      assert.equal(status.summary.totalModels, 4);
      assert.equal(status.summary.coolingDownModels, 1);
      assert.equal(status.summary.healthyModels, 3);
      assert.equal(status.summary.totalSwitches, 1);
      assert.equal(status.models.length, 4);

      for (const m of status.models) {
        assert.ok(["nvidia", "gemini"].includes(m.provider));
        assert.ok(["primary", "fallback"].includes(m.tier));
        assert.ok(["closed", "open", "half_open"].includes(m.status));
        assert.ok("avgLatencyMs" in m);
        assert.equal("apiKey" in m, false);
      }

      const serialized = JSON.stringify(status);
      for (const forbidden of ["nvapi-", "AIza", "AQ.", secretNv, secretGem, secretGoogle, "apiKey"]) {
        assert.equal(serialized.includes(forbidden), false, `status leaked forbidden token: ${forbidden}`);
      }
    }
  );

  // Also test GET /api/ai/status via api/[...path].js (both 401 unauth & 200 auth)
  let vite;
  const mockState = { user: null };
  globalThis.__drizzlearnMmStatusTest = mockState;

  const mockPlugin = {
    name: "drizzlearn-mm-status-test",
    enforce: "pre",
    resolveId(sourceImport, importer) {
      if (!importer?.includes("api/[...path].js")) return null;
      if (sourceImport === "../server/db.js") return "\0mm-test:db";
      if (sourceImport === "../server/auth.js") return "\0mm-test:auth";
      if (sourceImport === "../server/email.js") return "\0mm-test:email";
      if (sourceImport === "../server/plan-service.js") return "\0mm-test:plans";
      if (sourceImport === "../server/materials-generator.js") return "\0mm-test:materials";
      return null;
    },
    load(id) {
      if (!id.startsWith("\0mm-test:")) return null;
      const name = id.slice("\0mm-test:".length);
      if (name === "db") {
        return `
          export async function query() { return { rows: [] }; }
          export async function withTransaction(work) { return work({ query }); }
        `;
      }
      if (name === "auth") {
        return `
          export async function requireUser(_req, res) {
            const u = globalThis.__drizzlearnMmStatusTest.user;
            if (!u) {
              res.statusCode = 401;
              res.setHeader("Content-Type", "application/json");
              res.setHeader("Cache-Control", "no-store");
              res.end(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }));
              return null;
            }
            return u;
          }
          export function sessionUserId() { return globalThis.__drizzlearnMmStatusTest.user?.id || null; }
          export function createSessionCookie() { return "learnos_session=test; Path=/"; }
          export function clearSessionCookie() { return "learnos_session=; Max-Age=0"; }
        `;
      }
      if (name === "email") return `export async function sendEmail() { return { id: "e1" }; }`;
      if (name === "plans") return `export async function generateCourseProposal() {} export async function improveCourseProposal() {} export async function approveCourse() {}`;
      if (name === "materials") return `export async function getCourseMaterialsStatus() { return { status: "ready" }; }`;
      return null;
    },
  };

  try {
    vite = await createServer({
      configFile: false,
      logLevel: "silent",
      plugins: [mockPlugin],
      server: { middlewareMode: true },
      appType: "custom",
    });
    const { default: handler } = await vite.ssrLoadModule("/api/[...path].js");

    const callStatus = async () => {
      const headers = new Map();
      const res = {
        statusCode: 200,
        setHeader(k, v) {
          headers.set(k.toLowerCase(), v);
        },
        end(body = "") {
          this.body = body;
        },
      };
      await handler({ url: "/api/ai/status", method: "GET", headers: {} }, res);
      return { status: res.statusCode, raw: res.body, json: res.body ? JSON.parse(res.body) : null };
    };

    const callTutor = async () => {
      const res = {
        statusCode: 200,
        setHeader() {},
        end(body = "") {
          this.body = body;
        },
      };
      await handler(
        { url: "/api/tutor", method: "POST", headers: {}, body: { mode: "Explain", prompt: "Explain closures" } },
        res
      );
      return { status: res.statusCode, json: res.body ? JSON.parse(res.body) : null };
    };

    await withEnvironment(
      {
        NVIDIA_API_KEY: secretNv,
        GEMINI_API_KEY: secretGem,
        NVIDIA_MODEL: "nv-1",
        NVIDIA_FALLBACK_MODELS: "nv-2",
        GEMINI_MODEL: "gem-1",
        NODE_ENV: "test",
      },
      async () => {
        // Unauthenticated -> 401
        mockState.user = null;
        const unauth = await callStatus();
        assert.equal(unauth.status, 401);
        assert.equal(unauth.json.error.code, "UNAUTHENTICATED");

        // Authenticated -> trigger a failover via /api/tutor, then verify /api/ai/status
        mockState.user = {
          id: "11111111-1111-4111-8111-111111111111",
          email: "learner@example.com",
          full_name: "Learner",
          timezone: "UTC",
          preferred_study_days: [1, 3, 5],
          session_minutes: 45,
          weekly_minutes: 180,
          notification_preferences: {},
        };

        installFetch(t, async (_url, options) => {
          const body = JSON.parse(options.body);
          if (body.model === "nv-1") return providerResponse("", 429);
          return providerResponse("Tutor explanation");
        });

        const tutorRes = await callTutor();
        assert.equal(tutorRes.status, 200);
        assert.equal(tutorRes.json.model, "nv-2");
        assert.equal(tutorRes.json.failoverCount, 1);

        const authStatus = await callStatus();
        assert.equal(authStatus.status, 200);
        assert.deepEqual(authStatus.json.summary.configuredProviders, ["nvidia", "gemini"]);
        assert.equal(authStatus.json.summary.totalSwitches, 1);
        assert.equal(authStatus.json.summary.coolingDownModels, 1);
        assert.ok(Array.isArray(authStatus.json.models));
        for (const forbidden of ["nvapi-", "AIza", "AQ.", secretNv, secretGem, "apiKey"]) {
          assert.equal(authStatus.raw.includes(forbidden), false, `API response leaked ${forbidden}`);
        }
      }
    );
  } finally {
    await vite?.close();
    delete globalThis.__drizzlearnMmStatusTest;
  }
});

test("decouples GEMINI_TIMEOUT_MS vs NVIDIA_TIMEOUT_MS per candidate and honors resolveAttemptTimeoutMs bounds", async () => {
  // 1. Default per-provider timeouts: NVIDIA 18s, Gemini 35s
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      GEMINI_API_KEY: "AIza-test",
    },
    async () => {
      const candidates = getCandidates();
      const nv = candidates.find((c) => c.name === "nvidia");
      const gem = candidates.find((c) => c.name === "gemini");
      assert.equal(nv.timeoutMs, 18_000);
      assert.equal(gem.timeoutMs, 35_000);

      // Legacy 22_000 override does not shrink Gemini's 35s or inflate NVIDIA's 18s
      const seenTimeouts = {};
      await executeWithModelFailover({
        stageName: "timeout-resolution-legacy",
        candidates: [nv, gem],
        deadline: Date.now() + 90_000,
        perAttemptTimeoutMs: 22_000,
        executeFn: async (candidate, timeoutMs) => {
          seenTimeouts[candidate.name] = timeoutMs;
          if (candidate.name === "nvidia") {
            throw aiError("AI_RATE_LIMIT", "429", { retryable: true, status: 429 });
          }
          return "ok";
        },
      });
      assert.equal(seenTimeouts.nvidia, 18_000);
      assert.equal(seenTimeouts.gemini, 35_000);
    }
  );

  resetModelManager();

  // 2. Explicit GEMINI_TIMEOUT_MS & NVIDIA_TIMEOUT_MS override defaults independently and clamp [1000, 120000]
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_TIMEOUT_MS: "500",
      NVIDIA_MODEL: "nv-1",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_TIMEOUT_MS: "200000",
      GEMINI_MODEL: "gemini-3.5-flash",
    },
    async () => {
      const candidates = getCandidates();
      const nv = candidates.find((c) => c.name === "nvidia");
      const gem = candidates.find((c) => c.name === "gemini");
      assert.equal(nv.timeoutMs, 1_000, "minimum timeout clamps to 1000ms");
      assert.equal(gem.timeoutMs, 120_000, "maximum timeout clamps to 120000ms");
    }
  );

  resetModelManager();

  // 3. Explicit perAttemptTimeoutMs caps larger candidate timeout but never inflates smaller candidate timeout
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_TIMEOUT_MS: "9000",
      NVIDIA_MODEL: "nv-1",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_TIMEOUT_MS: "42000",
      GEMINI_MODEL: "gemini-3.5-flash",
    },
    async () => {
      const candidates = getCandidates();
      const nv = candidates.find((c) => c.name === "nvidia");
      const gem = candidates.find((c) => c.name === "gemini");
      assert.equal(nv.timeoutMs, 9_000);
      assert.equal(gem.timeoutMs, 42_000);

      const seenTimeouts = {};
      await executeWithModelFailover({
        stageName: "timeout-resolution-explicit",
        candidates: [nv, gem],
        deadline: Date.now() + 90_000,
        perAttemptTimeoutMs: 25_000,
        executeFn: async (candidate, timeoutMs) => {
          seenTimeouts[candidate.name] = timeoutMs;
          if (candidate.name === "nvidia") {
            throw aiError("AI_PROVIDER_ERROR", "503", { retryable: true, status: 503 });
          }
          return "ok";
        },
      });
      assert.equal(seenTimeouts.nvidia, 9_000, "25s override must not exceed NVIDIA's 9s timeout");
      assert.equal(seenTimeouts.gemini, 25_000, "25s override caps Gemini's 42s timeout");
    }
  );
});

test("sets supportsReasoningEffort on live Gemini thinking models while excluding flash-lite, gemma, and custom URLs", async () => {
  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-test",
      NVIDIA_API_KEY: "nvapi-test",
    },
    async () => {
      const candidates = getCandidates();
      const byModel = new Map(candidates.map((c) => [c.model, c]));

      for (const thinkingModel of [
        "gemini-3.5-flash",
        "gemini-3.6-flash",
        "gemini-3.7-flash",
        "gemini-3.8-flash",
        "gemini-3-flash-preview",
        "gemini-flash-latest",
      ]) {
        const c = byModel.get(thinkingModel);
        assert.ok(c, `missing default model ${thinkingModel}`);
        assert.equal(c.supportsReasoningEffort, true, `${thinkingModel} should support reasoning_effort`);
        assert.equal(c.defaultReasoningEffort, "low");
        assert.equal(c.isCustomUrl, false);
      }

      for (const nonThinkingModel of ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemma-4-31b-it"]) {
        const c = byModel.get(nonThinkingModel);
        assert.ok(c, `missing default model ${nonThinkingModel}`);
        assert.equal(c.supportsReasoningEffort, false, `${nonThinkingModel} must omit reasoning_effort`);
        assert.equal(c.defaultReasoningEffort, null);
      }

      const nv = candidates.find((c) => c.name === "nvidia");
      assert.equal(nv.supportsReasoningEffort, false);
      assert.equal(nv.defaultReasoningEffort, null);
    }
  );

  // Custom Gemini URL disables reasoning_effort even for thinking model names
  await withEnvironment(
    {
      GEMINI_API_KEY: "AIza-test",
      GEMINI_BASE_URL: "https://custom-proxy.test/v1",
      GEMINI_MODEL: "gemini-3.5-flash",
    },
    async () => {
      const [c] = getCandidates();
      assert.equal(c.isCustomUrl, true);
      assert.equal(c.supportsReasoningEffort, false);
      assert.equal(c.defaultReasoningEffort, null);
    }
  );
});

test("uses gemini-3.5-flash-lite as default Gemini primary, preserves fallback ladder, and promotes fast fallbacks via EWMA latency", async () => {
  assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
  assert.deepEqual(DEFAULT_GEMINI_FALLBACK_MODELS, [
    "gemini-3.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-3.5-flash",
    "gemini-flash-lite-latest",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest",
    "gemma-4-31b-it",
  ]);

  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_FALLBACK_MODELS: "gemini-flash-lite-latest,gemini-3.5-flash-lite,gemini-3.6-flash",
    },
    async () => {
      const candidates = getCandidates();
      const [primary, fastLite, secondLite, unmeasured] = candidates;

      // 1. Healthy fast primary stays ahead of even faster fallback
      recordSuccess(primary, 2_000, 200); // ewma = 2000 <= 12000, failures = 0
      recordSuccess(fastLite, 400, 200); // ewma = 400
      assert.deepEqual(
        selectCandidateQueue(candidates).map((c) => c.model),
        ["gemini-3.5-flash", "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.6-flash"]
      );

      // 2. Verify EWMA smoothing formula (0.3 * new + 0.7 * prev) and adaptive promotion when primary exceeds 12_000ms
      recordSuccess(primary, 40_000, 200); // 0.3 * 40000 + 0.7 * 2000 = 13400 > 12000
      const poolStatus = getModelPoolStatus();
      const primaryStatus = poolStatus.models.find((m) => m.model === "gemini-3.5-flash");
      assert.equal(primaryStatus.ewmaLatencyMs, 13_400);
      assert.equal(primaryStatus.avgLatencyMs, 13_400);

      recordSuccess(secondLite, 900, 200);
      const promotedOrder = selectCandidateQueue(candidates);
      assert.deepEqual(
        promotedOrder.map((c) => c.model),
        ["gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash"],
        "healthy measured fallbacks should be promoted ahead of slow primary and unmeasured models"
      );

      // 3. Explicit preferredKey stickiness overrides EWMA promotion when requested
      const stickyOrder = selectCandidateQueue(candidates, {
        preferredKey: `${unmeasured.name}:${unmeasured.baseUrl}:${unmeasured.model}`,
      });
      assert.equal(stickyOrder[0].model, "gemini-3.6-flash");
    }
  );

  resetModelManager();

  // 4. Primary with prior failures (even after recovering back to closed) yields to fast healthy fallback
  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_FALLBACK_MODELS: "gemini-flash-lite-latest,gemini-3.6-flash",
    },
    async () => {
      const candidates = getCandidates();
      const [primary, fastLite] = candidates;
      recordFailure(primary, aiError("AI_TIMEOUT", "slow"), 15_000);
      recordSuccess(primary, 3_000, 200); // closed again, but failures === 1
      recordSuccess(fastLite, 650, 200);
      assert.deepEqual(
        selectCandidateQueue(candidates).map((c) => c.model),
        ["gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.6-flash"]
      );
    }
  );
});
