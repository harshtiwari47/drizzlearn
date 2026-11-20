import { logger } from "./logger.js";

export const DEFAULT_NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
export const DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

export const DEFAULT_GROQ_FALLBACK_MODELS = Object.freeze([
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
]);

export const DEFAULT_GEMINI_FALLBACK_MODELS = Object.freeze([
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

const GEMINI_THINKING_MODELS = new Set([
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3-flash-preview",
  "gemini-flash-latest",
  "gemini-3.1-pro-preview",
  "gemini-pro-latest",
]);

export const DEFAULT_NVIDIA_FALLBACK_MODELS = Object.freeze([
  "nvidia/nemotron-3.5-bolt-e4b",
  "nvidia/nemotron-3.5-lightning-30b-a3b",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "meta/llama-3.3-70b-instruct",
]);

const BASE_COOLDOWN_MS = 15_000;
const NOT_FOUND_COOLDOWN_MS = 300_000;
const SINGLE_CANDIDATE_MAX_ATTEMPTS = 2;
const DEFAULT_RETRY_DELAY_MS = 180;

const healthRegistry = new Map();
let totalSwitches = 0;

/**
 * Create a typed AI service error without leaking provider secrets.
 */
export function aiError(code, message, { retryable = false, status } = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  if (status) error.status = status;
  return error;
}

/**
 * Human-readable provider label for user-facing error messages.
 */
export function providerDisplayName(name) {
  if (name === "groq") return "Groq";
  return name === "gemini" ? "Gemini" : "NVIDIA";
}

/**
 * Standard timeout error preserving existing error contract.
 */
export function deadlineError(providerLabel = "NVIDIA") {
  return aiError(
    "AI_TIMEOUT",
    `${providerLabel} exceeded the request time budget. Retry in a moment; no partial course was saved and any existing proposal is unchanged.`,
    { retryable: false }
  );
}

export function candidateKey(candidate) {
  return `${candidate.name}:${candidate.baseUrl}:${candidate.model}`;
}

function modelLabel(candidate) {
  return candidate.model.startsWith(`${candidate.name}/`)
    ? candidate.model
    : `${candidate.name}:${candidate.model}`;
}

function parseCsvModels(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

function dedupeModels(models) {
  const seen = new Set();
  const out = [];
  for (const model of models) {
    if (!model || seen.has(model)) continue;
    seen.add(model);
    out.push(model);
  }
  return out;
}

function isCustomBaseUrl(providerName, baseUrl) {
  if (providerName === "groq") {
    return !baseUrl.includes("groq.com");
  }
  if (providerName === "gemini") {
    return !baseUrl.includes("googleapis.com");
  }
  return !baseUrl.includes("nvidia.com");
}

function providerTimeoutMs(providerName) {
  if (providerName === "groq") {
    const raw = Number(process.env.GROQ_TIMEOUT_MS) || Number(process.env.AI_TIMEOUT_MS) || 30_000;
    return Math.max(1_000, Math.min(raw, 120_000));
  }
  const raw =
    providerName === "gemini"
      ? Number(process.env.GEMINI_TIMEOUT_MS) || Number(process.env.AI_TIMEOUT_MS) || 35_000
      : Number(process.env.NVIDIA_TIMEOUT_MS) || Number(process.env.AI_TIMEOUT_MS) || 18_000;
  return Math.max(1_000, Math.min(raw, 120_000));
}

function buildProviderModels(providerName, baseUrl, configuredPrimary, defaultPrimary, fallbackEnvName, defaultLadder) {
  const primary = configuredPrimary || defaultPrimary;
  const explicitFallbacks = parseCsvModels(process.env[fallbackEnvName]);
  if (explicitFallbacks.length > 0) {
    return dedupeModels([primary, ...explicitFallbacks]);
  }
  if (isCustomBaseUrl(providerName, baseUrl)) {
    return [primary];
  }
  return dedupeModels([primary, ...defaultLadder]);
}

/**
 * Return configured AI providers in preferred order (respecting AI_PROVIDER).
 */
export function getProviders() {
  const providers = [];
  const preferred = (process.env.AI_PROVIDER || "").toLowerCase();

  const groqKey = process.env.GROQ_API_KEY;
  const groqBaseUrl = (process.env.GROQ_BASE_URL || DEFAULT_GROQ_BASE_URL).replace(/\/$/, "");
  const groqPrimary = process.env.GROQ_MODEL || "";
  const groqConfig = groqKey
    ? {
        name: "groq",
        apiKey: groqKey,
        baseUrl: groqBaseUrl,
        model: groqPrimary || DEFAULT_GROQ_MODEL,
        models: buildProviderModels(
          "groq",
          groqBaseUrl,
          groqPrimary,
          DEFAULT_GROQ_MODEL,
          "GROQ_FALLBACK_MODELS",
          DEFAULT_GROQ_FALLBACK_MODELS
        ),
      }
    : null;

  const nvidiaKey = process.env.NVIDIA_API_KEY || process.env.AI_API_KEY;
  const nvidiaBaseUrl = (process.env.NVIDIA_BASE_URL || process.env.AI_BASE_URL || DEFAULT_NVIDIA_BASE_URL).replace(/\/$/, "");
  const nvidiaPrimary = process.env.NVIDIA_MODEL || process.env.AI_MODEL || "";
  const nvidiaConfig = nvidiaKey
    ? {
        name: "nvidia",
        apiKey: nvidiaKey,
        baseUrl: nvidiaBaseUrl,
        model: nvidiaPrimary || DEFAULT_NVIDIA_MODEL,
        models: buildProviderModels(
          "nvidia",
          nvidiaBaseUrl,
          nvidiaPrimary,
          DEFAULT_NVIDIA_MODEL,
          "NVIDIA_FALLBACK_MODELS",
          DEFAULT_NVIDIA_FALLBACK_MODELS
        ),
      }
    : null;

  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const geminiBaseUrl = (process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL).replace(/\/$/, "");
  const geminiPrimary = process.env.GEMINI_MODEL || "";
  const geminiConfig = geminiKey
    ? {
        name: "gemini",
        apiKey: geminiKey,
        baseUrl: geminiBaseUrl,
        model: geminiPrimary || DEFAULT_GEMINI_MODEL,
        models: buildProviderModels(
          "gemini",
          geminiBaseUrl,
          geminiPrimary,
          DEFAULT_GEMINI_MODEL,
          "GEMINI_FALLBACK_MODELS",
          DEFAULT_GEMINI_FALLBACK_MODELS
        ),
      }
    : null;

  if (preferred === "groq" || (!preferred && groqConfig)) {
    if (groqConfig) providers.push(groqConfig);
    if (geminiConfig) providers.push(geminiConfig);
    if (nvidiaConfig) providers.push(nvidiaConfig);
  } else if (preferred === "gemini") {
    if (geminiConfig) providers.push(geminiConfig);
    if (groqConfig) providers.push(groqConfig);
    if (nvidiaConfig) providers.push(nvidiaConfig);
  } else {
    if (nvidiaConfig) providers.push(nvidiaConfig);
    if (groqConfig) providers.push(groqConfig);
    if (geminiConfig) providers.push(geminiConfig);
  }
  return providers;
}

/**
 * Build flattened, prioritized multi-model candidate list across all configured providers.
 */
export function getCandidates() {
  const providers = getProviders();
  const candidates = [];
  let priority = 0;

  for (const provider of providers) {
    const modelList = Array.isArray(provider.models) && provider.models.length ? provider.models : [provider.model];
    const isCustomUrl = isCustomBaseUrl(provider.name, provider.baseUrl);
    const timeoutMs = providerTimeoutMs(provider.name);

    modelList.forEach((model, index) => {
      const lower = model.toLowerCase();
      const supportsReasoningEffort =
        (provider.name === "gemini" &&
          !isCustomUrl &&
          !lower.includes("flash-lite") &&
          !lower.includes("gemma") &&
          GEMINI_THINKING_MODELS.has(lower)) ||
        (provider.name === "groq" && lower.includes("gpt-oss"));

      candidates.push({
        name: provider.name,
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        model,
        priority: priority++,
        providerIndex: index,
        isPrimary: index === 0,
        isCustomUrl,
        timeoutMs,
        supportsJsonFormat: !lower.includes("gemma"),
        supportsReasoningEffort,
        defaultReasoningEffort: supportsReasoningEffort ? "low" : null,
      });
    });
  }

  return candidates;
}

function getOrCreateHealth(candidate) {
  const key = candidateKey(candidate);
  let state = healthRegistry.get(key);
  if (!state) {
    state = {
      status: "closed",
      consecutiveFailures: 0,
      cooldownUntil: 0,
      attempts: 0,
      successes: 0,
      failures: 0,
      rateLimits: 0,
      timeouts: 0,
      highDemandErrors: 0,
      ewmaLatencyMs: null,
      lastLatencyMs: null,
      lastStatus: null,
      lastErrorCode: null,
      lastUsedAt: null,
    };
    healthRegistry.set(key, state);
  }
  return state;
}

function effectiveStatus(state, now = Date.now()) {
  if (state.status === "open" && now >= state.cooldownUntil) {
    return "half_open";
  }
  return state.status;
}

export function recordSuccess(candidate, latencyMs = 0, status = 200) {
  const state = getOrCreateHealth(candidate);
  const now = Date.now();
  const safeLatency = Math.max(0, Math.round(Number(latencyMs) || 0));

  state.attempts += 1;
  state.successes += 1;
  state.consecutiveFailures = 0;
  state.status = "closed";
  state.cooldownUntil = 0;
  state.lastLatencyMs = safeLatency;
  state.ewmaLatencyMs =
    state.ewmaLatencyMs === null
      ? safeLatency
      : Math.round(0.3 * safeLatency + 0.7 * state.ewmaLatencyMs);
  state.lastStatus = status;
  state.lastErrorCode = null;
  state.lastUsedAt = new Date(now).toISOString();
}

export function recordFailure(candidate, error, latencyMs = 0) {
  const state = getOrCreateHealth(candidate);
  const now = Date.now();
  const safeLatency = Math.max(0, Math.round(Number(latencyMs) || 0));
  const status = error?.status || null;
  const code = error?.code || "AI_PROVIDER_ERROR";

  state.attempts += 1;
  state.failures += 1;
  state.consecutiveFailures += 1;
  if (code === "AI_RATE_LIMIT" || status === 429) {
    state.rateLimits += 1;
  }
  if (code === "AI_TIMEOUT") {
    state.timeouts += 1;
  }
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    state.highDemandErrors += 1;
  }

  const backoffMs =
    status === 404
      ? NOT_FOUND_COOLDOWN_MS
      : BASE_COOLDOWN_MS * Math.min(8, 2 ** Math.max(0, state.consecutiveFailures - 1));

  state.status = "open";
  state.cooldownUntil = now + backoffMs;
  state.lastLatencyMs = safeLatency;
  state.lastStatus = status;
  state.lastErrorCode = code;
  state.lastUsedAt = new Date(now).toISOString();
}

/**
 * Order candidates dynamically:
 * 1. Healthy closed models (sticky preferred first, then primary/provider order, with latency sorting for measured secondaries)
 * 2. Half-open models whose cooldown has elapsed
 * 3. Cooling-down open models sorted by earliest cooldownUntil as last-resort probes
 */
export function selectCandidateQueue(candidates, { preferredKey = null, excludedProviders = new Set() } = {}) {
  const now = Date.now();
  const eligible = candidates.filter((c) => !excludedProviders.has(c.name));
  const closed = [];
  const halfOpen = [];
  const open = [];

  for (const candidate of eligible) {
    const state = getOrCreateHealth(candidate);
    const status = effectiveStatus(state, now);
    const entry = { candidate, state, key: candidateKey(candidate) };
    if (status === "closed") closed.push(entry);
    else if (status === "half_open") halfOpen.push(entry);
    else open.push(entry);
  }

  const adaptiveProviders = new Set();
  const byProvider = new Map();
  for (const entry of [...closed, ...halfOpen, ...open]) {
    const list = byProvider.get(entry.candidate.name) || [];
    list.push(entry);
    byProvider.set(entry.candidate.name, list);
  }
  for (const [providerName, entries] of byProvider.entries()) {
    const primaryEntry = entries.find((e) => e.candidate.isPrimary);
    const hasHealthyMeasured = entries.some(
      (e) =>
        effectiveStatus(e.state, now) === "closed" &&
        e.state.ewmaLatencyMs !== null &&
        e.state.consecutiveFailures === 0
    );
    const primarySlowOrFailed =
      !primaryEntry ||
      effectiveStatus(primaryEntry.state, now) !== "closed" ||
      (primaryEntry.state.ewmaLatencyMs !== null && primaryEntry.state.ewmaLatencyMs > 12_000) ||
      primaryEntry.state.failures > 0;
    if (hasHealthyMeasured && primarySlowOrFailed) {
      adaptiveProviders.add(providerName);
    }
  }

  closed.sort((a, b) => {
    if (preferredKey) {
      if (a.key === preferredKey && b.key !== preferredKey) return -1;
      if (b.key === preferredKey && a.key !== preferredKey) return 1;
    }
    if (a.candidate.name === b.candidate.name) {
      if (adaptiveProviders.has(a.candidate.name)) {
        const aHas = a.state.ewmaLatencyMs !== null;
        const bHas = b.state.ewmaLatencyMs !== null;
        if (aHas && bHas && a.state.ewmaLatencyMs !== b.state.ewmaLatencyMs) {
          return a.state.ewmaLatencyMs - b.state.ewmaLatencyMs;
        }
        if (aHas !== bHas) {
          return aHas ? -1 : 1;
        }
      } else {
        if (a.candidate.isPrimary !== b.candidate.isPrimary) {
          return a.candidate.isPrimary ? -1 : 1;
        }
        if (a.state.ewmaLatencyMs !== null && b.state.ewmaLatencyMs !== null) {
          return a.state.ewmaLatencyMs - b.state.ewmaLatencyMs;
        }
      }
    }
    return a.candidate.priority - b.candidate.priority;
  });

  halfOpen.sort((a, b) => a.state.cooldownUntil - b.state.cooldownUntil || a.candidate.priority - b.candidate.priority);
  open.sort((a, b) => a.state.cooldownUntil - b.state.cooldownUntil || a.candidate.priority - b.candidate.priority);

  return [...closed, ...halfOpen, ...open].map((entry) => entry.candidate);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSwitchableError(error) {
  const code = String(error?.code || "");
  if (
    code === "AI_RATE_LIMIT" ||
    code === "AI_TIMEOUT" ||
    code === "AI_NETWORK_ERROR" ||
    code === "AI_EMPTY_RESPONSE" ||
    code === "AI_PROVIDER_RESPONSE" ||
    code === "AI_INVALID_JSON" ||
    code === "AI_PROVIDER_ERROR"
  ) {
    return true;
  }
  return Boolean(error?.retryable);
}

function resolveAttemptTimeoutMs(candidate, perAttemptTimeoutMs, remaining) {
  const hasExplicitOverride =
    perAttemptTimeoutMs !== undefined &&
    perAttemptTimeoutMs !== null &&
    perAttemptTimeoutMs !== 22_000;
  const cap =
    hasExplicitOverride && (!candidate.timeoutMs || perAttemptTimeoutMs < candidate.timeoutMs)
      ? perAttemptTimeoutMs
      : candidate.timeoutMs || perAttemptTimeoutMs || 22_000;
  return Math.max(1, Math.min(cap, remaining));
}

/**
 * Execute an AI stage with automatic multi-model traffic failover and shared deadline enforcement.
 */
export async function executeWithModelFailover({
  stageName = "chat",
  candidates,
  deadline,
  perAttemptTimeoutMs,
  preferredKey = null,
  executeFn,
  shouldSwitchFn,
}) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw aiError(
      "AI_NOT_CONFIGURED",
      "AI features are unavailable. Add NVIDIA_API_KEY to the server environment, then retry.",
      { retryable: false }
    );
  }

  const effectiveDeadline = deadline || Date.now() + 90_000;
  const authFailedProviders = new Set();
  const attemptedModels = [];
  let failoverCount = 0;
  let lastError = null;

  // Single-candidate compatibility path: allow 1 quick backoff retry for transient non-timeout errors
  if (candidates.length === 1) {
    const candidate = candidates[0];
    const providerLabel = providerDisplayName(candidate.name);
    for (let attempt = 0; attempt < SINGLE_CANDIDATE_MAX_ATTEMPTS; attempt++) {
      const remaining = effectiveDeadline - Date.now();
      if (remaining <= 0) throw deadlineError(providerLabel);

      const timeoutMs = resolveAttemptTimeoutMs(candidate, perAttemptTimeoutMs, remaining);
      const startedAt = Date.now();
      attemptedModels.push(candidate.model);

      try {
        const result = await executeFn(candidate, timeoutMs, attempt);
        recordSuccess(candidate, Date.now() - startedAt, 200);
        return {
          result,
          model: candidate.model,
          provider: candidate.name,
          candidateKey: candidateKey(candidate),
          failoverCount,
          attemptedModels,
        };
      } catch (error) {
        lastError = error;
        const elapsed = Date.now() - startedAt;
        if (error?.code !== "AI_PROVIDER_AUTH") {
          recordFailure(candidate, error, elapsed);
        }
        const canRetry =
          error?.code !== "AI_PROVIDER_AUTH" &&
          error?.code !== "AI_TIMEOUT" &&
          Boolean(error?.retryable) &&
          attempt + 1 < SINGLE_CANDIDATE_MAX_ATTEMPTS;
        if (!canRetry) throw error;

        const wait = error.retryAfterMs || DEFAULT_RETRY_DELAY_MS * (attempt + 1);
        if (effectiveDeadline - Date.now() <= wait + 250) {
          throw deadlineError(providerLabel);
        }
        await delay(wait);
      }
    }
    throw lastError || aiError("AI_PROVIDER_ERROR", `${providerLabel} could not complete this request.`);
  }

  const queue = selectCandidateQueue(candidates, { preferredKey, excludedProviders: authFailedProviders });
  for (let i = 0; i < queue.length; i++) {
    const candidate = queue[i];
    if (authFailedProviders.has(candidate.name)) continue;

    const providerLabel = providerDisplayName(candidate.name);
    const remaining = effectiveDeadline - Date.now();
    if (remaining <= 0) {
      throw deadlineError(providerLabel);
    }

    const timeoutMs = resolveAttemptTimeoutMs(candidate, perAttemptTimeoutMs, remaining);
    const startedAt = Date.now();
    attemptedModels.push(candidate.model);

    try {
      const result = await executeFn(candidate, timeoutMs, 0);
      recordSuccess(candidate, Date.now() - startedAt, 200);
      return {
        result,
        model: candidate.model,
        provider: candidate.name,
        candidateKey: candidateKey(candidate),
        failoverCount,
        attemptedModels,
      };
    } catch (error) {
      lastError = error;
      const elapsed = Date.now() - startedAt;

      if (error?.code === "AI_PROVIDER_AUTH") {
        authFailedProviders.add(candidate.name);
        const nextOtherProvider = queue.slice(i + 1).find((c) => !authFailedProviders.has(c.name));
        if (!nextOtherProvider) {
          throw error;
        }
        failoverCount += 1;
        totalSwitches += 1;
        logger.warn(
          `Model switch [${stageName}]: ${modelLabel(candidate)} -> ${modelLabel(nextOtherProvider)} (AI_PROVIDER_AUTH) after ${elapsed}ms`,
          "drizzlearn:ai",
          {
            stage: stageName,
            fromProvider: candidate.name,
            fromModel: candidate.model,
            toProvider: nextOtherProvider.name,
            toModel: nextOtherProvider.model,
            code: error.code,
            status: error.status || null,
            elapsedMs: elapsed,
          }
        );
        continue;
      }

      recordFailure(candidate, error, elapsed);

      if (effectiveDeadline - Date.now() <= 25 && error?.code === "AI_TIMEOUT") {
        throw deadlineError(providerLabel);
      }

      const allowSwitch = shouldSwitchFn ? shouldSwitchFn(error, candidate) : isSwitchableError(error);
      const nextCandidate = queue.slice(i + 1).find((c) => !authFailedProviders.has(c.name));

      if (!allowSwitch || !nextCandidate || effectiveDeadline - Date.now() <= 25) {
        if (effectiveDeadline - Date.now() <= 25 && error?.code === "AI_TIMEOUT") {
          throw deadlineError(providerLabel);
        }
        throw error;
      }

      failoverCount += 1;
      totalSwitches += 1;
      logger.warn(
        `Model switch [${stageName}]: ${modelLabel(candidate)} -> ${modelLabel(nextCandidate)} (${error?.code || "ERROR"}${error?.status ? ` HTTP ${error.status}` : ""}) after ${elapsed}ms`,
        "drizzlearn:ai",
        {
          stage: stageName,
          fromProvider: candidate.name,
          fromModel: candidate.model,
          toProvider: nextCandidate.name,
          toModel: nextCandidate.model,
          code: error?.code || "ERROR",
          status: error?.status || null,
          elapsedMs: elapsed,
        }
      );
    }
  }

  throw lastError || aiError("AI_PROVIDER_ERROR", "All configured AI models failed to complete this request.");
}

/**
 * Sanitized runtime health status for all configured models (safe for authenticated diagnostics).
 */
export function getModelPoolStatus() {
  const candidates = getCandidates();
  const now = Date.now();
  let healthyCount = 0;
  let openCount = 0;
  let halfOpenCount = 0;

  const models = candidates.map((candidate) => {
    const state = getOrCreateHealth(candidate);
    const status = effectiveStatus(state, now);
    if (status === "closed") healthyCount += 1;
    else if (status === "half_open") halfOpenCount += 1;
    else openCount += 1;

    return {
      provider: candidate.name,
      model: candidate.model,
      tier: candidate.isPrimary ? "primary" : "fallback",
      priority: candidate.priority,
      isPrimary: candidate.isPrimary,
      supportsJsonFormat: candidate.supportsJsonFormat,
      status,
      consecutiveFailures: state.consecutiveFailures,
      cooldownRemainingMs: status === "open" ? Math.max(0, state.cooldownUntil - now) : 0,
      attempts: state.attempts,
      successes: state.successes,
      failures: state.failures,
      rateLimits: state.rateLimits,
      timeouts: state.timeouts,
      highDemandErrors: state.highDemandErrors,
      avgLatencyMs: state.ewmaLatencyMs,
      ewmaLatencyMs: state.ewmaLatencyMs,
      lastLatencyMs: state.lastLatencyMs,
      lastStatus: state.lastStatus,
      lastErrorCode: state.lastErrorCode,
      lastUsedAt: state.lastUsedAt,
    };
  });

  const configuredProviders = [...new Set(candidates.map((c) => c.name))];
  return {
    configured: candidates.length > 0,
    totalModels: candidates.length,
    healthyCount,
    openCount,
    halfOpenCount,
    totalSwitches,
    providers: configuredProviders,
    summary: {
      configuredProviders,
      totalModels: candidates.length,
      healthyModels: healthyCount,
      coolingDownModels: openCount,
      halfOpenModels: halfOpenCount,
      totalSwitches,
    },
    models,
  };
}

/**
 * Reset in-memory circuit breaker and metrics state (primarily for tests).
 */
export function resetModelManager() {
  healthRegistry.clear();
  totalSwitches = 0;
}
