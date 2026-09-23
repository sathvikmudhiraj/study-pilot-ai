import "server-only";

import {
  askGemini,
  getGeminiErrorCategory,
  getGeminiUserMessage,
  isGeminiBusyError,
  isGeminiQuotaError,
} from "./gemini";
import { logProviderTelemetry } from "./observability";

type AIProvider = "gemini" | "nvidia" | "auto";
type AIErrorKind = "busy" | "quota" | "config" | "auth" | "empty" | "request" | "timeout" | "cancelled";
type AIProviderProfile = "default" | "summary" | "revision";

export type AIProviderResult = {
  text: string;
  provider: Exclude<AIProvider, "auto">;
  model: string;
  fallbackUsed: boolean;
  fallbackProvider?: Exclude<AIProvider, "auto">;
  fallbackModel?: string;
  responseMode: "ai" | "offline_fallback";
  providerFailureCategory?: AIErrorKind;
  geminiLatencyMs?: number;
  nvidiaLatencyMs?: number;
  totalLatencyMs: number;
  offlineFallbackUsed: boolean;
  geminiSkippedDueToCooldown: boolean;
};

type VisionGenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  telemetry?: (event: VisionProviderTelemetryEvent) => void;
  disableProviderFallback?: boolean;
};

export type VisionProvider = "gemini" | "nvidia-vision" | "auto";
export type VisionErrorKind = "busy" | "quota" | "config" | "auth" | "empty" | "request" | "timeout" | "cancelled" | "unavailable";

export type VisionProviderTelemetryEvent = {
  event: "selected" | "provider_started" | "provider_finished" | "provider_failed" | "fallback_triggered" | "final_provider";
  provider: VisionProvider;
  model?: string;
  timeoutMs?: number;
  durationMs?: number;
  fallbackTriggered?: boolean;
  retryCount?: number;
  errorKind?: VisionErrorKind | "gemini";
  batchInfo?: { startPage: number; endPage: number; batchIndex: number; totalBatches: number };
};

type TextGenerationConfig = {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: "application/json" | "text/plain";
  timeoutMs?: number;
  maxAttempts?: number;
  disableProviderFallback?: boolean;
  signal?: AbortSignal;
  telemetry?: (event: AIProviderTelemetryEvent) => void;
};

const DEFAULT_PROVIDER_TIMEOUT_MS = 30000;
const DEFAULT_INTERACTIVE_TIMEOUT_MS = 10000;
const DEFAULT_SUMMARY_TIMEOUT_MS = 120000;
const DEFAULT_REVISION_TIMEOUT_MS = 25000;
const DEFAULT_NVIDIA_TIMEOUT_MS = 180_000;
const DEFAULT_NVIDIA_MODEL = "meta/llama-3.2-11b-vision-instruct";
const TIMEOUT_MESSAGE = "AI is taking longer than expected. Try fewer questions or switch to faster model.";
export const SUMMARY_TIMEOUT_MESSAGE = "Summary generation timed out. Please retry.";
const REVISION_TIMEOUT_MESSAGE = "Revision plan generation timed out. Please try again.";

const GEMINI_COOLDOWN_MS = 30_000;

type ProviderRuntimeConfig = {
  profile: AIProviderProfile;
  provider: AIProvider;
  timeoutMs: number;
  fastFallbackTimeoutMs: number;
  nvidiaModel: string;
  timeoutMessage: string;
  interactiveTimeoutMs: number;
};

interface GeminiCircuitBreaker {
  isHealthy: boolean;
  lastFailureAt: number;
  failureCount: number;
  cooldownUntil: number;
}

const geminiCircuitBreaker: GeminiCircuitBreaker = {
  isHealthy: true,
  lastFailureAt: 0,
  failureCount: 0,
  cooldownUntil: 0,
};

function checkGeminiCooldown(): boolean {
  const now = Date.now();
  if (geminiCircuitBreaker.cooldownUntil > now) {
    return false;
  }
  if (!geminiCircuitBreaker.isHealthy && now > geminiCircuitBreaker.cooldownUntil) {
    geminiCircuitBreaker.isHealthy = true;
    geminiCircuitBreaker.failureCount = 0;
  }
  return geminiCircuitBreaker.isHealthy;
}

function recordGeminiFailure(errorKind: AIErrorKind): void {
  const now = Date.now();
  geminiCircuitBreaker.lastFailureAt = now;
  geminiCircuitBreaker.failureCount += 1;

  if (errorKind === "quota" || errorKind === "timeout" || errorKind === "busy") {
    geminiCircuitBreaker.isHealthy = false;
    geminiCircuitBreaker.cooldownUntil = now + GEMINI_COOLDOWN_MS;
  }
}

function recordGeminiSuccess(): void {
  geminiCircuitBreaker.isHealthy = true;
  geminiCircuitBreaker.failureCount = 0;
  geminiCircuitBreaker.cooldownUntil = 0;
}

export type AIProviderTelemetryEvent = {
  event: "selected" | "provider_started" | "provider_finished" | "provider_failed" | "fallback_triggered" | "final_provider";
  profile: AIProviderProfile;
  provider: Exclude<AIProvider, "auto"> | "auto";
  model?: string;
  timeoutMs?: number;
  durationMs?: number;
  fallbackTriggered?: boolean;
  retryCount?: number;
  errorKind?: AIErrorKind | "gemini";
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

function boundedTimeout(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value) || !value || value < 1000) return fallback;
  return Math.min(Math.round(value), fallback);
}

