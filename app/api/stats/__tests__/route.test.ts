import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getPlatformAdminStats: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/adminStats", () => ({ getPlatformAdminStats: mocks.getPlatformAdminStats }));

import { GET } from "../route";

describe("admin stats API authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 before creating privileged stats access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getPlatformAdminStats).not.toHaveBeenCalled();
  });

  it("returns 403 to students before creating privileged stats access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(403);
    expect(body.files).toBeUndefined();
    expect(mocks.getPlatformAdminStats).not.toHaveBeenCalled();
  });

  it("returns only platform aggregate fields to a trusted admin", async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", name: "Admin", email: "private@example.com", role: "admin" },
    });
    mocks.getPlatformAdminStats.mockResolvedValue({ files: 7, notes: 6, summaries: 5, chats: 4, quizzes: 3 });
    const response = await GET(new Request("http://localhost/api/stats", { headers: { "x-request-id": "req-stats" } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-stats");
    expect(body).toEqual({ scope: "platform", files: 7, notes: 6, summaries: 5, chats: 4, quizzes: 3 });
    expect(JSON.stringify(body)).not.toContain("private@example.com");
  });
});
