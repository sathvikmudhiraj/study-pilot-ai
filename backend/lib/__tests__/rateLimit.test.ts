import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { consumeAiRateLimit, enforceAiRateLimit, resetAiRateLimitForTests } from "../rateLimit";

describe("AI rate limiting", () => {
  beforeEach(() => {
    resetAiRateLimitForTests();
    vi.stubEnv("AI_RATE_LIMIT_MAX_REQUESTS", "2");
    vi.stubEnv("AI_RATE_LIMIT_WINDOW_MS", "1000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetAiRateLimitForTests();
  });

  it("limits requests per authenticated user and resets after the window", () => {
    expect(consumeAiRateLimit("user-a", 1_000).allowed).toBe(true);
    expect(consumeAiRateLimit("user-a", 1_100).allowed).toBe(true);
    expect(consumeAiRateLimit("user-a", 1_200).allowed).toBe(false);
    expect(consumeAiRateLimit("user-b", 1_200).allowed).toBe(true);
    expect(consumeAiRateLimit("user-a", 2_001).allowed).toBe(true);
  });

  it("returns a sanitized 429 response with retry headers", async () => {
    consumeAiRateLimit("user-a", Date.now());
    consumeAiRateLimit("user-a", Date.now());

    const response = enforceAiRateLimit("user-a");
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toMatch(/^\d+$/);
    await expect(response?.json()).resolves.toEqual({ error: "Too many AI requests. Please wait before trying again." });
  });
});
