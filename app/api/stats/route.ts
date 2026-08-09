import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { getPlatformAdminStats } from "@/backend/lib/adminStats";
import { withRequestObservability } from "@/backend/lib/observability";

export async function GET(request: Request = new Request("http://localhost/api/stats")) {
  return withRequestObservability(request, "/api/stats", async ({ logger }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.stats.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    try {
      const stats = await getPlatformAdminStats();
      return NextResponse.json({ scope: "platform", ...stats });
    } catch {
      logger.error("admin.stats.failed", { status: 503, errorCategory: "database" });
      return NextResponse.json({ error: "Platform statistics are temporarily unavailable." }, { status: 503 });
    }
  });
}
