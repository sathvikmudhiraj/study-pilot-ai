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

import { generateAIText } from "../aiProvider";
import { askGemini } from "../gemini";

describe("NVIDIA request budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("AI_PROVIDER", "nvidia");
    vi.stubEnv("NVIDIA_API_KEY", "test-key");
    vi.stubEnv("NVIDIA_TIMEOUT_MS", "180000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("treats a caller timeout as the total budget across 429 retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("rate limited", {
        status: 429,
        headers: { "Retry-After": "30" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateAIText("hello", { timeoutMs: 1_000 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(generation).resolves.toMatchObject({ message: expect.stringMatching(/temporarily unavailable/i) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a hanging request at the caller timeout", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateAIText("hello", { timeoutMs: 1_000 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(generation).resolves.toMatchObject({ message: expect.stringMatching(/temporarily unavailable/i) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

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

    const generation = generateAIText("hello", { timeoutMs: 1_000 }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_001);

    await expect(generation).resolves.toMatchObject({ message: expect.stringMatching(/temporarily unavailable/i) });
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
