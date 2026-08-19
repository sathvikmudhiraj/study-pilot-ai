import { describe, expect, it } from "vitest";
import { getBackgroundJobRetryPlan } from "../backgroundJobs";

describe("background job retry planning", () => {
  it("retries with bounded exponential backoff while attempts remain", () => {
    const plan = getBackgroundJobRetryPlan({ attempt_count: 2, max_attempts: 4 }, Date.UTC(2026, 0, 1));

    expect(plan.shouldRetry).toBe(true);
    expect(plan.finalStatus).toBe("retrying");
    expect(plan.delaySeconds).toBe(40);
    expect(plan.nextRunAt).toBe("2026-01-01T00:00:40.000Z");
  });

  it("caps retry delay at five minutes", () => {
    const plan = getBackgroundJobRetryPlan({ attempt_count: 8, max_attempts: 10 }, Date.UTC(2026, 0, 1));

    expect(plan.shouldRetry).toBe(true);
    expect(plan.delaySeconds).toBe(300);
    expect(plan.nextRunAt).toBe("2026-01-01T00:05:00.000Z");
  });

  it("fails permanently when attempts are exhausted", () => {
    const plan = getBackgroundJobRetryPlan({ attempt_count: 3, max_attempts: 3 }, Date.UTC(2026, 0, 1));

    expect(plan.shouldRetry).toBe(false);
    expect(plan.finalStatus).toBe("failed");
    expect(plan.nextRunAt).toBeNull();
  });
});
