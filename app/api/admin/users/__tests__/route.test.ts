import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
  hasAdminSupabaseEnv: vi.fn(),
  listUsers: vi.fn(),
  getUserById: vi.fn(),
  updateUserById: vi.fn(),
  auth: {
    admin: {
      listUsers: vi.fn(),
      getUserById: vi.fn(),
      updateUserById: vi.fn(),
    },
  },
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/adminSupabase", () => ({
  createAdminSupabaseClient: mocks.createAdminSupabaseClient,
  hasAdminSupabaseEnv: mocks.hasAdminSupabaseEnv,
}));

import { GET } from "../route";

describe("admin users list API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAdminSupabaseEnv.mockReturnValue(true);
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
  });

  it("returns 401 for unauthenticated users", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns 403 for non-admin users", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns 503 when admin env not configured", async () => {
    mocks.hasAdminSupabaseEnv.mockReturnValue(false);
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Admin user management is not configured.");
  });

  it("returns paginated users with correct fields", async () => {
    const mockUsers = [
      {
        id: "user-1",
        email: "student@example.com",
        created_at: "2024-01-01T00:00:00Z",
        last_sign_in_at: "2024-01-15T10:00:00Z",
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { role: "student", provider: "email" },
        user_metadata: { full_name: "Test Student" },
      },
      {
        id: "user-2",
        email: "admin@example.com",
        created_at: "2024-01-02T00:00:00Z",
        last_sign_in_at: "2024-01-16T10:00:00Z",
        email_confirmed_at: "2024-01-02T00:00:00Z",
        app_metadata: { role: "admin", provider: "email" },
        user_metadata: { full_name: "Test Admin" },
      },
    ];

    mocks.auth.admin.listUsers.mockResolvedValue({ data: { users: mockUsers }, error: null });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await GET(new Request("http://localhost/api/admin/users?page=1&limit=50", { headers: { "x-request-id": "req-test" } }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.users).toHaveLength(2);
    expect(body.users[0]).toMatchObject({
      id: "user-1",
      email: "student@example.com",
      name: "student",
      role: "student",
      emailConfirmed: true,
    });
    expect(body.users[1]).toMatchObject({
      id: "user-2",
      email: "admin@example.com",
      name: "Test Admin",
      role: "admin",
      emailConfirmed: true,
    });
    expect(body.pagination.total).toBe(2);
  });

  it("normalizes missing role to student", async () => {
    const mockUsers = [
      {
        id: "user-1",
        email: "student@example.com",
        created_at: "2024-01-01T00:00:00Z",
        last_sign_in_at: null,
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { provider: "email" },
        user_metadata: {},
      },
    ];

    mocks.auth.admin.listUsers.mockResolvedValue({ data: { users: mockUsers }, error: null });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await GET();
    const body = await response.json();
    expect(body.users[0].role).toBe("student");
  });

  it("filters by search term", async () => {
    const mockUsers = [
      {
        id: "user-1",
        email: "student@example.com",
        created_at: "2024-01-01T00:00:00Z",
        last_sign_in_at: null,
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { role: "student" },
        user_metadata: { full_name: "John Doe" },
      },
      {
        id: "user-2",
        email: "admin@example.com",
        created_at: "2024-01-02T00:00:00Z",
        last_sign_in_at: null,
        email_confirmed_at: "2024-01-02T00:00:00Z",
        app_metadata: { role: "admin" },
        user_metadata: { full_name: "Jane Smith" },
      },
    ];

    mocks.auth.admin.listUsers.mockResolvedValue({ data: { users: mockUsers }, error: null });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await GET(new Request("http://localhost/api/admin/users?search=john"));
    const body = await response.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].email).toBe("student@example.com");
  });

  it("filters by role", async () => {
    const mockUsers = [
      {
        id: "user-1",
        email: "student@example.com",
        created_at: "2024-01-01T00:00:00Z",
        last_sign_in_at: null,
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { role: "student" },
        user_metadata: {},
      },
      {
        id: "user-2",
        email: "admin@example.com",
        created_at: "2024-01-02T00:00:00Z",
        last_sign_in_at: null,
        email_confirmed_at: "2024-01-02T00:00:00Z",
        app_metadata: { role: "admin" },
        user_metadata: {},
      },
    ];

    mocks.auth.admin.listUsers.mockResolvedValue({ data: { users: mockUsers }, error: null });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await GET(new Request("http://localhost/api/admin/users?role=admin"));
    const body = await response.json();
    expect(body.users).toHaveLength(1);
    expect(body.users[0].role).toBe("admin");
  });

  it("does not expose sensitive fields", async () => {
    const mockUsers = [
      {
        id: "user-1",
        email: "student@example.com",
        created_at: "2024-01-01T00:00:00Z",
        last_sign_in_at: null,
        email_confirmed_at: "2024-01-01T00:00:00Z",
        app_metadata: { role: "student", provider: "email", sensitive: "data" },
        user_metadata: { full_name: "Test", password: "secret" },
      },
    ];

    mocks.auth.admin.listUsers.mockResolvedValue({ data: { users: mockUsers }, error: null });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await GET();
    const body = await response.json();
    expect(body.users[0]).not.toHaveProperty("app_metadata");
    expect(body.users[0]).not.toHaveProperty("user_metadata");
    expect(body.users[0]).not.toHaveProperty("password");
    expect(Object.keys(body.users[0])).toEqual(
      expect.arrayContaining(["id", "email", "name", "role", "createdAt", "lastSignInAt", "emailConfirmed"])
    );
  });

  it("handles database error gracefully", async () => {
    mocks.auth.admin.listUsers.mockResolvedValue({ data: { users: [] }, error: { message: "DB error" } });
    mocks.createAdminSupabaseClient.mockReturnValue({ auth: { admin: mocks.auth.admin } });

    const response = await GET();
    expect(response.status).toBe(503);
  });
});