import { NextResponse } from "next/server";
import { getAdminSupabaseConfig, hasAdminSupabaseEnv } from "@/backend/lib/adminSupabase";
import { getAIProviderRuntimeInfo } from "@/backend/lib/aiProvider";
import { getSupabaseEnv, hasSupabaseEnv } from "@/backend/lib/supabase/env";
import { withRequestObservability } from "@/backend/lib/observability";
import { recordMonitoringEvent } from "@/backend/lib/monitoring";
import { alertReadinessFailures } from "@/backend/lib/alerting";

export const runtime = "nodejs";

const READINESS_TIMEOUT_MS = 3000;
const STORAGE_BUCKET = "study-files";

type CheckStatus = "ok" | "down" | "configuration_error";
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
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        Accept: "application/json",
      },
    });
    return response.ok
      ? { status: "ok" }
      : { status: "down", detail: "Database connectivity check failed." };
  } catch (error) {
    return error instanceof ReadinessTimeoutError
      ? { status: "down", detail: "Database connectivity check timed out." }
      : { status: "down", detail: "Database connectivity check failed." };
  }
}

async function checkStorage(): Promise<ReadinessCheck> {
  if (!hasAdminSupabaseEnv()) {
    return {
      status: "configuration_error",
      detail: "Privileged storage readiness is not configured.",
    };
  }

  try {
    const { url, serviceRoleKey } = getAdminSupabaseConfig();
    const response = await fetchWithTimeout(`${url}/storage/v1/bucket/${STORAGE_BUCKET}`, {
      method: "GET",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: "application/json",
      },
    });
    return response.ok
      ? { status: "ok" }
      : { status: "down", detail: "Study file storage is unavailable." };
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

export async function GET(request: Request = new Request("http://localhost/api/health/ready")) {
  return withRequestObservability(request, "/api/health/ready", async ({ requestId }) => {
    const [database, storage] = await Promise.all([checkDatabase(), checkStorage()]);
    const aiConfiguration = checkAIConfiguration();
    const checks = { database, storage, aiConfiguration };
    const ready = Object.values(checks).every((check) => check.status === "ok");
    if (!ready) {
      await recordMonitoringEvent({
        requestId,
        eventType: "health.failure",
        route: "/api/health/ready",
        method: "GET",
        status: 503,
        errorCategory: "readiness",
        metadata: checks,
      });
      await alertReadinessFailures({
        requestId,
        route: "/api/health/ready",
        method: "GET",
        status: 503,
        checks,
      });
    }

    return NextResponse.json(
      { status: ready ? "ready" : "not_ready", checks },
      { status: ready ? 200 : 503 },
    );
  });
}
