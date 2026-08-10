import "server-only";

import { createAdminSupabaseClient, hasAdminSupabaseEnv } from "./adminSupabase";
import { sanitizeForLogging, type RequestId } from "./observability";

export { hasAdminSupabaseEnv } from "./adminSupabase";

export type AuditAction =
  | "user_suspend"
  | "user_unsuspend"
  | "user_role_change"
  | "file_admin_delete"
  | "settings_change"
  | "support_retry"
  | "admin_action";

export type AuditResult = "success" | "failure" | "error";

export type AuditTargetType =
  | "user"
  | "file"
  | "settings"
  | "system"
  | "support";

export interface AuditLogEntry {
  actorUserId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string;
  result: AuditResult;
  reason?: string;
  requestId?: RequestId;
  metadata?: Record<string, unknown>;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const sanitized = sanitizeForLogging(metadata);
  return sanitized && !Array.isArray(sanitized) && typeof sanitized === "object"
    ? sanitized
    : {};
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<{ ok: boolean; error?: string }> {
  if (!hasAdminSupabaseEnv()) {
    return { ok: false, error: "Admin Supabase environment not configured" };
  }

  try {
    const supabase = createAdminSupabaseClient();
    const auditRow = {
      actor_user_id: entry.actorUserId,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      result: entry.result,
      reason: entry.reason ?? null,
      request_id: entry.requestId ?? null,
      metadata: sanitizeMetadata(entry.metadata),
    };
    const { error } = await supabase.from("audit_logs").insert(auditRow);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown audit log error";
    return { ok: false, error: message };
  }
}

export async function readAuditLogs(
  adminUserId: string,
  options: {
    limit?: number;
    offset?: number;
    action?: AuditAction;
    targetType?: AuditTargetType;
    targetId?: string;
    actorUserId?: string;
    since?: Date;
    until?: Date;
  } = {}
): Promise<{ ok: boolean; data?: AuditLogRecord[]; error?: string }> {
  if (!hasAdminSupabaseEnv()) {
    return { ok: false, error: "Admin Supabase environment not configured" };
  }

  try {
    const supabase = createAdminSupabaseClient();
    let query = supabase.from("audit_logs").select("*").order("created_at", { ascending: false });

    if (options.limit) query = query.limit(options.limit);
    if (options.offset) query = query.range(options.offset, options.offset + (options.limit ?? 50) - 1);
    if (options.action) query = query.eq("action", options.action);
    if (options.targetType) query = query.eq("target_type", options.targetType);
    if (options.targetId) query = query.eq("target_id", options.targetId);
    if (options.actorUserId) query = query.eq("actor_user_id", options.actorUserId);
    if (options.since) query = query.gte("created_at", options.since.toISOString());
    if (options.until) query = query.lte("created_at", options.until.toISOString());

    const { data, error } = await query;

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, data: data as AuditLogRecord[] };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown audit log error";
    return { ok: false, error: message };
  }
}

export interface AuditLogRecord {
  id: string;
  actor_user_id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  reason: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
