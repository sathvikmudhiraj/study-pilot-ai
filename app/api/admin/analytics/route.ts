import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { getAdminLearningAnalytics } from "@/backend/lib/adminAnalytics";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

export async function GET(request: Request = new Request("http://localhost/api/admin/analytics")) {
  return withRequestObservability(request, "/api/admin/analytics", async ({ logger }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.analytics.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    try {
      const analytics = await getAdminLearningAnalytics();
      return NextResponse.json({ scope: "platform", ...analytics });
    } catch (error) {
      logger.error("admin.analytics.failed", {
        status: 503,
        errorCategory: "database",
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "Learning analytics are temporarily unavailable." }, { status: 503 });
    }
  });
}