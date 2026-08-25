import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  hasAdminSupabaseEnv: vi.fn(),
  writeAuditLog: vi.fn(),
  auth: {
    admin: {
      getUserById: vi.fn(),
      updateUserById: vi.fn(),
      listUsers: vi.fn(),
    },
  },
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/adminSupabase", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
  hasAdminSupabaseEnv: mocks.hasAdminSupabaseEnv,
}));
vi.mock("@/backend/lib/auditLog", () => ({ writeAuditLog: mocks.writeAuditLog }));

import { PATCH } from "../route";

function makeRequest(body: unknown, userId = "user-123") {
  return new Request(`http://localhost/api/admin/users/${userId}/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-request-id": "req-test" },
    body: JSON.stringify(body),
  });
}

describe("admin users role update API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminSupabaseEnv.mockReturnValue(true);
    mocks.writeAuditLog.mockResolvedValue({ ok: true });
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin", email: "admin@example.com" } });
  });

  it("returns 401 for unauthenticated users", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await PATCH(makeRequest({ role: "admin" }));
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await PATCH(makeRequest({ role: "admin" }));
    expect(response.status).toBe(403);
  });

  it("returns 503 when admin env not configured", async () => {
    mocks.hasAdminSupabaseEnv.mockReturnValue(false);
    const response = await PATCH(makeRequest({ role: "admin" }));
    expect(response.status).toBe(503);
  });

  it("returns 400 for invalid role", async () => {
    const response = await PATCH(makeRequest({ role: "superadmin" }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("Invalid role. Must be 'admin' or 'student'.");
  });

  it("returns 400 for missing role", async () => {
    const response = await PATCH(makeRequest({}));
    expect(response.status).toBe(400);
  });

  it("returns 404 for nonexistent user", async () => {
    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: null }, error: { message: "User not found" } });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await PATCH(makeRequest({ role: "admin" }));
    expect(response.status).toBe(404);
  });

  it("promotes student to admin", async () => {
    const targetUser = {
      id: "user-123",
      email: "student@example.com",
      app_metadata: { role: "student", provider: "email" },
    };

    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: targetUser }, error: null });
    mocks.auth.admin.updateUserById.mockResolvedValue({
      data: { user: { ...targetUser, app_metadata: { ...targetUser.app_metadata, role: "admin" } } },
      error: null,
    });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await PATCH(makeRequest({ role: "admin" }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user.role).toBe("admin");
    expect(body.message).toContain("sign out and sign back in");

    expect(mocks.auth.admin.updateUserById).toHaveBeenCalledWith("user-123", {
      app_metadata: { role: "admin", provider: "email" },
    });

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "admin-1",
        action: "user_role_change",
        targetType: "user",
        targetId: "user-123",
        result: "success",
        metadata: expect.objectContaining({ previousRole: "student", newRole: "admin" }),
      })
    );
    expect(mocks.writeAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ targetEmail: expect.any(String) }),
      })
    );
  });

  it("demotes admin to student", async () => {
    const targetUser = {
      id: "user-123",
      email: "admin@example.com",
      app_metadata: { role: "admin", provider: "email" },
    };

    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: targetUser }, error: null });
    mocks.auth.admin.listUsers.mockResolvedValue({
      data: { users: [targetUser, { id: "admin-1", app_metadata: { role: "admin" } }] },
      error: null,
    });
    mocks.auth.admin.updateUserById.mockResolvedValue({
      data: { user: { ...targetUser, app_metadata: { ...targetUser.app_metadata, role: "student" } } },
      error: null,
    });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await PATCH(makeRequest({ role: "student" }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user.role).toBe("student");
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ previousRole: "admin", newRole: "student" }) })
    );
  });

  it("blocks self-demotion", async () => {
    const targetUser = {
      id: "admin-1",
      email: "admin@example.com",
      app_metadata: { role: "admin", provider: "email" },
    };

    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: targetUser }, error: null });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await PATCH(makeRequest({ role: "student" }, "admin-1"));
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error).toBe("You cannot demote yourself.");

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: "failure", reason: "Self-demotion attempted" })
    );
  });

  it("blocks demotion of last remaining admin", async () => {
    const targetUser = {
      id: "user-123",
      email: "admin@example.com",
      app_metadata: { role: "admin", provider: "email" },
    };

    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: targetUser }, error: null });
    mocks.auth.admin.listUsers.mockResolvedValue({
      data: { users: [targetUser] },
      error: null,
    });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await PATCH(makeRequest({ role: "student" }));
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.error).toBe("Cannot demote the last remaining admin.");

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: "failure", reason: "Last admin demotion attempted" })
    );
  });

  it("returns 400 if role unchanged", async () => {
    const targetUser = {
      id: "user-123",
      email: "student@example.com",
      app_metadata: { role: "admin", provider: "email" },
    };

    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: targetUser }, error: null });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await PATCH(makeRequest({ role: "admin" }));
    expect(response.status).toBe(400);
  });

  it("preserves existing app_metadata", async () => {
    const targetUser = {
      id: "user-123",
      email: "student@example.com",
      app_metadata: { role: "student", provider: "google", custom_field: "value" },
    };

    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: targetUser }, error: null });
    mocks.auth.admin.updateUserById.mockResolvedValue({
      data: { user: { ...targetUser, app_metadata: { ...targetUser.app_metadata, role: "admin" } } },
      error: null,
    });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    await PATCH(makeRequest({ role: "admin" }));

    expect(mocks.auth.admin.updateUserById).toHaveBeenCalledWith("user-123", {
      app_metadata: { role: "admin", provider: "google", custom_field: "value" },
    });
  });

  it("handles update failure", async () => {
    const targetUser = {
      id: "user-123",
      email: "student@example.com",
      app_metadata: { role: "student", provider: "email" },
    };

    mocks.auth.admin.getUserById.mockResolvedValue({ data: { user: targetUser }, error: null });
    mocks.auth.admin.updateUserById.mockResolvedValue({ data: { user: null }, error: { message: "Update failed" } });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await PATCH(makeRequest({ role: "admin" }));
    expect(response.status).toBe(500);

    expect(mocks.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ result: "error" })
    );
  });
});
