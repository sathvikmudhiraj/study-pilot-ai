import "server-only";

import {
  askGemini,
  getGeminiErrorCategory,
  getGeminiUserMessage,
  isGeminiBusyError,
  isGeminiQuotaError,
} from "./gemini";

type AIProvider = "gemini" | "nvidia" | "auto";
type AIErrorKind = "busy" | "quota" | "config" | "auth" | "empty" | "request" | "timeout" | "cancelled";
type AIProviderProfile = "default" | "summary";

type TextGenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  signal?: AbortSignal;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 30000;
const DEFAULT_SUMMARY_TIMEOUT_MS = 120000;
const DEFAULT_NVIDIA_MODEL = "z-ai/glm-5.2";
const TIMEOUT_MESSAGE = "AI is taking longer than expected. Try fewer questions or switch to faster model.";
export const SUMMARY_TIMEOUT_MESSAGE = "Summary generation is taking longer than expected. Please retry or use a faster AI model.";

type ProviderRuntimeConfig = {
  profile: AIProviderProfile;
  provider: AIProvider;
  timeoutMs: number;
  fastFallbackTimeoutMs: number;
  nvidiaModel: string;
  timeoutMessage: string;
};

class AIProviderError extends Error {
  kind: AIErrorKind;
  provider: Exclude<AIProvider, "auto">;
  status?: number;

