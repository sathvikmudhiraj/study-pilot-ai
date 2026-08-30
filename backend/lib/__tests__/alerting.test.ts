import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  externalMonitoringConfigured: vi.fn(),
  sendExternalAlert: vi.fn(),
  readMonitoringEvents: vi.fn(),
  recordMonitoringEvent: vi.fn(),
}));

vi.mock("../externalMonitoring", () => ({
  externalMonitoringConfigured: mocks.externalMonitoringConfigured,
  sendExternalAlert: mocks.sendExternalAlert,
}));

vi.mock("../monitoring", () => ({
  readMonitoringEvents: mocks.readMonitoringEvents,
  recordMonitoringEvent: mocks.recordMonitoringEvent,
}));

import {
  alertDependencyFailure,
  alertReadinessFailures,
  alertRepeatedCriticalError,
} from "../alerting";
import type { MonitoringEventRow } from "../monitoring";

function event(partial: Partial<MonitoringEventRow>): MonitoringEventRow {
  return {
    id: "event-1",
    request_id: null,
    event_type: "request.failed",
    route: "/api/test",
    method: "GET",
    status: 500,
    duration_ms: 10,
    provider: null,
    model: null,
    retry_count: null,
    fallback_used: null,
    error_category: "Error",
    metadata: {},
    created_at: new Date().toISOString(),
    ...partial,
  };
}

describe("external alerting coordinator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.externalMonitoringConfigured.mockReturnValue(true);
    mocks.sendExternalAlert.mockResolvedValue(true);
    mocks.readMonitoringEvents.mockResolvedValue([]);
    mocks.recordMonitoringEvent.mockResolvedValue(undefined);
  });

  it("sends a direct dependency alert and records delivery", async () => {
    const result = await alertDependencyFailure({
      category: "database_unhealthy",
      route: "/api/health/ready",
      method: "GET",
      status: 503,
      errorCategory: "down",
      metadata: { detail: "Database connectivity check failed." },
    });

    expect(result).toMatchObject({ configured: true, sent: true, delivered: true, suppressed: false });
    expect(mocks.sendExternalAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendExternalAlert.mock.calls[0][0]).toMatchObject({
      category: "database_unhealthy",
      route: "/api/health/ready",
      status: 503,
    });
    expect(mocks.recordMonitoringEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "external.alert.sent",
      errorCategory: "down",
    }));
  });

  it("dedupes dependency alerts during the cooldown window", async () => {
    mocks.readMonitoringEvents.mockResolvedValue([
      event({
        event_type: "external.alert.sent",
        metadata: {
          fingerprint: "dependency:storage_unhealthy:/api/health/ready:no-provider:down",
        },
      }),
    ]);

    const result = await alertDependencyFailure({
      category: "storage_unhealthy",
      route: "/api/health/ready",
      method: "GET",
      status: 503,
      errorCategory: "down",
    });

    expect(result).toMatchObject({ sent: false, suppressed: true });
    expect(mocks.sendExternalAlert).not.toHaveBeenCalled();
  });

  it("dedupes recently failed webhook attempts during the cooldown window", async () => {
    mocks.readMonitoringEvents.mockResolvedValue([
      event({
        event_type: "external.alert.failed",
        metadata: {
          fingerprint: "dependency:database_unhealthy:/api/health/ready:no-provider:down",
        },
      }),
    ]);

    const result = await alertDependencyFailure({
      category: "database_unhealthy",
      route: "/api/health/ready",
      method: "GET",
      status: 503,
      errorCategory: "down",
    });

    expect(result).toMatchObject({ sent: false, suppressed: true });
    expect(mocks.sendExternalAlert).not.toHaveBeenCalled();
  });

  it("alerts for each unhealthy readiness component without duplicating the same component", async () => {
    await alertReadinessFailures({
      route: "/api/health/ready",
      method: "GET",
      status: 503,
      checks: {
        database: { status: "down", detail: "Database connectivity check failed." },
        storage: { status: "ok" },
        aiConfiguration: { status: "configuration_error", detail: "One or more AI provider profiles are not configured." },
      },
    });

    const categories = mocks.sendExternalAlert.mock.calls.map(([input]) => input.category);
    expect(categories).toEqual([
      "readiness_failed",
      "database_unhealthy",
      "ai_configuration_invalid",
    ]);
  });

  it("does not alert below the repeated-critical threshold", async () => {
    mocks.readMonitoringEvents.mockResolvedValue([
      event({ route: "/api/test", method: "GET", error_category: "Error" }),
    ]);

    const result = await alertRepeatedCriticalError({
      route: "/api/test",
      method: "GET",
      status: 500,
      errorCategory: "Error",
    });

    expect(result).toMatchObject({ sent: false, suppressed: false });
    expect(mocks.sendExternalAlert).not.toHaveBeenCalled();
  });

  it("sends exactly one threshold alert when critical errors cross the threshold", async () => {
    mocks.readMonitoringEvents.mockResolvedValue([
      event({ route: "/api/test", method: "GET", error_category: "Error" }),
      event({ id: "event-2", route: "/api/test", method: "GET", error_category: "Error" }),
    ]);

    const result = await alertRepeatedCriticalError({
      route: "/api/test",
      method: "GET",
      status: 500,
      errorCategory: "Error",
    });

    expect(result).toMatchObject({ sent: true, delivered: true });
    expect(mocks.sendExternalAlert).toHaveBeenCalledTimes(1);
    expect(mocks.sendExternalAlert.mock.calls[0][0]).toMatchObject({
      category: "critical_errors_repeated",
      route: "/api/test",
    });
  });

  it("suppresses repeated threshold alerts during cooldown", async () => {
    mocks.readMonitoringEvents.mockResolvedValue([
      event({ route: "/api/test", method: "GET", error_category: "Error" }),
      event({ id: "event-2", route: "/api/test", method: "GET", error_category: "Error" }),
      event({
        id: "alert-1",
        event_type: "external.alert.sent",
        metadata: { fingerprint: "critical:/api/test:GET:Error" },
      }),
    ]);

    const result = await alertRepeatedCriticalError({
      route: "/api/test",
      method: "GET",
      status: 500,
      errorCategory: "Error",
    });

    expect(result).toMatchObject({ sent: false, suppressed: true });
    expect(mocks.sendExternalAlert).not.toHaveBeenCalled();
  });

  it("allows a new threshold alert after cooldown expires", async () => {
    const oldAlert = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    mocks.readMonitoringEvents.mockResolvedValue([
      event({ route: "/api/test", method: "GET", error_category: "Error" }),
      event({ id: "event-2", route: "/api/test", method: "GET", error_category: "Error" }),
      event({
        id: "alert-1",
        event_type: "external.alert.sent",
        metadata: { fingerprint: "critical:/api/test:GET:Error" },
        created_at: oldAlert,
      }),
    ]);

    const result = await alertRepeatedCriticalError({
      route: "/api/test",
      method: "GET",
      status: 500,
      errorCategory: "Error",
    });

    expect(result).toMatchObject({ sent: true, suppressed: false });
    expect(mocks.sendExternalAlert).toHaveBeenCalledTimes(1);
  });

  it("records failed webhook delivery without throwing", async () => {
    mocks.sendExternalAlert.mockResolvedValue(false);

    await expect(alertDependencyFailure({
      category: "ai_provider_unhealthy",
      provider: "gemini",
      route: "/api/ai/ask",
      method: "POST",
      errorCategory: "quota",
    })).resolves.toMatchObject({ sent: true, delivered: false });

    expect(mocks.recordMonitoringEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "external.alert.failed",
      provider: "gemini",
    }));
  });
});
