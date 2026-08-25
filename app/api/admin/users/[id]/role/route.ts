import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { createAdminSupabaseClient, hasAdminSupabaseEnv } from "@/backend/lib/adminSupabase";
import { writeAuditLog } from "@/backend/lib/auditLog";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

type RoleUpdatePayload = {
  role: "admin" | "student";
};

export async function PATCH(
  request: Request,
  context?: { params: Promise<{ id: string }> }
) {
  return withRequestObservability(request, "/api/admin/users/[id]/role", async ({ logger, requestId }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.users.role.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    if (!hasAdminSupabaseEnv()) {
      return NextResponse.json({ error: "Admin user management is not configured." }, { status: 503 });
    }

    const targetUserId = await resolveTargetUserId(request, context);

    if (!targetUserId || targetUserId.trim() === "") {
      return NextResponse.json({ error: "User ID is required." }, { status: 400 });
    }

    let payload: RoleUpdatePayload;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const { role } = payload;

    if (role !== "admin" && role !== "student") {
      return NextResponse.json({ error: "Invalid role. Must be 'admin' or 'student'." }, { status: 400 });
    }

    try {
      const supabase = createAdminSupabaseClient();

      const { data: targetUserData, error: fetchError } = await supabase.auth.admin.getUserById(targetUserId);

      if (fetchError || !targetUserData?.user) {
        return NextResponse.json({ error: "User not found." }, { status: 404 });
      }

      const targetUser = targetUserData.user;
      const existingAppMetadata = (targetUser.app_metadata as Record<string, unknown> | null) ?? {};
      const currentRole = existingAppMetadata.role === "admin" ? "admin" : "student";

      if (currentRole === role) {
        return NextResponse.json({ error: `User already has role '${role}'.` }, { status: 400 });
      }

      if (targetUserId === admin.user.id && role === "student") {
        logger.warn("admin.users.role.self_demotion_blocked", {
          errorCategory: "authorization",
          metadata: { actorUserId: admin.user.id, targetUserId },
        });
        await writeAuditLog({
          actorUserId: admin.user.id,
          action: "user_role_change",
          targetType: "user",
          targetId: targetUserId,
          result: "failure",
          reason: "Self-demotion attempted",
          requestId,
          metadata: { requestedRole: role, currentRole },
        });
        return NextResponse.json({ error: "You cannot demote yourself." }, { status: 403 });
      }

      if (role === "student" && currentRole === "admin") {
        const { data: allUsers, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        if (listError) throw new Error(listError.message);

        const adminCount = (allUsers?.users ?? []).filter(
          (u) => (u.app_metadata as Record<string, unknown> | null)?.role === "admin"
        ).length;

        if (adminCount <= 1) {
          logger.warn("admin.users.role.last_admin_blocked", {
            errorCategory: "authorization",
            metadata: { actorUserId: admin.user.id, targetUserId },
          });
          await writeAuditLog({
            actorUserId: admin.user.id,
            action: "user_role_change",
            targetType: "user",
            targetId: targetUserId,
            result: "failure",
            reason: "Last admin demotion attempted",
            requestId,
            metadata: { requestedRole: role, currentRole, adminCount },
          });
          return NextResponse.json({ error: "Cannot demote the last remaining admin." }, { status: 403 });
        }
      }

      const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(targetUserId, {
        app_metadata: {
          ...existingAppMetadata,
          role,
        },
      });

      if (updateError || !updateData?.user) {
        logger.error("admin.users.role.update_failed", {
          status: 500,
          errorCategory: "database",
          error: updateError?.message ?? "Unknown error",
        });
        await writeAuditLog({
          actorUserId: admin.user.id,
          action: "user_role_change",
          targetType: "user",
          targetId: targetUserId,
          result: "error",
          reason: updateError?.message ?? "Update failed",
          requestId,
          metadata: { requestedRole: role, currentRole },
        });
        return NextResponse.json({ error: "Failed to update user role." }, { status: 500 });
      }

      const updatedUser = updateData.user;
      const newRole = (updatedUser.app_metadata as Record<string, unknown> | null)?.role === "admin" ? "admin" : "student";

      await writeAuditLog({
        actorUserId: admin.user.id,
        action: "user_role_change",
        targetType: "user",
        targetId: targetUserId,
        result: "success",
        reason: `Role changed from ${currentRole} to ${newRole}`,
        requestId,
        metadata: { previousRole: currentRole, newRole },
      });

      logger.info("admin.users.role.changed", {
        metadata: {
          actorUserId: admin.user.id,
          targetUserId,
          previousRole: currentRole,
          newRole,
        },
      });

      return NextResponse.json({
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          role: newRole,
        },
        message: "Role updated. The user may need to sign out and sign back in for the new role to take effect.",
      });
    } catch (error) {
      logger.error("admin.users.role.failed", {
        status: 503,
        errorCategory: "database",
        error: error instanceof Error ? error.message : "unknown",
      });
      await writeAuditLog({
        actorUserId: admin.user.id,
        action: "user_role_change",
        targetType: "user",
        targetId: targetUserId,
        result: "error",
        reason: error instanceof Error ? error.message : "Unknown error",
        requestId,
        metadata: { requestedRole: role },
      });
      return NextResponse.json({ error: "Role update is temporarily unavailable." }, { status: 503 });
    }
  });
}

async function resolveTargetUserId(request: Request, context?: { params: Promise<{ id: string }> }) {
  if (context?.params) {
    const { id } = await context.params;
    return id;
  }

  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  return segments.at(-2) ?? "";
}
