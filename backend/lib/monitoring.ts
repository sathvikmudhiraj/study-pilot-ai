import "server-only";

import { createAdminSupabaseClient, hasAdminSupabaseEnv } from "./adminSupabase";
import { sanitizeForLogging, type RequestId } from "./observability";

export type MonitoringEventType =
  | "request.started"
  | "request.completed"
  | "request.failed"
  | "ai.provider"
  | "error"
  | "health.failure"
  | "job.started"
  | "job.completed"
  | "job.failed";

export type MonitoringEventInput = {
  requestId?: RequestId | string | null;
  eventType: MonitoringEventType | string;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  durationMs?: number | null;
  provider?: string | null;
  model?: string | null;
  retryCount?: number | null;
  fallbackUsed?: boolean | null;
  errorCategory?: string | null;
  metadata?: Record<string, unknown>;
};

export type MonitoringEventRow = {
  id: string;
  request_id: string | null;
  event_type: string;
  route: string | null;
  method: string | null;
  status: number | null;
  duration_ms: number | null;
  provider: string | null;
  model: string | null;
  retry_count: number | null;
  fallback_used: boolean | null;
  error_category: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function asMetadata(value: Record<string, unknown> | undefined) {
  const sanitized = sanitizeForLogging(value ?? {});
  if (sanitized && !Array.isArray(sanitized) && typeof sanitized === "object") {
    return sanitized as Record<string, unknown>;
  }
  return {};
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[monitoring] ${message}`, details ?? "");
}

export async function recordMonitoringEvent(event: MonitoringEventInput): Promise<void> {
  if (!hasAdminSupabaseEnv()) {
    devLog("durable monitoring skipped", { reason: "admin-supabase-not-configured", eventType: event.eventType });
    return;
  }

  try {
    const supabase = createAdminSupabaseClient();
    const { error } = await supabase.from("monitoring_events").insert({
      request_id: event.requestId ?? null,
      event_type: event.eventType,
      route: event.route ?? null,
      method: event.method ?? null,
      status: event.status ?? null,
      duration_ms: event.durationMs ?? null,
      provider: event.provider ?? null,
      model: event.model ?? null,
      retry_count: event.retryCount ?? null,
      fallback_used: event.fallbackUsed ?? null,
      error_category: event.errorCategory ?? null,
      metadata: asMetadata(event.metadata),
    });
    if (error) {
      devLog("durable monitoring write failed", { eventType: event.eventType, error: error.message });
    }
  } catch (error) {
    devLog("durable monitoring write failed", {
      eventType: event.eventType,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

export async function readMonitoringEvents(limit = 50): Promise<MonitoringEventRow[]> {
  if (!hasAdminSupabaseEnv()) return [];

  try {
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase
      .from("monitoring_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 200)));

    if (error) {
      devLog("read monitoring events failed", { error: error.message });
      return [];
    }

    return (data ?? []) as MonitoringEventRow[];
  } catch (error) {
    devLog("read monitoring events failed", { error: error instanceof Error ? error.message : "unknown" });
    return [];
  }
}

export function summarizeMonitoringEvents(events: MonitoringEventRow[]) {
  const lastHour = Date.now() - 60 * 60 * 1000;
  const recent = events.filter((event) => new Date(event.created_at).getTime() >= lastHour);
  const errors = events.filter((event) => event.event_type.includes("failed") || (event.status ?? 0) >= 500);
  const aiEvents = events.filter((event) => event.event_type === "ai.provider");
  const fallbackCount = aiEvents.filter((event) => event.fallback_used).length;

  return {
    note: "durable monitoring store is active when supabase/monitoring_events.sql has been applied.",
    totalEvents: events.length,
    lastHourEvents: recent.length,
    errorEvents: errors.length,
    aiProviderEvents: aiEvents.length,
    fallbackCount,
  };
}