function validTimeout(value: number | undefined) {
  if (!Number.isFinite(value) || !value || value < 1000) return undefined;
  return Math.round(value);
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
      interactiveTimeoutMs: timeoutMs,
    };
  }

  if (profile === "revision") {
    const timeoutMs = configuredTimeout(process.env.REVISION_AI_TIMEOUT_MS, DEFAULT_REVISION_TIMEOUT_MS);
    // Budget allocation: Gemini fast attempt ~10s, NVIDIA fallback ~15s, total ~25s
    const geminiFastTimeoutMs = Math.min(10000, Math.floor(timeoutMs * 0.4));
    return {
      profile,
      provider: normalizeProvider(process.env.REVISION_AI_PROVIDER || "auto"),
      timeoutMs,
      fastFallbackTimeoutMs: geminiFastTimeoutMs,
      nvidiaModel: process.env.REVISION_NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
      timeoutMessage: REVISION_TIMEOUT_MESSAGE,
      interactiveTimeoutMs: timeoutMs,
    };
  }

  const timeoutMs = getProviderTimeoutMs();
  const interactiveTimeoutMs = configuredTimeout(process.env.AI_INTERACTIVE_TIMEOUT_MS, DEFAULT_INTERACTIVE_TIMEOUT_MS);
  // Budget allocation for interactive: Gemini fast attempt ~8-10s, NVIDIA fallback ~15-20s, total ~25-30s
  const geminiFastTimeoutMs = Math.min(10000, Math.floor(interactiveTimeoutMs * 0.4));
  return {
    profile,
    provider: normalizeProvider(process.env.AI_PROVIDER),
    timeoutMs,
    fastFallbackTimeoutMs: geminiFastTimeoutMs,
    nvidiaModel: process.env.NVIDIA_MODEL || DEFAULT_NVIDIA_MODEL,
    timeoutMessage: TIMEOUT_MESSAGE,
    interactiveTimeoutMs,
  };
}

export function getAIProviderRuntimeInfo(profile: AIProviderProfile = "default") {
  const runtime = getRuntimeConfig(profile);
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  return {
    profile,
    configuredProvider: runtime.provider,
    primaryProvider: runtime.provider === "auto" ? "gemini" : runtime.provider,
    primaryModel: runtime.provider === "nvidia" ? runtime.nvidiaModel : geminiModel,
    fallbackProvider: runtime.provider === "auto" ? "nvidia" : null,
    fallbackModel: runtime.provider === "auto" ? runtime.nvidiaModel : null,
    timeoutMs: runtime.timeoutMs,
    fastFallbackTimeoutMs: runtime.fastFallbackTimeoutMs,
  };
}

