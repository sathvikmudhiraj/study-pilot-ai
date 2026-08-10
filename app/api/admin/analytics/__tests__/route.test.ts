import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getAdminLearningAnalytics: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/adminAnalytics", () => ({ getAdminLearningAnalytics: mocks.getAdminLearningAnalytics }));

import { GET } from "../route";

describe("admin analytics API authorization", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 before creating privileged access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getAdminLearningAnalytics).not.toHaveBeenCalled();
  });

  it("returns 403 to students", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns aggregated learning analytics to admin", async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin", preferredLanguage: "en" },
    });
    mocks.getAdminLearningAnalytics.mockResolvedValue({
      totalAttempts: 100,
      averagePercentage: 72.5,
      completionRate: 85.5,
      topicPerformance: [{ topicId: "math", label: "Math", correct: 80, total: 100, percentage: 80 }],
      languageUsage: [{ language: "en", count: 80 }, { language: "hi", count: 20 }],
      revisionPlans: { total: 10, active: 3 },
      repeatQuizUsage: 15,
    });

    const response = await GET(new Request("http://localhost/api/admin/analytics", { headers: { "x-request-id": "req-analytics-test" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-analytics-test");

    const body = await response.json();
    expect(body.scope).toBe("platform");
    expect(body.totalAttempts).toBe(100);
    expect(body.averagePercentage).toBe(72.5);
    expect(body.topicPerformance[0].percentage).toBe(80);
    expect(body.languageUsage).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("admin@example.com");
  });

  it("handles database error gracefully", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
    mocks.getAdminLearningAnalytics.mockRejectedValue(new Error("DB error"));

    const response = await GET();
    expect(response.status).toBe(503);
  });
});