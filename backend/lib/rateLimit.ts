import "server-only";

import { NextResponse } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

type RateLimitStore = Map<string, RateLimitEntry>;

const globalRateLimit = globalThis as typeof globalThis & {
  __studyPilotAiRateLimit?: RateLimitStore;
};

const store = globalRateLimit.__studyPilotAiRateLimit ?? new Map<string, RateLimitEntry>();
globalRateLimit.__studyPilotAiRateLimit = store;

function configuredInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

export function consumeAiRateLimit(userId: string, now = Date.now()) {
  const limit = configuredInteger(process.env.AI_RATE_LIMIT_MAX_REQUESTS, 30, 1, 1_000);
  const windowMs = configuredInteger(process.env.AI_RATE_LIMIT_WINDOW_MS, 60_000, 1_000, 3_600_000);
  const key = `ai:${userId}`;
  const existing = store.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, limit, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { allowed: false, limit, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return { allowed: true, limit, remaining: limit - existing.count, resetAt: existing.resetAt };
}

export function enforceAiRateLimit(userId: string) {
  const result = consumeAiRateLimit(userId);
  if (result.allowed) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000));
  return NextResponse.json(
    { error: "Too many AI requests. Please wait before trying again." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    },
  );
}

export function resetAiRateLimitForTests() {
  store.clear();
}
