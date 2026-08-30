import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { getAIProviderRuntimeInfo } from "@/backend/lib/aiProvider";
import { getAdminSupabaseConfig, hasAdminSupabaseEnv } from "@/backend/lib/adminSupabase";
import { getSupabaseEnv, hasSupabaseEnv } from "@/backend/lib/supabase/env";
import { withRequestObservability } from "@/backend/lib/observability";
import { readBackgroundJobs } from "@/backend/lib/backgroundJobs";
import { readMonitoringEvents, recordMonitoringEvent, summarizeMonitoringEvents } from "@/backend/lib/monitoring";
import { alertReadinessFailures } from "@/backend/lib/alerting";

export const runtime = "nodejs";

const READINESS_TIMEOUT_MS = 3000;
const STORAGE_BUCKET = "study-files";

type CheckStatus = "ok" | "down" | "configuration_error" | "configuration";
type ReadinessCheck = { status: CheckStatus; detail?: string };

class ReadinessTimeoutError extends Error {
  constructor() {
    super("Readiness dependency timed out.");
    this.name = "ReadinessTimeoutError";
  }
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new ReadinessTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDatabase(): Promise<ReadinessCheck> {
  if (!hasSupabaseEnv()) return { status: "configuration_error", detail: "Supabase is not configured." };

  try {
    const { url, anonKey } = getSupabaseEnv();
    const response = await fetchWithTimeout(`${url}/rest/v1/files?select=id&limit=1`, {
      method: "GET",
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
    });
    return response.ok ? { status: "ok" } : { status: "down", detail: "Database connectivity check failed." };
  } catch (error) {
    return error instanceof ReadinessTimeoutError
      ? { status: "down", detail: "Database connectivity check timed out." }
      : { status: "down", detail: "Database connectivity check failed." };
  }
}

async function checkStorage(): Promise<ReadinessCheck> {
  if (!hasAdminSupabaseEnv()) {
    return { status: "configuration_error", detail: "Privileged storage readiness is not configured." };
  }

  try {
    const { url, serviceRoleKey } = getAdminSupabaseConfig();
    const response = await fetchWithTimeout(`${url}/storage/v1/bucket/${STORAGE_BUCKET}`, {
      method: "GET",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/json" },
    });
    return response.ok ? { status: "ok" } : { status: "down", detail: "Study file storage is unavailable." };
  } catch (error) {
    return error instanceof ReadinessTimeoutError
      ? { status: "down", detail: "Storage readiness check timed out." }
      : { status: "down", detail: "Study file storage is unavailable." };
  }
}

function providerProfileConfigured(profile: "default" | "summary"): boolean {
  const runtime = getAIProviderRuntimeInfo(profile);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const hasNvidia = Boolean(process.env.NVIDIA_API_KEY?.trim());

  if (runtime.configuredProvider === "gemini") return hasGemini;
  if (runtime.configuredProvider === "nvidia") return hasNvidia;
  return hasGemini || hasNvidia;
}

function checkAIConfiguration(): ReadinessCheck {
  const defaultConfigured = providerProfileConfigured("default");
  const summaryConfigured = providerProfileConfigured("summary");
  if (!defaultConfigured || !summaryConfigured) {
    return { status: "configuration_error", detail: "One or more AI provider profiles are not configured." };
  }
  return { status: "ok" };
}

function incidentSeverity(status: number | null, eventType: string): "error" | "warning" | "info" {
  if ((status ?? 0) >= 500 || eventType.includes("failed")) return "error";
  if ((status ?? 0) >= 400 || eventType.includes("health")) return "warning";
  return "info";
}

export async function GET(request: Request = new Request("http://localhost/api/admin/monitoring")) {
  return withRequestObservability(request, "/api/admin/monitoring", async ({ logger, requestId }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.monitoring.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    try {
      const [database, storage, aiConfiguration] = await Promise.all([
        checkDatabase(),
        checkStorage(),
        checkAIConfiguration(),
      ]);

      const aiDefaultInfo = getAIProviderRuntimeInfo("default");
      const aiSummaryInfo = getAIProviderRuntimeInfo("summary");

      const checks = { database, storage, aiConfiguration };
      const ready = Object.values(checks).every((check) => check.status === "ok");

      const providers = [
        {
          profile: "default",
          configuredProvider: aiDefaultInfo.configuredProvider,
          primaryProvider: aiDefaultInfo.primaryProvider,
          primaryModel: aiDefaultInfo.primaryModel,
          fallbackProvider: aiDefaultInfo.fallbackProvider,
          fallbackModel: aiDefaultInfo.fallbackModel,
          timeoutMs: aiDefaultInfo.timeoutMs,
          fastFallbackTimeoutMs: aiDefaultInfo.fastFallbackTimeoutMs,
          status: (ready && database.status === "ok") ? "ok" : "configuration" as CheckStatus,
        },
        {
          profile: "summary",
          configuredProvider: aiSummaryInfo.configuredProvider,
          primaryProvider: aiSummaryInfo.primaryProvider,
          primaryModel: aiSummaryInfo.primaryModel,
          fallbackProvider: aiSummaryInfo.fallbackProvider,
          fallbackModel: aiSummaryInfo.fallbackModel,
          timeoutMs: aiSummaryInfo.timeoutMs,
          fastFallbackTimeoutMs: aiSummaryInfo.fastFallbackTimeoutMs,
          status: (ready && database.status === "ok") ? "ok" : "configuration" as CheckStatus,
        },
      ];

      const [events, jobs] = await Promise.all([readMonitoringEvents(80), readBackgroundJobs(10)]);
      const telemetrySummary = summarizeMonitoringEvents(events);
      if (!ready) {
        await recordMonitoringEvent({
          requestId,
          eventType: "health.failure",
          route: "/api/admin/monitoring",
          method: "GET",
          status: 503,
          errorCategory: "readiness",
          metadata: checks,
        });
        await alertReadinessFailures({
          requestId,
          route: "/api/admin/monitoring",
          method: "GET",
          status: 503,
          checks,
        });
      }
      const recentIncidents = events
        .filter((event) => event.event_type.includes("failed") || event.event_type === "health.failure" || (event.status ?? 0) >= 400)
        .slice(0, 10)
        .map((event) => ({
          id: event.id,
          timestamp: event.created_at,
          severity: incidentSeverity(event.status, event.event_type),
          category: event.error_category ?? event.event_type,
          message: `${event.event_type}${event.route ? ` on ${event.route}` : ""}`,
          requestId: event.request_id ?? undefined,
        }));

      return NextResponse.json({
        live: { status: "ok" },
        readiness: { status: ready ? "ready" : "not_ready", checks },
        providers,
        telemetry: telemetrySummary,
        recentEvents: events.slice(0, 20),
        recentIncidents,
        recentJobs: jobs,
      });
    } catch (error) {
      logger.error("admin.monitoring.failed", {
        status: 503,
        errorCategory: "database",
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "Monitoring data is temporarily unavailable." }, { status: 503 });
    }
  });
}
