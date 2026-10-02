import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../gemini", () => ({
  askGemini: vi.fn(),
  getGeminiErrorCategory: vi.fn(() => "request"),
  getGeminiUserMessage: vi.fn(() => "AI request failed."),
  isGeminiBusyError: vi.fn((error: unknown) => error instanceof Error && error.message === "busy"),
  isGeminiQuotaError: vi.fn(() => false),
}));
vi.mock("../observability", () => ({ logProviderTelemetry: vi.fn() }));

import { generateAITextWithMetadata, getAIProviderRuntimeInfo } from "../aiProvider";
import { askGemini } from "../gemini";

describe("NVIDIA request budget", () => {
  beforeEach(() => {
    vi.stubEnv("AI_PROVIDER", "nvidia");
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    vi.stubEnv("NVIDIA_TIMEOUT_MS", "180000");
    vi.stubEnv("AI_INTERACTIVE_TIMEOUT_MS", "10000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the configured text model instead of NVIDIA_MODEL for text generation", () => {
    vi.stubEnv("AI_PROVIDER", "auto");
    vi.stubEnv("NVIDIA_MODEL", "meta/llama-3.2-11b-vision-instruct");
    vi.stubEnv("NVIDIA_TEXT_MODEL", "nvidia/nemotron-3-super-120b-a12b");

    expect(getAIProviderRuntimeInfo("default").fallbackModel).toBe("nvidia/nemotron-3-super-120b-a12b");
  });

  it("does not retry NVIDIA 429 responses inside the bounded fallback window", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "30" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAITextWithMetadata("hello", { timeoutMs: 1_000 });

    expect(result.offlineFallbackUsed).toBe(true);
    expect(result.text).toBe("");
    expect(result.providerFailureCategory).toBe("quota");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("aborts a hanging request at the caller timeout", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAITextWithMetadata("hello", { timeoutMs: 1_000 });

    expect(result.offlineFallbackUsed).toBe(true);
    expect(result.text).toBe("");
    expect(result.providerFailureCategory).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 10_000);

  it("shares a caller timeout across Gemini and NVIDIA fallback", async () => {
    vi.stubEnv("AI_PROVIDER", "auto");
    vi.mocked(askGemini).mockRejectedValueOnce(new Error("busy"));
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateAITextWithMetadata("hello", { timeoutMs: 5_000 });

    expect(result.offlineFallbackUsed).toBe(true);
    expect(result.text).toBe("");
    expect(result.providerFailureCategory).toBe("timeout");
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }, 10_000);
});