function emitTelemetry(generationConfig: TextGenerationConfig | undefined, event: AIProviderTelemetryEvent) {
  try {
    logProviderTelemetry(event);
    generationConfig?.telemetry?.(event);
  } catch {
    // Telemetry must never affect AI generation.
  }
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

  if (process.env.NODE_ENV !== "production") {
    console.log("[DEBUG] NVIDIA raw response:", {
      status: response.status,
      rawLength: raw.length,
      rawPreview: raw.slice(0, 500),
      startsWithFence: raw.trimStart().startsWith("```"),
      leadingProse: raw.trimStart()[0] !== "{",
      trailingProse: (() => {
        const match = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        return raw.trim() !== (match?.[1]?.trim() ?? raw.trim());
      })(),
    });
  }

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

async function sleepMs(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return Promise.reject(new AIProviderError("AI request was cancelled.", "cancelled", "nvidia"));
  return new Promise<void>((resolve, reject) => {
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new AIProviderError("AI request was cancelled.", "cancelled", "nvidia")));
    const timer = setTimeout(() => finish(resolve), ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
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
  const callerTimeoutMs = validTimeout(generationConfig.timeoutMs);
  const timeoutMs = callerTimeoutMs ?? configuredTimeout(process.env.NVIDIA_TIMEOUT_MS, DEFAULT_NVIDIA_TIMEOUT_MS);
  const startedAt = Date.now();
  const maxRetries = 3;
  let retryCount = 0;

  devLog("provider started", {
    profile: runtime.profile,
    provider: "nvidia",
    model,
    timeoutMs,
    responseMimeType: generationConfig.responseMimeType ?? "text/plain",
  });
  if (runtime.profile === "summary") {
    console.info("[summary-provider-trace] nvidia.request_started", {
      provider: "nvidia",
      model,
      startedAt: new Date(startedAt).toISOString(),
      timeoutMs,
      maxTokens,
      responseMimeType: generationConfig.responseMimeType ?? "text/plain",
    });
  }

  while (true) {
    const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);
    if (remainingTimeoutMs <= 0) {
      throw new AIProviderError(runtime.timeoutMessage, "timeout", "nvidia");
    }
    const controller = new AbortController();
    let timedOut = false;
    const onExternalAbort = () => controller.abort(generationConfig.signal?.reason);
    if (generationConfig.signal?.aborted) onExternalAbort();
    else generationConfig.signal?.addEventListener("abort", onExternalAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, remainingTimeoutMs);

    try {
      const requestBody: Record<string, unknown> = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: maxTokens,
        chat_template_kwargs: { enable_thinking: false },
      };
      if (generationConfig.responseMimeType === "application/json") {
        requestBody.response_format = { type: "json_object" };
      }
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      if (runtime.profile === "summary") {
        console.info("[summary-provider-trace] nvidia.http_response", {
          provider: "nvidia",
          model,
          status: response.status,
          ok: response.ok,
          timeToFirstResponseMs: Date.now() - startedAt,
          retryCount,
        });
      }

      clearTimeout(timeout);
      generationConfig.signal?.removeEventListener("abort", onExternalAbort);

      if (response.ok) {
        devLog("provider duration", {
          profile: runtime.profile,
          provider: "nvidia",
          model,
          durationMs: Date.now() - startedAt,
          retryCount,
        });
        const parsed = await parseNvidiaResponse(response);
        if (runtime.profile === "summary") {
          console.info("[summary-provider-trace] nvidia.parsed_output", {
            provider: "nvidia",
            model,
            responseLength: parsed.length,
            totalDurationMs: Date.now() - startedAt,
            retryCount,
          });
        }
        return parsed;
      }

      const raw = await response.text();
      if (runtime.profile === "summary") {
        console.info("[summary-provider-trace] nvidia.error_body", {
          provider: "nvidia",
          model,
          status: response.status,
          bodyLength: raw.length,
          totalDurationMs: Date.now() - startedAt,
          retryCount,
        });
      }
      const kind = classifyProviderError(response.status, raw);

      if (kind === "busy") {
        devLog("provider duration", {
          profile: runtime.profile,
          provider: "nvidia",
          model,
          durationMs: Date.now() - startedAt,
          retryCount,
        });
        throw new AIProviderError("StudyPilot AI is busy right now. Please try again in a few seconds.", "busy", "nvidia", {
          status: response.status,
        });
      }

      if (kind === "quota") {
        if (retryCount < maxRetries && response.status === 429) {
          retryCount += 1;
          const retryAfterHeader = response.headers.get("Retry-After");
          let delayMs = 0;
          if (retryAfterHeader) {
            const parsed = Number(retryAfterHeader);
            if (Number.isFinite(parsed) && parsed > 0) {
              delayMs = Math.min(parsed * 1000, 30000);
            }
          }
          if (!delayMs) {
            const baseDelay = 1000;
            delayMs = Math.min(baseDelay * 2 ** (retryCount - 1), 10000);
          }
          devLog("nvidia 429 retry scheduled", {
            profile: runtime.profile,
            retryCount,
            delayMs,
            retryAfterHeader: retryAfterHeader ?? null,
          });
          const remainingAfterResponseMs = timeoutMs - (Date.now() - startedAt);
          if (remainingAfterResponseMs <= 0) {
            throw new AIProviderError(runtime.timeoutMessage, "timeout", "nvidia");
          }
          await sleepMs(Math.min(delayMs, remainingAfterResponseMs), generationConfig.signal);
          continue;
        }

        devLog("provider duration", {
          profile: runtime.profile,
          provider: "nvidia",
          model,
          durationMs: Date.now() - startedAt,
          retryCount,
        });
        throw new AIProviderError("Free AI limit reached. Please try again later.", "quota", "nvidia", {
          status: response.status,
        });
      }

      if (kind === "auth") {
        devLog("provider duration", {
          profile: runtime.profile,
          provider: "nvidia",
          model,
          durationMs: Date.now() - startedAt,
          retryCount,
        });
        throw new AIProviderError("AI service authentication failed. Check your NVIDIA API key.", "auth", "nvidia", {
          status: response.status,
        });
      }

      devLog("provider duration", {
        profile: runtime.profile,
        provider: "nvidia",
        model,
        durationMs: Date.now() - startedAt,
        retryCount,
      });
      throw new AIProviderError("NVIDIA AI request failed. Please try again.", "request", "nvidia", {
        status: response.status,
      });
    } catch (error) {
      clearTimeout(timeout);
      generationConfig.signal?.removeEventListener("abort", onExternalAbort);

      if (error instanceof AIProviderError) {
        devLog("provider duration", {
          profile: runtime.profile,
          provider: "nvidia",
          model,
          durationMs: Date.now() - startedAt,
          retryCount,
        });
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        if (generationConfig.signal?.aborted) {
          if (runtime.profile === "summary") {
            console.info("[summary-provider-trace] nvidia.request_aborted", {
              provider: "nvidia",
              model,
              source: "outer_signal",
              durationMs: Date.now() - startedAt,
              retryCount,
            });
          }
          throw new AIProviderError("AI request was cancelled.", "cancelled", "nvidia");
        }
        if (!timedOut) {
          if (runtime.profile === "summary") {
            console.info("[summary-provider-trace] nvidia.request_aborted", {
              provider: "nvidia",
              model,
              source: "http_client_abort",
              durationMs: Date.now() - startedAt,
              retryCount,
            });
          }
          throw new AIProviderError("NVIDIA AI request failed. Please try again.", "request", "nvidia");
        }
        if (runtime.profile === "summary") {
          console.info("[summary-provider-trace] nvidia.request_timeout", {
            provider: "nvidia",
            model,
            source: "provider_wrapper_abort_controller",
            durationMs: Date.now() - startedAt,
            timeoutMs,
            retryCount,
            bodyArrived: false,
          });
        }
        throw new AIProviderError(runtime.timeoutMessage, "timeout", "nvidia");
      }
      throw error;
    }
  }
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
): Promise<AIProviderResult> {
  const requestStartedAt = Date.now();
  const runtime = getRuntimeConfig(profile);
  const isInteractive = profile === "default";
  const interactiveTimeoutMs = runtime.interactiveTimeoutMs ?? DEFAULT_INTERACTIVE_TIMEOUT_MS;

  const providerChainTimeoutMs = validTimeout(generationConfig?.timeoutMs)
    ?? (isInteractive ? interactiveTimeoutMs : configuredTimeout(process.env.NVIDIA_TIMEOUT_MS, DEFAULT_NVIDIA_TIMEOUT_MS));
  const callTimeoutMs = boundedTimeout(generationConfig?.timeoutMs, isInteractive ? interactiveTimeoutMs : runtime.timeoutMs);
  const callRuntime: ProviderRuntimeConfig = {
    ...runtime,
    timeoutMs: callTimeoutMs,
    fastFallbackTimeoutMs: Math.min(runtime.fastFallbackTimeoutMs, callTimeoutMs),
    interactiveTimeoutMs,
  };

  console.log("[REVISION-TRACE] generateAITextForProfile START", {
    profile,
    isInteractive,
    generationConfigTimeoutMs: generationConfig?.timeoutMs,
    providerChainTimeoutMs,
    callTimeoutMs,
    callRuntimeTimeoutMs: callRuntime.timeoutMs,
    callRuntimeFastFallbackTimeoutMs: callRuntime.fastFallbackTimeoutMs,
    interactiveTimeoutMs,
    runtimeTimeoutMs: runtime.timeoutMs,
    runtimeFastFallbackTimeoutMs: runtime.fastFallbackTimeoutMs,
    envAIProviderTimeoutMs: process.env.AI_PROVIDER_TIMEOUT_MS,
    envInteractiveTimeoutMs: process.env.AI_INTERACTIVE_TIMEOUT_MS,
  });
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const nvidiaModel = callRuntime.nvidiaModel;

  const providerGenerationConfig = {
    temperature: generationConfig?.temperature,
    maxOutputTokens: generationConfig?.maxOutputTokens,
    responseMimeType: generationConfig?.responseMimeType,
    timeoutMs: generationConfig?.timeoutMs,
    maxAttempts: generationConfig?.maxAttempts,
    signal: generationConfig?.signal,
  };

  const explicitProvider = callRuntime.provider;
  const geminiSkippedDueToCooldown = !checkGeminiCooldown();

  const shouldTryGeminiFirst = explicitProvider === "auto" && !geminiSkippedDueToCooldown;
  const shouldUseNvidiaDirectly = explicitProvider === "nvidia";
  const shouldUseGeminiDirectly = explicitProvider === "gemini";

  let geminiLatencyMs: number | undefined;
  let nvidiaLatencyMs: number | undefined;
  let providerFailureCategory: AIErrorKind | undefined;

  if (shouldUseNvidiaDirectly) {
    const nvidiaStartedAt = Date.now();
    devLog("provider started", { profile, provider: "nvidia", model: nvidiaModel, timeoutMs: callRuntime.timeoutMs });
    emitTelemetry(generationConfig, {
      event: "provider_started",
      profile,
      provider: "nvidia",
      model: nvidiaModel,
      timeoutMs: callRuntime.timeoutMs,
      fallbackTriggered: false,
    });
    try {
      const response = await askNvidia(prompt, providerGenerationConfig, callRuntime);
      nvidiaLatencyMs = Date.now() - nvidiaStartedAt;
      devLog("final provider used", { profile, provider: "nvidia", model: nvidiaModel, fallbackTriggered: false });
      emitTelemetry(generationConfig, {
        event: "provider_finished",
        profile,
        provider: "nvidia",
        model: nvidiaModel,
        timeoutMs: callRuntime.timeoutMs,
        durationMs: nvidiaLatencyMs,
        fallbackTriggered: false,
      });
      emitTelemetry(generationConfig, {
        event: "final_provider",
        profile,
        provider: "nvidia",
        model: nvidiaModel,
        fallbackTriggered: false,
      });
      return {
        text: response,
        provider: "nvidia",
        model: nvidiaModel,
        fallbackUsed: false,
        responseMode: "ai",
        geminiLatencyMs: undefined,
        nvidiaLatencyMs,
        totalLatencyMs: Date.now() - requestStartedAt,
        offlineFallbackUsed: false,
        geminiSkippedDueToCooldown: false,
      };
    } catch (nvidiaError) {
      nvidiaLatencyMs = Date.now() - nvidiaStartedAt;
      const nvidiaErrorKind = nvidiaError instanceof AIProviderError ? nvidiaError.kind : "request";
      providerFailureCategory = nvidiaErrorKind;
      devLog("nvidia provider failed", { profile, errorKind: nvidiaErrorKind, latencyMs: nvidiaLatencyMs });
      emitTelemetry(generationConfig, {
        event: "provider_failed",
        profile,
        provider: "nvidia",
        model: nvidiaModel,
        timeoutMs: callRuntime.timeoutMs,
        durationMs: nvidiaLatencyMs,
        errorKind: nvidiaErrorKind,
      });
      return {
        text: "",
        provider: "nvidia",
        model: nvidiaModel,
        fallbackUsed: false,
        responseMode: "offline_fallback",
        providerFailureCategory: nvidiaErrorKind,
        geminiLatencyMs: undefined,
        nvidiaLatencyMs,
        totalLatencyMs: Date.now() - requestStartedAt,
        offlineFallbackUsed: true,
        geminiSkippedDueToCooldown: false,
      };
    }
  }

  if (shouldUseGeminiDirectly) {
    const geminiStartedAt = Date.now();
    devLog("provider started", { profile, provider: "gemini", model: geminiModel, timeoutMs: callRuntime.timeoutMs });
    emitTelemetry(generationConfig, {
      event: "provider_started",
      profile,
      provider: "gemini",
      model: geminiModel,
      timeoutMs: callRuntime.timeoutMs,
      fallbackTriggered: false,
    });
    try {
      const response = await askGemini(prompt, { ...providerGenerationConfig, timeoutMs: callRuntime.timeoutMs, signal: generationConfig?.signal });
      geminiLatencyMs = Date.now() - geminiStartedAt;
      recordGeminiSuccess();
      devLog("final provider used", { profile, provider: "gemini", model: geminiModel, fallbackTriggered: false });
      emitTelemetry(generationConfig, {
        event: "provider_finished",
        profile,
        provider: "gemini",
        model: geminiModel,
        timeoutMs: callRuntime.timeoutMs,
        durationMs: geminiLatencyMs,
        fallbackTriggered: false,
      });
      emitTelemetry(generationConfig, {
        event: "final_provider",
        profile,
        provider: "gemini",
        model: geminiModel,
        fallbackTriggered: false,
      });
      return {
        text: response,
        provider: "gemini",
        model: geminiModel,
        fallbackUsed: false,
        responseMode: "ai",
        providerFailureCategory: undefined,
        geminiLatencyMs,
        nvidiaLatencyMs: undefined,
        totalLatencyMs: Date.now() - requestStartedAt,
        offlineFallbackUsed: false,
        geminiSkippedDueToCooldown: false,
      };
    } catch (error) {
      geminiLatencyMs = Date.now() - geminiStartedAt;
      const geminiErrorKind = getGeminiErrorCategory(error) === "timeout" ? "timeout" : isGeminiQuotaError(error) ? "quota" : isGeminiBusyError(error) ? "busy" : "request";
      providerFailureCategory = geminiErrorKind;
      recordGeminiFailure(geminiErrorKind);
      devLog("gemini provider failed", { profile, errorKind: geminiErrorKind, latencyMs: geminiLatencyMs });
      emitTelemetry(generationConfig, {
        event: "provider_failed",
        profile,
        provider: "gemini",
        model: geminiModel,
        timeoutMs: callRuntime.timeoutMs,
        durationMs: geminiLatencyMs,
        errorKind: geminiErrorKind,
      });
      return {
        text: "",
        provider: "gemini",
        model: geminiModel,
        fallbackUsed: false,
        responseMode: "offline_fallback",
        providerFailureCategory: geminiErrorKind,
        geminiLatencyMs,
        nvidiaLatencyMs: undefined,
        totalLatencyMs: Date.now() - requestStartedAt,
        offlineFallbackUsed: true,
        geminiSkippedDueToCooldown: false,
      };
    }
  }

  if (shouldTryGeminiFirst) {
    const geminiStartedAt = Date.now();
    devLog("provider started", { profile, provider: "gemini", model: geminiModel, timeoutMs: callRuntime.fastFallbackTimeoutMs, fastAttempt: true });
    emitTelemetry(generationConfig, {
      event: "provider_started",
      profile,
      provider: "gemini",
      model: geminiModel,
      timeoutMs: callRuntime.fastFallbackTimeoutMs,
      fallbackTriggered: false,
      retryCount: 0,
    });
    try {
      const response = await askGemini(prompt, {
        ...providerGenerationConfig,
        timeoutMs: callRuntime.fastFallbackTimeoutMs,
        maxAttempts: 1,
        disableModelFallback: true,
        signal: generationConfig?.signal,
      });
      geminiLatencyMs = Date.now() - geminiStartedAt;
      recordGeminiSuccess();
      devLog("final provider used", { profile, provider: "gemini", model: geminiModel, fallbackTriggered: false });
      emitTelemetry(generationConfig, {
        event: "provider_finished",
        profile,
        provider: "gemini",
        model: geminiModel,
        timeoutMs: callRuntime.fastFallbackTimeoutMs,
        durationMs: geminiLatencyMs,
        fallbackTriggered: false,
      });
      emitTelemetry(generationConfig, {
        event: "final_provider",
        profile,
        provider: "gemini",
        model: geminiModel,
        fallbackTriggered: false,
      });
      return {
        text: response,
        provider: "gemini",
        model: geminiModel,
        fallbackUsed: false,
        responseMode: "ai",
        geminiLatencyMs,
        nvidiaLatencyMs: undefined,
        totalLatencyMs: Date.now() - requestStartedAt,
        offlineFallbackUsed: false,
        geminiSkippedDueToCooldown: false,
      };
    } catch (error) {
      geminiLatencyMs = Date.now() - geminiStartedAt;
      const geminiErrorKind = getGeminiErrorCategory(error) === "timeout" ? "timeout" : isGeminiQuotaError(error) ? "quota" : isGeminiBusyError(error) ? "busy" : "request";
      providerFailureCategory = geminiErrorKind;
      recordGeminiFailure(geminiErrorKind);
      devLog("gemini attempt failed", { profile, errorKind: geminiErrorKind, latencyMs: geminiLatencyMs });
      emitTelemetry(generationConfig, {
        event: "provider_failed",
        profile,
        provider: "gemini",
        model: geminiModel,
        timeoutMs: callRuntime.fastFallbackTimeoutMs,
        durationMs: geminiLatencyMs,
        errorKind: geminiErrorKind,
      });
    }
  } else if (geminiSkippedDueToCooldown) {
    devLog("gemini skipped due to cooldown", { profile, cooldownUntil: geminiCircuitBreaker.cooldownUntil });
  }

  const nvidiaStartedAt = Date.now();
  const elapsedBeforeNvidiaMs = nvidiaStartedAt - requestStartedAt;
  console.log("[REVISION-TRACE] fallback triggered", {
    profile,
    fromProvider: "gemini",
    toProvider: "nvidia",
    model: nvidiaModel,
    geminiSkippedDueToCooldown,
    elapsedBeforeNvidiaMs,
    providerChainTimeoutMs,
    callRuntimeTimeoutMs: callRuntime.timeoutMs,
    remainingBudgetMs: providerChainTimeoutMs - elapsedBeforeNvidiaMs,
  });
  devLog("fallback triggered", { profile, fromProvider: "gemini", toProvider: "nvidia", model: nvidiaModel, geminiSkippedDueToCooldown, elapsedBeforeNvidiaMs });
  emitTelemetry(generationConfig, {
    event: "fallback_triggered",
    profile,
    provider: "nvidia",
    model: nvidiaModel,
    timeoutMs: callRuntime.timeoutMs,
    fallbackTriggered: true,
  });
  emitTelemetry(generationConfig, {
    event: "provider_started",
    profile,
    provider: "nvidia",
    model: nvidiaModel,
    timeoutMs: callRuntime.timeoutMs,
    fallbackTriggered: true,
  });

  const remainingBudgetMs = providerChainTimeoutMs - elapsedBeforeNvidiaMs;
  const MIN_NVIDIA_BUDGET_MS = 3000;
  let nvidiaTimeoutMs: number;
  let abortReason: string | null = null;

  if (remainingBudgetMs < MIN_NVIDIA_BUDGET_MS) {
    nvidiaTimeoutMs = 0;
    abortReason = "insufficient_budget";
    console.log("[REVISION-TRACE] NVIDIA skipped: remaining budget below minimum", {
      profile,
      providerChainTimeoutMs,
      elapsedBeforeNvidiaMs,
      remainingBudgetMs,
      minBudgetMs: MIN_NVIDIA_BUDGET_MS,
    });
    devLog("NVIDIA skipped: remaining budget below minimum", {
      profile,
      providerChainTimeoutMs,
      elapsedBeforeNvidiaMs,
      remainingBudgetMs,
      minBudgetMs: MIN_NVIDIA_BUDGET_MS,
    });
  } else {
    nvidiaTimeoutMs = remainingBudgetMs;
    abortReason = null;
  }

  console.log("[REVISION-TRACE] NVIDIA timeout computed", {
    profile,
    providerChainTimeoutMs,
    elapsedBeforeNvidiaMs,
    computedNvidiaTimeoutMs: nvidiaTimeoutMs,
    minBudgetMs: MIN_NVIDIA_BUDGET_MS,
    abortReason,
  });
  devLog("NVIDIA timeout computed", {
    profile,
    providerChainTimeoutMs,
    elapsedBeforeNvidiaMs,
    computedNvidiaTimeoutMs: nvidiaTimeoutMs,
    minBudgetMs: MIN_NVIDIA_BUDGET_MS,
    abortReason,
  });

  if (nvidiaTimeoutMs === 0) {
    nvidiaLatencyMs = Date.now() - nvidiaStartedAt;
    const totalLatencyMs = Date.now() - requestStartedAt;
    return {
      text: "",
      provider: "nvidia",
      model: nvidiaModel,
      fallbackUsed: true,
      fallbackProvider: "nvidia",
      fallbackModel: nvidiaModel,
      responseMode: "offline_fallback",
      providerFailureCategory: "timeout",
      geminiLatencyMs,
      nvidiaLatencyMs,
      totalLatencyMs,
      offlineFallbackUsed: true,
      geminiSkippedDueToCooldown,
    };
  }

  try {
    const actualNvidiaTimeoutMs = nvidiaTimeoutMs;
    console.log("[REVISION-TRACE] calling askNvidia", {
      profile,
      actualNvidiaTimeoutMs,
      providerGenerationConfigTimeoutMs: providerGenerationConfig.timeoutMs,
      callRuntimeTimeoutMs: callRuntime.timeoutMs,
    });
    const response = await askNvidia(
      prompt,
      { ...providerGenerationConfig, timeoutMs: nvidiaTimeoutMs },
      callRuntime,
    );
    nvidiaLatencyMs = Date.now() - nvidiaStartedAt;
    console.log("[REVISION-TRACE] NVIDIA completed", {
      profile,
      nvidiaLatencyMs,
      actualNvidiaTimeoutMs,
    });
    devLog("final provider used", { profile, provider: "nvidia", model: nvidiaModel, fallbackTriggered: true });
    devLog("NVIDIA timeout enforcement", {
      profile,
      actualNvidiaTimeoutMs,
      nvidiaDurationMs: nvidiaLatencyMs,
      abortReason: "completed",
    });
    emitTelemetry(generationConfig, {
      event: "provider_finished",
      profile,
      provider: "nvidia",
      model: nvidiaModel,
      timeoutMs: actualNvidiaTimeoutMs,
      durationMs: nvidiaLatencyMs,
      fallbackTriggered: true,
    });
    emitTelemetry(generationConfig, {
      event: "final_provider",
      profile,
      provider: "nvidia",
      model: nvidiaModel,
      fallbackTriggered: true,
    });
    return {
      text: response,
      provider: "nvidia",
      model: nvidiaModel,
      fallbackUsed: true,
      fallbackProvider: "nvidia",
      fallbackModel: nvidiaModel,
      responseMode: "ai",
      providerFailureCategory,
      geminiLatencyMs,
      nvidiaLatencyMs,
      totalLatencyMs: Date.now() - requestStartedAt,
      offlineFallbackUsed: false,
      geminiSkippedDueToCooldown,
    };
  } catch (nvidiaError) {
    nvidiaLatencyMs = Date.now() - nvidiaStartedAt;
    const nvidiaErrorKind = nvidiaError instanceof AIProviderError ? nvidiaError.kind : "request";
    providerFailureCategory = nvidiaErrorKind;
    devLog("nvidia fallback failed", { profile, errorKind: nvidiaErrorKind, latencyMs: nvidiaLatencyMs });
    devLog("NVIDIA timeout enforcement", {
      profile,
      actualNvidiaTimeoutMs: nvidiaTimeoutMs,
      nvidiaDurationMs: nvidiaLatencyMs,
      abortReason: nvidiaErrorKind === "timeout" ? "timeout" : "error",
    });
    emitTelemetry(generationConfig, {
      event: "provider_failed",
      profile,
      provider: "nvidia",
      model: nvidiaModel,
      timeoutMs: nvidiaTimeoutMs,
      durationMs: nvidiaLatencyMs,
      errorKind: nvidiaErrorKind,
      fallbackTriggered: true,
    });
    return {
      text: "",
      provider: "nvidia",
      model: nvidiaModel,
      fallbackUsed: true,
      fallbackProvider: "nvidia",
      fallbackModel: nvidiaModel,
      responseMode: "offline_fallback",
      providerFailureCategory: nvidiaErrorKind,
      geminiLatencyMs,
      nvidiaLatencyMs,
      totalLatencyMs: Date.now() - requestStartedAt,
      offlineFallbackUsed: true,
      geminiSkippedDueToCooldown,
    };
  }
}

