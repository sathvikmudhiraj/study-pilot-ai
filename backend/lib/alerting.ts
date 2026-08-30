import "server-only";

import { externalMonitoringConfigured, sendExternalAlert } from "./externalMonitoring";
import { readMonitoringEvents, recordMonitoringEvent, type MonitoringEventRow } from "./monitoring";
import type { RequestId } from "./observability";

export type AlertCategory =
  | "readiness_failed"
  | "database_unhealthy"
  | "storage_unhealthy"
  | "ai_provider_unhealthy"
  | "ai_configuration_invalid"
  | "critical_errors_repeated";

type AlertSeverity = "info" | "warning" | "error";

type DependencyAlertInput = {
  category: Exclude<AlertCategory, "critical_errors_repeated">;
  requestId?: RequestId | string | null;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  provider?: string | null;
  model?: string | null;
  errorCategory?: string | null;
  metadata?: Record<string, unknown>;
};

type ReadinessCheck = { status: string; detail?: string };

type ReadinessAlertInput = {
  requestId?: RequestId | string | null;
  route: string;
  method: string;
  status: number;
  checks: {
    database?: ReadinessCheck;
    storage?: ReadinessCheck;
    aiConfiguration?: ReadinessCheck;
  };
};

type CriticalErrorInput = {
  requestId?: RequestId | string | null;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  errorCategory?: string | null;
  metadata?: Record<string, unknown>;
};

export type AlertAttemptResult = {
  configured: boolean;
  sent: boolean;
  suppressed: boolean;
  delivered: boolean;
  fingerprint: string;
};

const DEFAULT_ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const DEFAULT_CRITICAL_ERROR_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_CRITICAL_ERROR_THRESHOLD = 3;
const MAX_RECENT_EVENTS = 200;

function numericEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function alertCooldownMs() {
  return numericEnv("STUDYPILOT_ALERT_COOLDOWN_MS", DEFAULT_ALERT_COOLDOWN_MS, 60_000, 86_400_000);
}

function criticalErrorWindowMs() {
  return numericEnv("STUDYPILOT_CRITICAL_ERROR_WINDOW_MS", DEFAULT_CRITICAL_ERROR_WINDOW_MS, 60_000, 3_600_000);
}

function criticalErrorThreshold() {
  return numericEnv("STUDYPILOT_CRITICAL_ERROR_THRESHOLD", DEFAULT_CRITICAL_ERROR_THRESHOLD, 2, 100);
}

function isRecent(createdAt: string, windowMs: number) {
  return Date.now() - new Date(createdAt).getTime() <= windowMs;
}

function metadataFingerprint(event: MonitoringEventRow) {
  const value = event.metadata?.fingerprint;
  return typeof value === "string" ? value : null;
}

function criticalFingerprint(input: CriticalErrorInput) {
  return [
    "critical",
    input.route || "unknown-route",
    input.method || "unknown-method",
    input.errorCategory || "unknown-error",
  ].join(":");
}

function dependencyFingerprint(input: DependencyAlertInput) {
  return [
    "dependency",
    input.category,
    input.route || "unknown-route",
    input.provider || "no-provider",
    input.errorCategory || "no-error-category",
  ].join(":");
}

async function recentEvents() {
  try {
    return await readMonitoringEvents(MAX_RECENT_EVENTS);
  } catch {
    return [];
  }
}

async function alertRecentlySent(fingerprint: string, cooldownMs: number) {
  const events = await recentEvents();
  return events.some((event) =>
    (event.event_type === "external.alert.sent" || event.event_type === "external.alert.failed")
    && metadataFingerprint(event) === fingerprint
    && isRecent(event.created_at, cooldownMs)
  );
}

function criticalEventMatches(event: MonitoringEventRow, fingerprint: string) {
  if (event.event_type !== "request.failed") return false;
  const eventFingerprint = [
    "critical",
    event.route || "unknown-route",
    event.method || "unknown-method",
    event.error_category || "unknown-error",
  ].join(":");
  return eventFingerprint === fingerprint;
}

