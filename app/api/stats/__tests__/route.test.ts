import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createServerSupabaseClient: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/backend/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));

import { GET } from "../route";

function adminSupabase() {
  const select = vi.fn(async () => ({ count: 7, error: null }));
  const from = vi.fn(() => ({ select }));
  return { from, select };
}

describe("admin stats API authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 for unauthenticated users", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Please log in first." });
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("returns 403 for normal authenticated users without returning admin data", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({ error: "Admin access required." });
    expect(body.files).toBeUndefined();
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("allows trusted admins", async () => {
    const supabase = adminSupabase();
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin" },
    });
    mocks.createServerSupabaseClient.mockResolvedValue(supabase);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.files).toBe(7);
    expect(body.notes).toBe(7);
    expect(supabase.from).toHaveBeenCalledWith("files");
    expect(supabase.from).toHaveBeenCalledWith("quizzes");
  });
});