  constructor(
    message: string,
    kind: AIErrorKind,
    provider: Exclude<AIProvider, "auto">,
    options?: { status?: number },
  ) {
    super(message);
    this.name = "AIProviderError";
    this.kind = kind;
    this.provider = provider;
    this.status = options?.status;
  }
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[aiProvider] ${message}`, details ?? "");
}

function normalizeProvider(value: string | undefined): AIProvider {
  const lower = (value || "auto").toLowerCase().trim();
  if (lower === "gemini" || lower === "nvidia" || lower === "auto") return lower;
  return "auto";
}

function configuredTimeout(value: string | undefined, fallback: number) {
  const configured = Number(value);
  if (Number.isFinite(configured) && configured >= 1000) return Math.round(configured);
  return fallback;
}

function getProviderTimeoutMs() {
  return configuredTimeout(process.env.AI_PROVIDER_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS);
}

function getRuntimeConfig(profile: AIProviderProfile): ProviderRuntimeConfig {
  if (profile === "summary") {
    const timeoutMs = configuredTimeout(process.env.SUMMARY_AI_TIMEOUT_MS, DEFAULT_SUMMARY_TIMEOUT_MS);
    return {
      profile,
      provider: normalizeProvider(process.env.SUMMARY_AI_PROVIDER || "auto"),
      timeoutMs,
      fastFallbackTimeoutMs: Math.min(timeoutMs, getProviderTimeoutMs(), DEFAULT_PROVIDER_TIMEOUT_MS),
      nvidiaModel: process.env.SUMMARY_NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
      timeoutMessage: SUMMARY_TIMEOUT_MESSAGE,
    };
  }

  const timeoutMs = getProviderTimeoutMs();
  return {
    profile,
    provider: normalizeProvider(process.env.AI_PROVIDER),
    timeoutMs,
    fastFallbackTimeoutMs: timeoutMs,
    nvidiaModel: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
    timeoutMessage: TIMEOUT_MESSAGE,
  };
}

function classifyProviderError(status: number, detail: string): AIErrorKind {
  const lower = detail.toLowerCase();

  if (
    status === 503 ||
    lower.includes("unavailable") ||
    lower.includes("overloaded") ||
    lower.includes("high demand") ||
    lower.includes("busy")
  ) {
    return "busy";
  }

  if (
    status === 429 ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("resource_exhausted") ||
    lower.includes("too many requests")
  ) {
    return "quota";
  }

  if (status === 401 || status === 403 || lower.includes("api key") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return "auth";
  }

  return "request";
}

async function parseNvidiaResponse(response: Response) {
  const raw = await response.text();

  if (!response.ok) {
    const kind = classifyProviderError(response.status, raw);
    if (kind === "busy") {
      throw new AIProviderError("StudyPilot AI is busy right now. Please try again in a few seconds.", "busy", "nvidia", {
        status: response.status,
      });
    }
    if (kind === "quota") {
      throw new AIProviderError("Free AI limit reached. Please try again later.", "quota", "nvidia", {
        status: response.status,
      });
    }
    if (kind === "auth") {
      throw new AIProviderError("AI service authentication failed. Check your NVIDIA API key.", "auth", "nvidia", {
        status: response.status,
      });
    }
    throw new AIProviderError("NVIDIA AI request failed. Please try again.", "request", "nvidia", {
      status: response.status,
    });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new AIProviderError("NVIDIA AI returned an unreadable response.", "request", "nvidia");
  }

  const choices = Array.isArray(data.choices) ? data.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;

  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const record = part as Record<string, unknown>;
        return typeof record.text === "string" ? record.text : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }

  throw new AIProviderError("NVIDIA AI returned an empty response.", "empty", "nvidia");
}

async function askNvidia(
  prompt: string,
  generationConfig: TextGenerationConfig = {},
  runtime: ProviderRuntimeConfig = getRuntimeConfig("default"),
) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new AIProviderError("NVIDIA AI service is not configured. Add NVIDIA_API_KEY in .env.local.", "config", "nvidia");
  }

  const baseUrl = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const model = runtime.nvidiaModel;
  const temperature = generationConfig.temperature ?? 0.35;
  const maxTokens = generationConfig.maxOutputTokens ?? 1400;
  const timeoutMs = runtime.timeoutMs;
  const startedAt = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(generationConfig.signal?.reason);
  if (generationConfig.signal?.aborted) onExternalAbort();
  else generationConfig.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  devLog("provider started", {
    profile: runtime.profile,
    provider: "nvidia",
    model,
    timeoutMs,
    responseMimeType: generationConfig.responseMimeType ?? "text/plain",
  });

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    });

    return await parseNvidiaResponse(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (generationConfig.signal?.aborted) {
        throw new AIProviderError("AI request was cancelled.", "cancelled", "nvidia");
      }
      if (!timedOut) throw new AIProviderError("NVIDIA AI request failed. Please try again.", "request", "nvidia");
      throw new AIProviderError(runtime.timeoutMessage, "timeout", "nvidia");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    generationConfig.signal?.removeEventListener("abort", onExternalAbort);
    devLog("provider duration", {
      profile: runtime.profile,
      provider: "nvidia",
      model,
      durationMs: Date.now() - startedAt,
    });
  }
}

function shouldFallbackFromGemini(error: unknown, profile: AIProviderProfile) {
  return (
    isGeminiBusyError(error) ||
    isGeminiQuotaError(error) ||
    (profile === "summary" && getGeminiErrorCategory(error) === "model")
  );
}

export function isAiBusyError(error: unknown) {
  return isGeminiBusyError(error) || (error instanceof AIProviderError && (error.kind === "busy" || error.kind === "timeout"));
}

export function isAiQuotaError(error: unknown) {
  return isGeminiQuotaError(error) || (error instanceof AIProviderError && error.kind === "quota");
}

export function isAiTimeoutError(error: unknown) {
  return getGeminiErrorCategory(error) === "timeout" || (error instanceof AIProviderError && error.kind === "timeout");
}

export function getAiUserMessage(error: unknown) {
  if (error instanceof AIProviderError) {
    if (error.kind === "busy") return "StudyPilot AI is busy right now. Please try again in a few seconds.";
    if (error.kind === "quota") return "Free AI limit reached. Please try again later.";
    if (error.kind === "config") return error.message;
    if (error.kind === "auth") return error.message;
    if (error.kind === "empty") return "AI returned an empty response. Please try again.";
    if (error.kind === "timeout") return error.message;
    if (error.kind === "cancelled") return "AI request was cancelled.";
  }

  return getGeminiUserMessage(error);
}

async function generateAITextForProfile(
  profile: AIProviderProfile,
  prompt: string,
  generationConfig?: TextGenerationConfig,
) {
  const runtime = getRuntimeConfig(profile);
  const { provider, timeoutMs } = runtime;
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  devLog("selected provider", {
    profile,
    provider,
    timeoutMs,
    nvidiaModel: runtime.nvidiaModel,
  });

  if (provider === "gemini") {
    const startedAt = Date.now();
    devLog("provider started", { profile, provider: "gemini", model: geminiModel, timeoutMs });
    try {
      const response = await askGemini(prompt, { ...generationConfig, timeoutMs });
      devLog("final provider used", { profile, provider: "gemini", model: geminiModel, fallbackTriggered: false });
      return response;
    } finally {
      devLog("provider duration", { profile, provider: "gemini", model: geminiModel, durationMs: Date.now() - startedAt });
    }
  }

  if (provider === "nvidia") {
    const response = await askNvidia(prompt, generationConfig, runtime);
    devLog("final provider used", {
      profile,
      provider: "nvidia",
      model: runtime.nvidiaModel,
      fallbackTriggered: false,
    });
    return response;
  }

  try {
    const startedAt = Date.now();
    devLog("provider started", {
      profile,
      provider: "gemini",
      model: geminiModel,
      timeoutMs: runtime.fastFallbackTimeoutMs,
      fastFallback: true,
    });
    try {
      const response = await askGemini(prompt, {
        ...generationConfig,
        timeoutMs: runtime.fastFallbackTimeoutMs,
        maxAttempts: 1,
        disableModelFallback: true,
      });
      devLog("fallback triggered", { profile, fallbackTriggered: false });
      devLog("final provider used", { profile, provider: "gemini", model: geminiModel, fallbackTriggered: false });
      return response;
    } finally {
      devLog("provider duration", { profile, provider: "gemini", model: geminiModel, durationMs: Date.now() - startedAt });
    }
  } catch (error) {
    const fallbackAllowed = shouldFallbackFromGemini(error, profile);
    const geminiCategory = getGeminiErrorCategory(error);
    devLog("gemini attempt failed", {
      profile,
      fallbackTriggered: fallbackAllowed,
      providerErrorCategory:
        isGeminiQuotaError(error) ? "quota" : geminiCategory === "timeout" ? "timeout" : isGeminiBusyError(error) ? "busy" : geminiCategory,
    });

    if (!fallbackAllowed) throw error;

    try {
      devLog("fallback triggered", {
        profile,
        fallbackTriggered: true,
        fromProvider: "gemini",
        toProvider: "nvidia",
        model: runtime.nvidiaModel,
      });
      const response = await askNvidia(prompt, generationConfig, runtime);
      devLog("final provider used", {
        profile,
        provider: "nvidia",
        model: runtime.nvidiaModel,
        fallbackTriggered: true,
      });
      return response;
    } catch (fallbackError) {
      devLog("fallback provider failed", {
        profile,
        provider: "nvidia",
        model: runtime.nvidiaModel,
        providerErrorCategory:
          fallbackError instanceof AIProviderError ? fallbackError.kind : "request",
      });
      throw fallbackError;
    }
  }
}

export async function generateAIText(prompt: string, generationConfig?: TextGenerationConfig) {
  return generateAITextForProfile("default", prompt, generationConfig);
}

export async function generateSummaryAIText(prompt: string, generationConfig?: TextGenerationConfig) {
  return generateAITextForProfile("summary", prompt, generationConfig);
}