async function sendDedupedAlert(input: {
  category: AlertCategory;
  severity: AlertSeverity;
  message: string;
  fingerprint: string;
  requestId?: RequestId | string | null;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  provider?: string | null;
  model?: string | null;
  errorCategory?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AlertAttemptResult> {
  const configured = externalMonitoringConfigured();
  const suppressed = configured ? await alertRecentlySent(input.fingerprint, alertCooldownMs()) : false;
  if (!configured || suppressed) {
    return {
      configured,
      sent: false,
      suppressed,
      delivered: false,
      fingerprint: input.fingerprint,
    };
  }

  const delivered = await sendExternalAlert({
    source: "server",
    severity: input.severity,
    message: input.message,
    category: input.category,
    requestId: input.requestId ?? null,
    route: input.route ?? null,
    method: input.method ?? null,
    status: input.status ?? null,
    metadata: {
      alertCategory: input.category,
      fingerprint: input.fingerprint,
      provider: input.provider ?? null,
      model: input.model ?? null,
      errorCategory: input.errorCategory ?? null,
      ...(input.metadata ?? {}),
    },
  });

  await recordMonitoringEvent({
    requestId: input.requestId ?? null,
    eventType: delivered ? "external.alert.sent" : "external.alert.failed",
    route: input.route ?? null,
    method: input.method ?? null,
    status: input.status ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    errorCategory: input.errorCategory ?? input.category,
    metadata: {
      alertCategory: input.category,
      fingerprint: input.fingerprint,
      delivered,
      suppressForMs: alertCooldownMs(),
    },
  });

  return {
    configured,
    sent: true,
    suppressed: false,
    delivered,
    fingerprint: input.fingerprint,
  };
}

export async function alertDependencyFailure(input: DependencyAlertInput): Promise<AlertAttemptResult> {
  const severity: AlertSeverity = input.category === "readiness_failed" ? "warning" : "error";
  return sendDedupedAlert({
    category: input.category,
    severity,
    message: `StudyPilot dependency alert: ${input.category}`,
    fingerprint: dependencyFingerprint(input),
    requestId: input.requestId,
    route: input.route,
    method: input.method,
    status: input.status,
    provider: input.provider,
    model: input.model,
    errorCategory: input.errorCategory ?? input.category,
    metadata: input.metadata,
  });
}

export async function alertReadinessFailures(input: ReadinessAlertInput): Promise<void> {
  const failedEntries = Object.entries(input.checks).filter(([, check]) => check && check.status !== "ok");
  if (failedEntries.length === 0) return;

  await alertDependencyFailure({
    category: "readiness_failed",
    requestId: input.requestId,
    route: input.route,
    method: input.method,
    status: input.status,
    errorCategory: "readiness",
    metadata: { failedComponents: failedEntries.map(([name]) => name) },
  });

  for (const [component, check] of failedEntries) {
    if (!check) continue;
    const category =
      component === "database"
        ? "database_unhealthy"
        : component === "storage"
          ? "storage_unhealthy"
          : "ai_configuration_invalid";
    await alertDependencyFailure({
      category,
      requestId: input.requestId,
      route: input.route,
      method: input.method,
      status: input.status,
      errorCategory: check.status,
      metadata: {
        component,
        status: check.status,
        detail: check.detail ?? null,
      },
    });
  }
}

export async function alertRepeatedCriticalError(input: CriticalErrorInput): Promise<AlertAttemptResult> {
  const fingerprint = criticalFingerprint(input);
  const events = await recentEvents();
  const windowMs = criticalErrorWindowMs();
  const matchingRecentEvents = events.filter((event) => criticalEventMatches(event, fingerprint) && isRecent(event.created_at, windowMs));
  const countIncludingCurrent = matchingRecentEvents.length + 1;
  if (countIncludingCurrent < criticalErrorThreshold()) {
    return {
      configured: externalMonitoringConfigured(),
      sent: false,
      suppressed: false,
      delivered: false,
      fingerprint,
    };
  }

  return sendDedupedAlert({
    category: "critical_errors_repeated",
    severity: "error",
    message: "StudyPilot repeated critical application errors detected.",
    fingerprint,
    requestId: input.requestId,
    route: input.route,
    method: input.method,
    status: input.status ?? 500,
    errorCategory: input.errorCategory ?? "critical",
    metadata: {
      recentCount: countIncludingCurrent,
      threshold: criticalErrorThreshold(),
      windowMs,
      ...(input.metadata ?? {}),
    },
  });
}