export async function generateAITextWithMetadata(prompt: string, generationConfig?: TextGenerationConfig): Promise<AIProviderResult> {
  return generateAITextForProfile("default", prompt, generationConfig);
}

export async function generateRevisionAITextWithMetadata(prompt: string, generationConfig?: TextGenerationConfig): Promise<AIProviderResult> {
  return generateAITextForProfile("revision", prompt, generationConfig);
}

export async function generateSummaryAITextWithMetadata(prompt: string, generationConfig?: TextGenerationConfig): Promise<AIProviderResult> {
  return generateAITextForProfile("summary", prompt, generationConfig);
}

export async function generateAIText(prompt: string, generationConfig?: TextGenerationConfig): Promise<string> {
  return (await generateAITextWithMetadata(prompt, generationConfig)).text;
}

export async function generateSummaryAIText(prompt: string, generationConfig?: TextGenerationConfig): Promise<string> {
  return (await generateSummaryAITextWithMetadata(prompt, generationConfig)).text;
}

const DEFAULT_NVIDIA_VISION_TIMEOUT_MS = 180_000;
const DEFAULT_NVIDIA_VISION_MODEL = "meta/llama-3.2-11b-vision-instruct";
const VISION_TIMEOUT_MESSAGE = "Vision extraction is taking longer than expected. Try fewer pages or switch to faster model.";

