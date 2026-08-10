import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { getPlatformAdminStats } from "@/backend/lib/adminStats";
import { getAdminLearningAnalytics } from "@/backend/lib/adminAnalytics";
import { getAIProviderRuntimeInfo } from "@/backend/lib/aiProvider";
import { getAdminSupabaseConfig, hasAdminSupabaseEnv } from "@/backend/lib/adminSupabase";
import { getSupabaseEnv, hasSupabaseEnv } from "@/backend/lib/supabase/env";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

export async function GET(request: Request = new Request("http://localhost/api/admin/overview")) {
  return withRequestObservability(request, "/api/admin/overview", async ({ logger }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.overview.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    try {
      const [platformStats, learningAnalytics] = await Promise.allSettled([
        getPlatformAdminStats(),
        getAdminLearningAnalytics(),
      ]);

      const aiDefaultInfo = getAIProviderRuntimeInfo("default");
      const aiSummaryInfo = getAIProviderRuntimeInfo("summary");

      let readiness: { status: string; checks: Record<string, { status: string; detail?: string }> } = {
        status: "unknown",
        checks: {},
      };

      if (hasSupabaseEnv() && hasAdminSupabaseEnv()) {
        try {
          const { url, anonKey } = getSupabaseEnv();
          const { serviceRoleKey } = getAdminSupabaseConfig();

          const [dbCheck, storageCheck] = await Promise.allSettled([
            fetch(`${url}/rest/v1/files?select=id&limit=1`, {
              method: "GET",
              headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, Accept: "application/json" },
              cache: "no-store",
              signal: AbortSignal.timeout(2000),
            }),
            fetch(`${url}/storage/v1/bucket/study-files`, {
              method: "GET",
              headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, Accept: "application/json" },
              cache: "no-store",
              signal: AbortSignal.timeout(2000),
            }),
          ]);

          const aiConfigured = (() => {
            const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
            const hasNvidia = Boolean(process.env.NVIDIA_API_KEY?.trim());
            const checkProfile = (profile: typeof aiDefaultInfo) => {
              if (profile.configuredProvider === "gemini") return hasGemini;
              if (profile.configuredProvider === "nvidia") return hasNvidia;
              return hasGemini || hasNvidia;
            };
            return checkProfile(aiDefaultInfo) && checkProfile(aiSummaryInfo);
          })();

          readiness = {
            status: dbCheck.status === "fulfilled" && dbCheck.value.ok &&
              storageCheck.status === "fulfilled" && storageCheck.value.ok &&
              aiConfigured
              ? "ready"
              : "not_ready",
            checks: {
              database: dbCheck.status === "fulfilled" && dbCheck.value.ok
                ? { status: "ok" }
                : { status: "down", detail: "Database connectivity check failed" },
              storage: storageCheck.status === "fulfilled" && storageCheck.value.ok
                ? { status: "ok" }
                : { status: "down", detail: "Storage check failed" },
              aiConfiguration: aiConfigured ? { status: "ok" } : { status: "configuration_error", detail: "AI provider not fully configured" },
            },
          };
        } catch {
          readiness = { status: "error", checks: {} };
        }
      }

      return NextResponse.json({
        scope: "platform",
        stats: platformStats.status === "fulfilled" ? platformStats.value : {
          files: 0, notes: 0, summaries: 0, chats: 0, quizzes: 0,
        },
        learning: learningAnalytics.status === "fulfilled" ? learningAnalytics.value : {
          totalAttempts: 0, averagePercentage: 0, completionRate: 0,
          topicPerformance: [], languageUsage: [], revisionPlans: { total: 0, active: 0 }, repeatQuizUsage: 0,
        },
        ai: {
          default: {
            provider: aiDefaultInfo.configuredProvider,
            primaryProvider: aiDefaultInfo.primaryProvider,
            primaryModel: aiDefaultInfo.primaryModel,
            fallbackProvider: aiDefaultInfo.fallbackProvider,
            fallbackModel: aiDefaultInfo.fallbackModel,
            timeoutMs: aiDefaultInfo.timeoutMs,
          },
          summary: {
            provider: aiSummaryInfo.configuredProvider,
            primaryProvider: aiSummaryInfo.primaryProvider,
            primaryModel: aiSummaryInfo.primaryModel,
            fallbackProvider: aiSummaryInfo.fallbackProvider,
            fallbackModel: aiSummaryInfo.fallbackModel,
            timeoutMs: aiSummaryInfo.timeoutMs,
          },
        },
        readiness,
      });
    } catch (error) {
      logger.error("admin.overview.failed", {
        status: 503,
        errorCategory: "database",
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "Platform overview is temporarily unavailable." }, { status: 503 });
    }
  });
}