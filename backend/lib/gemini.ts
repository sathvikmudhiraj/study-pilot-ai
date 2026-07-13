import "server-only";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACK_MODEL = "gemini-2.0-flash";
const BUSY_MESSAGE = "StudyPilot AI is busy right now. Please try again in a few seconds.";
const QUOTA_MESSAGE = "Free AI limit reached. Please try again later.";
const CONFIG_MESSAGE = "AI service is not configured. Add GEMINI_API_KEY in .env.local.";

type GeminiGenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  timeoutMs?: number;
  maxAttempts?: number;
  disableModelFallback?: boolean;
  signal?: AbortSignal;
};

export type GeminiErrorKind = "busy" | "quota" | "config" | "auth" | "empty" | "request" | "timeout" | "model" | "cancelled";

class GeminiApiError extends Error {
  kind: GeminiErrorKind;
  status?: number;
  model?: string;

  constructor(message: string, kind: GeminiErrorKind, options?: { status?: number; model?: string }) {
    super(message);
    this.name = "GeminiApiError";
    this.kind = kind;
    this.status = options?.status;
    this.model = options?.model;
  }
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[gemini] ${message}`, details ?? "");
}

function sleep(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new GeminiApiError("AI request was cancelled.", "cancelled"));
  return new Promise<void>((resolve, reject) => {
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new GeminiApiError("AI request was cancelled.", "cancelled")));
    const timer = setTimeout(() => finish(resolve), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiApiError(CONFIG_MESSAGE, "config");
  }

  if (process.env.NODE_ENV !== "production" && process.env.STUDYPILOT_FORCE_AI_QUOTA === "1") {
    devLog("quota forced by development flag");
    throw new GeminiApiError(QUOTA_MESSAGE, "quota");
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;

  return {
    apiKey,
    model,
    fallbackModel: fallbackModel === model ? "" : fallbackModel,
  };
}

function classifyGeminiError(status: number, detail: string): GeminiErrorKind {
  const lower = detail.toLowerCase();

  if (
    (status === 400 || status === 404) &&
    lower.includes("model") &&
    (lower.includes("not found") || lower.includes("not supported") || lower.includes("unsupported") || lower.includes("does not exist"))
  ) {
    return "model";
  }

  if (status === 503 || lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("high demand") || lower.includes("spikes in demand")) {
    return "busy";
  }

  if (status === 429 || lower.includes("quota") || lower.includes("rate limit") || lower.includes("resource_exhausted")) {
    return "quota";
  }

  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("permission_denied") || lower.includes("unauthenticated")) {
    return "auth";
  }

  return "request";
}

async function parseGeminiResponse(response: Response, model: string) {
  if (!response.ok) {
    const detail = await response.text();
    const kind = classifyGeminiError(response.status, detail);

    if (kind === "busy") throw new GeminiApiError(BUSY_MESSAGE, "busy", { status: response.status, model });
    if (kind === "quota") throw new GeminiApiError(QUOTA_MESSAGE, "quota", { status: response.status, model });
    if (kind === "auth") throw new GeminiApiError("Gemini authentication failed. Check your API key configuration.", "auth", { status: response.status, model });
    if (kind === "model") throw new GeminiApiError("The configured Gemini model does not support this request.", "model", { status: response.status, model });

    throw new GeminiApiError("Gemini request failed. Please try again.", "request", { status: response.status, model });
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text;
  if (!text) throw new GeminiApiError("Gemini returned an empty response.", "empty", { model });
  return text as string;
}

async function callGeminiModel({
  apiKey,
  model,
  body,
  timeoutMs,
  signal,
}: {
  apiKey: string;
  model: string;
  body: Record<string, unknown>;
  timeoutMs: number;
  signal?: AbortSignal;
}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onExternalAbort();
  else signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  devLog("request started", { model, timeoutMs });

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );

    return await parseGeminiResponse(response, model);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (signal?.aborted) throw new GeminiApiError("AI request was cancelled.", "cancelled", { model });
      if (!timedOut) throw new GeminiApiError("Gemini request failed. Please try again.", "request", { model });
      throw new GeminiApiError("AI is taking longer than expected. Try fewer questions or switch to faster model.", "timeout", { model });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onExternalAbort);
    devLog("request duration", { model, durationMs: Date.now() - startedAt });
  }
}

async function generateWithRetry(
  body: Record<string, unknown>,
  options: { timeoutMs?: number; maxAttempts?: number; disableModelFallback?: boolean; signal?: AbortSignal } = {},
) {
  if (options.signal?.aborted) throw new GeminiApiError("AI request was cancelled.", "cancelled");
  const { apiKey, model, fallbackModel } = getGeminiConfig();
  const models = [model, options.disableModelFallback ? "" : fallbackModel].filter(Boolean);
  const timeoutMs = options.timeoutMs ?? 30000;
  let lastError: unknown = null;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const currentModel = models[modelIndex];
    const maxAttempts = options.maxAttempts ?? (modelIndex === 0 ? 3 : 2);

    if (modelIndex > 0) {
      devLog("fallback model used", { model: currentModel });
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        devLog("attempt", { model: currentModel, attempt });
        return await callGeminiModel({ apiKey, model: currentModel, body, timeoutMs, signal: options.signal });
      } catch (error) {
        lastError = error;

        if (!(error instanceof GeminiApiError)) {
          devLog("final sanitized error type", { type: "request", model: currentModel });
          throw new GeminiApiError("Gemini request failed. Please try again.", "request", { model: currentModel });
        }

        devLog("attempt failed", {
          model: currentModel,
          attempt,
          type: error.kind,
          status: error.status ?? null,
        });

        if (error.kind === "cancelled" || options.signal?.aborted) throw error;

        const hasMoreAttempts = attempt < maxAttempts;
        const canUseFallback = modelIndex < models.length - 1;

        if (error.kind === "model" && canUseFallback) {
          devLog("unsupported model; switching to fallback", { model: currentModel });
          break;
        }

        if (error.kind !== "busy" && error.kind !== "timeout") {
          devLog("final sanitized error type", { type: error.kind, model: currentModel });
          throw error;
        }

        if (hasMoreAttempts) {
          const delay = attempt === 1 ? 800 : 1600;
          devLog("retry scheduled", { model: currentModel, attempt, delay });
          await sleep(delay, options.signal);
          continue;
        }

        if (canUseFallback) {
          break;
        }

        devLog("final sanitized error type", { type: "busy", model: currentModel });
        throw error;
      }
    }
  }

  if (lastError instanceof GeminiApiError) throw lastError;
  throw new GeminiApiError(BUSY_MESSAGE, "busy");
}

export function isGeminiBusyError(error: unknown) {
  return error instanceof GeminiApiError && (error.kind === "busy" || error.kind === "timeout");
}

export function isGeminiQuotaError(error: unknown) {
  return error instanceof GeminiApiError && error.kind === "quota";
}

export function getGeminiUserMessage(error: unknown) {
  if (error instanceof GeminiApiError) {
    if (error.kind === "busy") return BUSY_MESSAGE;
    if (error.kind === "quota") return QUOTA_MESSAGE;
    if (error.kind === "config") return CONFIG_MESSAGE;
    if (error.kind === "auth") return "AI service authentication failed. Check your Gemini API key.";
    if (error.kind === "empty") return "AI returned an empty response. Please try again.";
    if (error.kind === "timeout") return "AI is taking longer than expected. Try fewer questions or switch to faster model.";
    if (error.kind === "model") return "The configured Gemini model does not support this request.";
  }

  const message = error instanceof Error ? error.message : "";
  const lower = message.toLowerCase();

  if (lower.includes("unavailable") || lower.includes("overloaded") || lower.includes("high demand") || lower.includes("503")) return BUSY_MESSAGE;
  if (lower.includes("quota") || lower.includes("429") || lower.includes("rate limit") || lower.includes("free ai limit")) return QUOTA_MESSAGE;
  if (lower.includes("ai service is not configured") || lower.includes("gemini_api_key")) return CONFIG_MESSAGE;

  return "AI request failed. Please try again.";
}

export function getGeminiErrorCategory(error: unknown): GeminiErrorKind | "unknown" {
  return error instanceof GeminiApiError ? error.kind : "unknown";
}

export async function askGemini(prompt: string, generationConfig?: GeminiGenerationConfig) {
  const { timeoutMs, maxAttempts, disableModelFallback, signal, ...apiGenerationConfig } = generationConfig ?? {};
  return generateWithRetry({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1400,
      ...apiGenerationConfig,
    },
  }, { timeoutMs, maxAttempts, disableModelFallback, signal });
}

export async function askGeminiWithInlineData({
  prompt,
  mimeType,
  data,
  maxOutputTokens = 1800,
  timeoutMs,
}: {
  prompt: string;
  mimeType: string;
  data: Buffer;
  maxOutputTokens?: number;
  timeoutMs?: number;
}) {
  return generateWithRetry({
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: data.toString("base64"),
            },
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens,
    },
  }, { timeoutMs });
}