class VisionProviderError extends Error {
  kind: VisionErrorKind;
  provider: Exclude<VisionProvider, "auto">;
  status?: number;

  constructor(
    message: string,
    kind: VisionErrorKind,
    provider: Exclude<VisionProvider, "auto">,
    options?: { status?: number },
  ) {
    super(message);
    this.name = "VisionProviderError";
    this.kind = kind;
    this.provider = provider;
    this.status = options?.status;
  }
}

function getNvidiaVisionConfig() {
  const apiKey = process.env.NVIDIA_VISION_API_KEY || process.env.NVIDIA_API_KEY;
  const baseUrl = (process.env.NVIDIA_VISION_BASE_URL || process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
  const model = process.env.NVIDIA_VISION_MODEL || DEFAULT_NVIDIA_VISION_MODEL;
  const timeoutMs = configuredTimeout(process.env.NVIDIA_VISION_TIMEOUT_MS, DEFAULT_NVIDIA_VISION_TIMEOUT_MS);
  return { apiKey, baseUrl, model, timeoutMs };
}

function classifyVisionProviderError(status: number, detail: string): VisionErrorKind {
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

  if (status === 400 && (lower.includes("model") || lower.includes("vision") || lower.includes("image") || lower.includes("multimodal"))) {
    return "unavailable";
  }

  return "request";
}

async function parseNvidiaVisionResponse(response: Response) {
  const raw = await response.text();

  if (!response.ok) {
    const kind = classifyVisionProviderError(response.status, raw);
    if (kind === "busy") {
      throw new VisionProviderError("NVIDIA Vision service is busy. Please try again in a few seconds.", "busy", "nvidia-vision", {
        status: response.status,
      });
    }
    if (kind === "quota") {
      throw new VisionProviderError("NVIDIA Vision quota reached. Please try again later.", "quota", "nvidia-vision", {
        status: response.status,
      });
    }
    if (kind === "auth") {
      throw new VisionProviderError("NVIDIA Vision authentication failed. Check your API key.", "auth", "nvidia-vision", {
        status: response.status,
      });
    }
    if (kind === "unavailable") {
      throw new VisionProviderError("The configured NVIDIA model does not support vision input.", "unavailable", "nvidia-vision", {
        status: response.status,
      });
    }
    throw new VisionProviderError("NVIDIA Vision request failed. Please try again.", "request", "nvidia-vision", {
      status: response.status,
    });
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new VisionProviderError("NVIDIA Vision returned an unreadable response.", "request", "nvidia-vision");
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

  throw new VisionProviderError("NVIDIA Vision returned an empty response.", "empty", "nvidia-vision");
}

async function askNvidiaVision(
  prompt: string,
  imageData: Buffer,
  mimeType: string,
  generationConfig: VisionGenerationConfig = {},
) {
  const { apiKey, baseUrl, model, timeoutMs } = getNvidiaVisionConfig();
  if (!apiKey) {
    throw new VisionProviderError("NVIDIA Vision service is not configured. Add NVIDIA_VISION_API_KEY in .env.local.", "config", "nvidia-vision");
  }

  const temperature = generationConfig.temperature ?? 0.25;
  const maxTokens = generationConfig.maxOutputTokens ?? 4096;
  const callerTimeoutMs = generationConfig.timeoutMs;
  const effectiveTimeoutMs = callerTimeoutMs && Number.isFinite(callerTimeoutMs) && callerTimeoutMs >= 1000
    ? Math.min(Math.round(callerTimeoutMs), timeoutMs)
    : timeoutMs;
  const startedAt = Date.now();

  devLog("nvidia-vision provider started", { model, timeoutMs: effectiveTimeoutMs, mimeType });

  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(generationConfig.signal?.reason);
  if (generationConfig.signal?.aborted) onExternalAbort();
  else generationConfig.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);

  try {
    const base64Image = imageData.toString("base64");
    const requestBody: Record<string, unknown> = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          ],
        },
      ],
      temperature,
      max_tokens: maxTokens,
    };

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    generationConfig.signal?.removeEventListener("abort", onExternalAbort);

    if (response.ok) {
      devLog("nvidia-vision provider duration", { model, durationMs: Date.now() - startedAt });
      return await parseNvidiaVisionResponse(response);
    }

    const raw = await response.text();
    const kind = classifyVisionProviderError(response.status, raw);

    if (kind === "busy") {
      devLog("nvidia-vision provider duration", { model, durationMs: Date.now() - startedAt });
      throw new VisionProviderError("NVIDIA Vision service is busy. Please try again in a few seconds.", "busy", "nvidia-vision", { status: response.status });
    }
    if (kind === "quota") {
      devLog("nvidia-vision provider duration", { model, durationMs: Date.now() - startedAt });
      throw new VisionProviderError("NVIDIA Vision quota reached. Please try again later.", "quota", "nvidia-vision", { status: response.status });
    }
    if (kind === "auth") {
      devLog("nvidia-vision provider duration", { model, durationMs: Date.now() - startedAt });
      throw new VisionProviderError("NVIDIA Vision authentication failed. Check your API key.", "auth", "nvidia-vision", { status: response.status });
    }
    if (kind === "unavailable") {
      devLog("nvidia-vision provider duration", { model, durationMs: Date.now() - startedAt });
      throw new VisionProviderError("The configured NVIDIA model does not support vision input.", "unavailable", "nvidia-vision", { status: response.status });
    }
    devLog("nvidia-vision provider duration", { model, durationMs: Date.now() - startedAt });
    throw new VisionProviderError("NVIDIA Vision request failed. Please try again.", "request", "nvidia-vision", { status: response.status });
  } catch (error) {
    clearTimeout(timeout);
    generationConfig.signal?.removeEventListener("abort", onExternalAbort);

    if (error instanceof VisionProviderError) {
      devLog("nvidia-vision provider duration", { model, durationMs: Date.now() - startedAt });
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      if (generationConfig.signal?.aborted) {
        throw new VisionProviderError("Vision request was cancelled.", "cancelled", "nvidia-vision");
      }
      if (!timedOut) throw new VisionProviderError("NVIDIA Vision request failed. Please try again.", "request", "nvidia-vision");
      throw new VisionProviderError(VISION_TIMEOUT_MESSAGE, "timeout", "nvidia-vision");
    }
    throw error;
  }
}

