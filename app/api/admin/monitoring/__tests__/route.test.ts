import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getAIProviderRuntimeInfo: vi.fn(),
  hasSupabaseEnv: vi.fn(),
  hasAdminSupabaseEnv: vi.fn(),
  getSupabaseEnv: vi.fn(),
  getAdminSupabaseConfig: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/aiProvider", () => ({ getAIProviderRuntimeInfo: mocks.getAIProviderRuntimeInfo }));
vi.mock("@/backend/lib/supabase/env", () => ({ hasSupabaseEnv: mocks.hasSupabaseEnv, getSupabaseEnv: mocks.getSupabaseEnv }));
vi.mock("@/backend/lib/adminSupabase", () => ({ hasAdminSupabaseEnv: mocks.hasAdminSupabaseEnv, getAdminSupabaseConfig: mocks.getAdminSupabaseConfig }));

import { GET } from "../route";

function runtime(provider: "auto" | "gemini" | "nvidia" = "auto") {
  return {
    configuredProvider: provider,
    primaryProvider: provider === "nvidia" ? "nvidia" : "gemini",
    primaryModel: "test-model",
    fallbackProvider: provider === "auto" ? "nvidia" : null,
    fallbackModel: provider === "auto" ? "fallback-model" : null,
    timeoutMs: 30000,
    fastFallbackTimeoutMs: 30000,
  };
}

describe("admin monitoring API authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key");
    vi.stubEnv("NVIDIA_API_KEY", "");
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.getSupabaseEnv.mockReturnValue({ url: "https://test.supabase.co", anonKey: "test-anon-key" });
    mocks.hasAdminSupabaseEnv.mockReturnValue(true);
    mocks.getAdminSupabaseConfig.mockReturnValue({ url: "https://test.supabase.co", serviceRoleKey: "test-service-role" });
    mocks.getAIProviderRuntimeInfo.mockReturnValue(runtime());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
  });

  it("returns 401 before creating privileged access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("returns 403 to students", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns monitoring data with correlated request ID for admin", async () => {
    mocks.requireAdmin.mockResolvedValue({
      ok: true,
      user: { id: "admin-1", name: "Admin", email: "admin@example.com", role: "admin", preferredLanguage: "en" },
    });

    const response = await GET(new Request("http://localhost/api/admin/monitoring", { headers: { "x-request-id": "req-monitoring-test" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-monitoring-test");

    const body = await response.json();
    expect(body.live.status).toBe("ok");
    expect(body.readiness.status).toBeDefined();
    expect(body.providers).toHaveLength(2);
    expect(body.telemetry.note).toContain("durable monitoring store");
    expect(JSON.stringify(body)).not.toContain("admin@example.com");
  });

  it("reports database down when fetch fails", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 500 })).mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const response = await GET();
    const body = await response.json();
    expect(body.readiness.checks.database.status).toBe("down");
  });

  it("reports storage configuration error when admin env missing", async () => {
    mocks.hasAdminSupabaseEnv.mockReturnValue(false);
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });

    const response = await GET();
    const body = await response.json();
    expect(body.readiness.checks.storage.status).toBe("configuration_error");
  });

  it("never exposes credentials in response", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("test-gemini-key");
    expect(serialized).not.toContain("test-anon-key");
    expect(serialized).not.toContain("test-service-role");
  });
});