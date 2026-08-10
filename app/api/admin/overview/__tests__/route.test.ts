import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getPlatformAdminStats: vi.fn(),
  getAdminLearningAnalytics: vi.fn(),
  getAIProviderRuntimeInfo: vi.fn(),
  hasSupabaseEnv: vi.fn(),
  hasAdminSupabaseEnv: vi.fn(),
  getSupabaseEnv: vi.fn(),
  getAdminSupabaseConfig: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/adminStats", () => ({ getPlatformAdminStats: mocks.getPlatformAdminStats }));
vi.mock("@/backend/lib/adminAnalytics", () => ({ getAdminLearningAnalytics: mocks.getAdminLearningAnalytics }));
vi.mock("@/backend/lib/aiProvider", () => ({ getAIProviderRuntimeInfo: mocks.getAIProviderRuntimeInfo }));
vi.mock("@/backend/lib/supabase/env", () => ({ hasSupabaseEnv: mocks.hasSupabaseEnv, getSupabaseEnv: mocks.getSupabaseEnv }));
vi.mock("@/backend/lib/adminSupabase", () => ({ hasAdminSupabaseEnv: mocks.hasAdminSupabaseEnv, getAdminSupabaseConfig: mocks.getAdminSupabaseConfig }));

import { GET } from "../route";

describe("admin overview API authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-gemini");
    vi.stubEnv("NVIDIA_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.hasAdminSupabaseEnv.mockReturnValue(true);
    mocks.getSupabaseEnv.mockReturnValue({ url: "https://test.supabase.co", anonKey: "test-anon" });
    mocks.getAdminSupabaseConfig.mockReturnValue({ url: "https://test.supabase.co", serviceRoleKey: "test-service" });
    mocks.getAIProviderRuntimeInfo.mockReturnValue({
      configuredProvider: "gemini",
      primaryProvider: "gemini",
      primaryModel: "gemini-test",
      fallbackProvider: "nvidia",
      fallbackModel: "nvidia-test",
      timeoutMs: 30000,
      fastFallbackTimeoutMs: 30000,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  });

  it("returns 401 before creating privileged access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.getPlatformAdminStats).not.toHaveBeenCalled();
    expect(mocks.getAdminLearningAnalytics).not.toHaveBeenCalled();
  });

  it("returns 403 to students before creating privileged access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await GET();
    expect(response.status).toBe(403);
    expect(mocks.getPlatformAdminStats).not.toHaveBeenCalled();
  });

  it("returns overview data to a trusted admin with request ID", async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin", preferredLanguage: "en" },
    });
    mocks.getPlatformAdminStats.mockResolvedValue({ files: 10, notes: 8, summaries: 6, chats: 4, quizzes: 2 });
    mocks.getAdminLearningAnalytics.mockResolvedValue({
      totalAttempts: 50,
      averagePercentage: 75.5,
      completionRate: 90,
      topicPerformance: [],
      languageUsage: [],
      revisionPlans: { total: 5, active: 2 },
      repeatQuizUsage: 10,
    });

    const response = await GET(new Request("http://localhost/api/admin/overview", { headers: { "x-request-id": "req-overview-test" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-overview-test");

    const body = await response.json();
    expect(body.scope).toBe("platform");
    expect(body.stats.files).toBe(10);
    expect(body.learning.totalAttempts).toBe(50);
    expect(body.ai.default.provider).toBe("gemini");
    expect(body.readiness.status).toBeDefined();
    expect(JSON.stringify(body)).not.toContain("admin@example.com");
  });
});