function emitVisionTelemetry(generationConfig: VisionGenerationConfig | undefined, event: VisionProviderTelemetryEvent) {
  try {
    logProviderTelemetry(event as unknown as AIProviderTelemetryEvent);
    generationConfig?.telemetry?.(event);
  } catch {
    // Telemetry must never affect AI generation.
  }
}

function shouldFallbackFromGeminiVision(error: unknown): boolean {
  const category = getGeminiErrorCategory(error);
  return category === "quota" || category === "timeout" || category === "busy" || category === "model" || category === "request";
}

export async function extractWithVision(
  prompt: string,
  imageData: Buffer,
  mimeType: string,
  generationConfig: VisionGenerationConfig = {},
): Promise<{ text: string; provider: Exclude<VisionProvider, "auto">; model: string }> {
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const { model: nvidiaVisionModel } = getNvidiaVisionConfig();

  const visionConfig = {
    temperature: generationConfig.temperature,
    maxOutputTokens: generationConfig.maxOutputTokens,
    timeoutMs: generationConfig.timeoutMs,
    signal: generationConfig.signal,
  };

  devLog("vision extraction selected", { primaryProvider: "gemini", fallbackProvider: "nvidia-vision" });
  emitVisionTelemetry(generationConfig, {
    event: "selected",
    provider: "auto",
    model: geminiModel,
    timeoutMs: generationConfig.timeoutMs,
  });

  const startedAt = Date.now();
  try {
    devLog("vision provider started", { provider: "gemini", model: geminiModel, timeoutMs: generationConfig.timeoutMs });
    emitVisionTelemetry(generationConfig, { event: "provider_started", provider: "gemini", model: geminiModel, timeoutMs: generationConfig.timeoutMs });

    const { askGeminiWithInlineData } = await import("./gemini");
    const response = await askGeminiWithInlineData({
      prompt,
      mimeType,
      data: imageData,
      maxOutputTokens: visionConfig.maxOutputTokens ?? 4096,
      timeoutMs: visionConfig.timeoutMs,
    });

    devLog("vision final provider used", { provider: "gemini", model: geminiModel, fallbackTriggered: false });
    emitVisionTelemetry(generationConfig, {
      event: "provider_finished",
      provider: "gemini",
      model: geminiModel,
      timeoutMs: generationConfig.timeoutMs,
      durationMs: Date.now() - startedAt,
      fallbackTriggered: false,
    });
    emitVisionTelemetry(generationConfig, {
      event: "final_provider",
      provider: "gemini",
      model: geminiModel,
      fallbackTriggered: false,
    });
    return { text: response, provider: "gemini", model: geminiModel };
  } catch (error) {
    emitVisionTelemetry(generationConfig, {
      event: "provider_failed",
      provider: "gemini",
      model: geminiModel,
      timeoutMs: generationConfig.timeoutMs,
      durationMs: Date.now() - startedAt,
      errorKind: getGeminiErrorCategory(error) === "timeout" ? "timeout" : "gemini",
    });

    const fallbackAllowed = shouldFallbackFromGeminiVision(error);
    if (!fallbackAllowed || generationConfig.disableProviderFallback) throw error;

    try {
      devLog("vision fallback triggered", { fromProvider: "gemini", toProvider: "nvidia-vision", model: nvidiaVisionModel });
      emitVisionTelemetry(generationConfig, {
        event: "fallback_triggered",
        provider: "nvidia-vision",
        model: nvidiaVisionModel,
        timeoutMs: generationConfig.timeoutMs,
        fallbackTriggered: true,
      });
      const fallbackStartedAt = Date.now();
      emitVisionTelemetry(generationConfig, {
        event: "provider_started",
        provider: "nvidia-vision",
        model: nvidiaVisionModel,
        timeoutMs: generationConfig.timeoutMs,
        fallbackTriggered: true,
      });

      const response = await askNvidiaVision(prompt, imageData, mimeType, visionConfig);

      devLog("vision final provider used", { provider: "nvidia-vision", model: nvidiaVisionModel, fallbackTriggered: true });
      emitVisionTelemetry(generationConfig, {
        event: "provider_finished",
        provider: "nvidia-vision",
        model: nvidiaVisionModel,
        timeoutMs: generationConfig.timeoutMs,
        durationMs: Date.now() - fallbackStartedAt,
        fallbackTriggered: true,
      });
      emitVisionTelemetry(generationConfig, {
        event: "final_provider",
        provider: "nvidia-vision",
        model: nvidiaVisionModel,
        fallbackTriggered: true,
      });
      return { text: response, provider: "nvidia-vision", model: nvidiaVisionModel };
    } catch (fallbackError) {
      emitVisionTelemetry(generationConfig, {
        event: "provider_failed",
        provider: "nvidia-vision",
        model: nvidiaVisionModel,
        timeoutMs: generationConfig.timeoutMs,
        errorKind: fallbackError instanceof VisionProviderError ? fallbackError.kind : "request",
        fallbackTriggered: true,
      });
      throw new VisionProviderError("Both vision providers are unavailable. Please try again shortly.", "unavailable", "nvidia-vision");
    }
  }
}

