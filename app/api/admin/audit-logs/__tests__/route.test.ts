import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  readAuditLogs: vi.fn(),
  hasAdminSupabaseEnv: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/auditLog", () => ({ readAuditLogs: mocks.readAuditLogs, hasAdminSupabaseEnv: mocks.hasAdminSupabaseEnv }));

import { GET } from "../route";

describe("admin audit-logs API authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminSupabaseEnv.mockReturnValue(true);
  });

  it("returns 401 before creating privileged access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.readAuditLogs).not.toHaveBeenCalled();
  });

  it("returns 403 to students", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns 503 when audit log storage not configured", async () => {
    mocks.hasAdminSupabaseEnv.mockReturnValue(false);
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });

    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Audit log storage is not configured.");
  });

  it("returns paginated audit logs to admin with filters", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
    mocks.readAuditLogs.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "log-1",
          actor_user_id: "admin-1",
          action: "user_suspend",
          target_type: "user",
          target_id: "user-123",
          result: "success",
          reason: "Policy violation",
          request_id: "req-123",
          metadata: { detail: "test" },
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const response = await GET(new Request("http://localhost/api/admin/audit-logs?page=1&limit=50&action=user_suspend", { headers: { "x-request-id": "req-audit-test" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-audit-test");

    const body = await response.json();
    expect(body.logs).toHaveLength(1);
    expect(body.logs[0]).toMatchObject({
      id: "log-1",
      action: "user_suspend",
      targetType: "user",
      result: "success",
      actorUserId: "admin-1",
      requestId: "req-123",
    });
    expect(body.pagination.total).toBe(1);
  });

  it("passes filters to readAuditLogs", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
    mocks.readAuditLogs.mockResolvedValue({ ok: true, data: [] });

    await GET(new Request("http://localhost/api/admin/audit-logs?action=user_suspend&targetType=user&result=success&requestId=req-123&since=2024-01-01&until=2024-12-31"));

    expect(mocks.readAuditLogs).toHaveBeenCalledWith("admin-1", expect.objectContaining({
      action: "user_suspend",
      targetType: "user",
      result: "success",
      requestId: "req-123",
      since: expect.any(Date),
      until: expect.any(Date),
    }));
  });

  it("handles database error gracefully", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
    mocks.readAuditLogs.mockResolvedValue({ ok: false, error: "DB error" });

    const response = await GET();
    expect(response.status).toBe(503);
  });
});
