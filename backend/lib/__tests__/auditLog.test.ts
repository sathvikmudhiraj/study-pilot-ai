import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestId } from "../observability";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
  hasAdminSupabaseEnv: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  range: vi.fn(),
  insert: vi.fn(),
  queryResult: { data: [] as unknown[], error: null as { message: string } | null },
}));

vi.mock("../adminSupabase", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
  hasAdminSupabaseEnv: mocks.hasAdminSupabaseEnv,
}));

import { writeAuditLog, readAuditLogs } from "../auditLog";

describe("Audit Log", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminSupabaseEnv.mockReturnValue(true);
    mocks.queryResult.data = [];
    mocks.queryResult.error = null;
    
    const chain = {
      select: mocks.select.mockReturnThis(),
      eq: mocks.eq.mockReturnThis(),
      gte: mocks.gte.mockReturnThis(),
      lte: mocks.lte.mockReturnThis(),
      order: mocks.order.mockReturnThis(),
      limit: mocks.limit.mockReturnThis(),
      range: mocks.range.mockReturnThis(),
      insert: mocks.insert.mockResolvedValue({ error: null }),
      then: (resolve: (value: typeof mocks.queryResult) => unknown) =>
        Promise.resolve(resolve(mocks.queryResult)),
    };
    
    mocks.createAdminSupabaseClient.mockReturnValue({
      from: mocks.from.mockReturnValue(chain),
    });
  });

  describe("writeAuditLog", () => {
    it("writes audit log successfully", async () => {
      const result = await writeAuditLog({
        actorUserId: "admin-1",
        action: "user_suspend",
        targetType: "user",
        targetId: "user-123",
        result: "success",
        reason: "Policy violation",
        requestId: "req-123" as RequestId,
        metadata: { detail: "test" },
      });

      expect(result.ok).toBe(true);
      expect(mocks.from).toHaveBeenCalledWith("audit_logs");
      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          actor_user_id: "admin-1",
          action: "user_suspend",
          target_type: "user",
          target_id: "user-123",
          result: "success",
          reason: "Policy violation",
          request_id: "req-123",
        })
      );
    });

    it("handles missing optional fields", async () => {
      const result = await writeAuditLog({
        actorUserId: "admin-1",
        action: "settings_change",
        targetType: "settings",
        result: "success",
      });

      expect(result.ok).toBe(true);
      expect(mocks.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          target_id: null,
          reason: null,
          request_id: null,
          metadata: {},
        })
      );
    });

    it("recursively sanitizes metadata", async () => {
      await writeAuditLog({
        actorUserId: "admin-1",
        action: "user_role_change",
        targetType: "user",
        result: "success",
        metadata: { normal: "value", nested: { authorization: "Bearer secret", password: "pass" } },
      });

      expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
        metadata: {
          normal: "value",
          nested: { authorization: "[REDACTED]", password: "[REDACTED]" },
        },
      }));
    });

    it("returns error when admin env not configured", async () => {
      mocks.hasAdminSupabaseEnv.mockReturnValue(false);
      
      const result = await writeAuditLog({
        actorUserId: "admin-1",
        action: "user_suspend",
        targetType: "user",
        result: "success",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Admin Supabase environment not configured");
    });

    it("returns error on database failure", async () => {
      mocks.insert.mockResolvedValue({ error: { message: "Database error" } });
      
      const result = await writeAuditLog({
        actorUserId: "admin-1",
        action: "user_suspend",
        targetType: "user",
        result: "success",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Database error");
    });
  });

  describe("readAuditLogs", () => {
    it("reads audit logs with filters", async () => {
      const mockData = [{ id: "log-1", actor_user_id: "admin-1", action: "user_suspend" }];
      mocks.queryResult.data = mockData;

      const result = await readAuditLogs("admin-1", {
        limit: 10,
        action: "user_suspend",
        targetType: "user",
        targetId: "user-123",
        actorUserId: "admin-1",
        since: new Date("2024-01-01"),
        until: new Date("2024-12-31"),
      });

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(mockData);
      expect(mocks.from).toHaveBeenCalledWith("audit_logs");
      expect(mocks.select).toHaveBeenCalledWith("*");
      expect(mocks.order).toHaveBeenCalledWith("created_at", { ascending: false });
    });

    it("returns error when admin env not configured", async () => {
      mocks.hasAdminSupabaseEnv.mockReturnValue(false);

      const result = await readAuditLogs("admin-1");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Admin Supabase environment not configured");
    });

    it("returns error on database failure", async () => {
      mocks.queryResult.data = [];
      mocks.queryResult.error = { message: "Database error" };

      const result = await readAuditLogs("admin-1");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Database error");
    });
  });
});
