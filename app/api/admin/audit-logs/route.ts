import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { readAuditLogs, hasAdminSupabaseEnv, AuditAction, AuditResult, AuditTargetType } from "@/backend/lib/auditLog";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request = new Request("http://localhost/api/admin/audit-logs")) {
  return withRequestObservability(request, "/api/admin/audit-logs", async ({ logger }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.audit-logs.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    if (!hasAdminSupabaseEnv()) {
      return NextResponse.json(
        { error: "Audit log storage is not configured.", logs: [], pagination: { page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 } },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10)));
    const action = url.searchParams.get("action")?.trim() || undefined;
    const targetType = url.searchParams.get("targetType")?.trim() || undefined;
    const result = url.searchParams.get("result")?.trim() || undefined;
    const requestId = url.searchParams.get("requestId")?.trim() || undefined;
    const since = url.searchParams.get("since") ? new Date(url.searchParams.get("since")!) : undefined;
    const until = url.searchParams.get("until") ? new Date(url.searchParams.get("until")!) : undefined;

    try {
      const result_ = await readAuditLogs(admin.user.id, {
        limit,
        offset: (page - 1) * limit,
        action: action as AuditAction | undefined,
        targetType: targetType as AuditTargetType | undefined,
        result: result as AuditResult | undefined,
        requestId,
        actorUserId: undefined,
        since,
        until,
      });

      if (!result_.ok) throw new Error(result_.error);

      const logs = result_.data ?? [];
      const total = logs.length;

      const sanitizedLogs = logs.map((log) => ({
        id: log.id,
        actorUserId: log.actor_user_id,
        action: log.action,
        targetType: log.target_type,
        targetId: log.target_id,
        result: log.result,
        reason: log.reason,
        requestId: log.request_id,
        metadata: log.metadata ?? {},
        createdAt: log.created_at,
      }));

      return NextResponse.json({
        logs: sanitizedLogs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filters: { action, targetType, result, requestId, since: since?.toISOString(), until: until?.toISOString() },
      });
    } catch (error) {
      logger.error("admin.audit-logs.failed", {
        status: 503,
        errorCategory: "database",
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "Audit logs are temporarily unavailable." }, { status: 503 });
    }
  });
}
