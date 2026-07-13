type RateLimitBucket = {
  count: number;
  windowStartedAt: number;
  resetAt: number;
  lastSeenAt: number;
};

type RateLimitStore = {
  buckets: Map<string, RateLimitBucket>;
  operations: number;
};

type RateLimitGlobal = typeof globalThis & {
  __studyPilotFeatureRateLimitStore?: RateLimitStore;
};

export type FeatureRateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const globalWithRateLimits = globalThis as RateLimitGlobal;
const store = globalWithRateLimits.__studyPilotFeatureRateLimitStore ?? {
  buckets: new Map<string, RateLimitBucket>(),
  operations: 0,
};

globalWithRateLimits.__studyPilotFeatureRateLimitStore = store;

function cleanExpiredBuckets(now: number) {
  store.operations += 1;
  if (store.operations % 50 !== 0 && store.buckets.size < 1_000) return;

  for (const [key, bucket] of store.buckets) {
    if (now > bucket.resetAt + 60_000) store.buckets.delete(key);
  }
}

export function consumeFeatureRateLimit({
  key,
  limit,
  windowMs,
  now = Date.now(),
}: {
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}): FeatureRateLimitResult {
  if (!key.trim()) throw new Error("A rate-limit key is required.");
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Rate-limit size must be a positive integer.");
  if (!Number.isSafeInteger(windowMs) || windowMs < 1_000) throw new Error("Rate-limit window must be at least one second.");

  cleanExpiredBuckets(now);

  const existing = store.buckets.get(key);
  const bucket = !existing || now - existing.windowStartedAt >= windowMs
    ? { count: 0, windowStartedAt: now, resetAt: now + windowMs, lastSeenAt: now }
    : existing;

  bucket.lastSeenAt = now;
  const resetAt = bucket.resetAt;

  if (bucket.count >= limit) {
    store.buckets.set(key, bucket);
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1_000)),
    };
  }

  bucket.count += 1;
  store.buckets.set(key, bucket);

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt,
    retryAfterSeconds: 0,
  };
}
