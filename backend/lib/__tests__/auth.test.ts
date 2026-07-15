import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("../supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { getCurrentUser, requireAdmin } from "../auth";

function setSupabaseUser(user: Record<string, unknown> | null) {
  mocks.createServerSupabaseClient.mockResolvedValue({
    auth: {
      getUser: vi.fn(async () => ({ data: { user } })),
    },
  });
}

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "student@example.com",
    user_metadata: {},
    app_metadata: {},
    ...overrides,
  };
}

describe("trusted admin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("denies unauthenticated users", async () => {
    setSupabaseUser(null);

    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 401,
      message: "Please log in first.",
    });
  });

  it("denies normal authenticated users", async () => {
    setSupabaseUser(authUser({ app_metadata: { role: "student" } }));

    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 403,
      message: "Admin access required.",
    });
  });

  it("ignores spoofed user_metadata.role admin when trusted role is user", async () => {
    setSupabaseUser(authUser({
      user_metadata: { role: "admin", name: "Spoofed Admin" },
      app_metadata: { role: "user" },
    }));

    const currentUser = await getCurrentUser();
    expect(currentUser?.role).toBe("student");
    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 403,
      message: "Admin access required.",
    });
  });

  it("allows trusted app_metadata admins", async () => {
    setSupabaseUser(authUser({ app_metadata: { role: "admin" } }));

    const result = await requireAdmin();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.role).toBe("admin");
      expect(result.user.email).toBe("student@example.com");
    }
  });

  it("denies users with no trusted role", async () => {
    setSupabaseUser(authUser({ user_metadata: { role: "admin" }, app_metadata: {} }));

    await expect(requireAdmin()).resolves.toEqual({
      ok: false,
      status: 403,
      message: "Admin access required.",
    });
  });
});