export function isVisionAvailable(): { gemini: boolean; nvidiaVision: boolean } {
  const geminiAvailable = Boolean(process.env.GEMINI_API_KEY);
  const { apiKey: nvidiaVisionKey } = getNvidiaVisionConfig();
  const nvidiaVisionAvailable = Boolean(nvidiaVisionKey);
  return { gemini: geminiAvailable, nvidiaVision: nvidiaVisionAvailable };
}

export function getVisionProviderRuntimeInfo() {
  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const { model: nvidiaVisionModel, timeoutMs } = getNvidiaVisionConfig();
  return {
    primaryProvider: "gemini",
    primaryModel: geminiModel,
    fallbackProvider: "nvidia-vision",
    fallbackModel: nvidiaVisionModel,
    timeoutMs,
  };
}

export function isVisionQuotaError(error: unknown): boolean {
  return (
    isGeminiQuotaError(error) ||
    (error instanceof VisionProviderError && error.kind === "quota")
  );
}

export function isVisionTimeoutError(error: unknown): boolean {
  return (
    getGeminiErrorCategory(error) === "timeout" ||
    (error instanceof VisionProviderError && error.kind === "timeout")
  );
}

export function isVisionBusyError(error: unknown): boolean {
  return (
    isGeminiBusyError(error) ||
    (error instanceof VisionProviderError && (error.kind === "busy" || error.kind === "timeout"))
  );
}

export function getVisionUserMessage(error: unknown): string {
  if (error instanceof VisionProviderError) {
    if (error.kind === "busy") return "Vision service is busy. Please try again in a few seconds.";
    if (error.kind === "quota") return "Vision quota reached. Please try again later.";
    if (error.kind === "config") return error.message;
    if (error.kind === "auth") return "Vision authentication failed. Check your API key.";
    if (error.kind === "empty") return "Vision returned an empty response. Please try again.";
    if (error.kind === "timeout") return error.message;
    if (error.kind === "cancelled") return "Vision request was cancelled.";
    if (error.kind === "unavailable") return "Vision model does not support this request.";
  }
  return getGeminiUserMessage(error);
}
