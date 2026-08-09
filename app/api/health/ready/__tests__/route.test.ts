import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  hasSupabaseEnv: vi.fn(),
  getSupabaseEnv: vi.fn(),
  hasAdminSupabaseEnv: vi.fn(),
  getAdminSupabaseConfig: vi.fn(),
  getAIProviderRuntimeInfo: vi.fn(),
}));

vi.mock("@/backend/lib/supabase/env", () => ({
  hasSupabaseEnv: mocks.hasSupabaseEnv,
  getSupabaseEnv: mocks.getSupabaseEnv,
}));
vi.mock("@/backend/lib/adminSupabase", () => ({
  hasAdminSupabaseEnv: mocks.hasAdminSupabaseEnv,
  getAdminSupabaseConfig: mocks.getAdminSupabaseConfig,
}));
vi.mock("@/backend/lib/aiProvider", () => ({
  getAIProviderRuntimeInfo: mocks.getAIProviderRuntimeInfo,
}));

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

describe("Readiness Health Endpoint", () => {
  beforeEach(() => {
    vi.useRealTimers();
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

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns ready with one correlated request ID when dependencies respond", async () => {
    const response = await GET(new Request("http://localhost/api/health/ready", {
      headers: { "x-request-id": "req-ready-test" },
    }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-ready-test");
    expect(body).toEqual({
      status: "ready",
      checks: {
        database: { status: "ok" },
        storage: { status: "ok" },
        aiConfiguration: { status: "ok" },
      },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns 503 for a database failure", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const body = await (await GET()).json();
    expect(body.checks.database).toEqual({ status: "down", detail: "Database connectivity check failed." });
  });

  it("aborts and reports a database timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(3001);
    const response = await pending;
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.checks.database.detail).toBe("Database connectivity check timed out.");
    expect(body.checks.storage.detail).toBe("Storage readiness check timed out.");
  });

  it("returns 503 when storage metadata lookup fails without exposing paths", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.checks.storage).toEqual({ status: "down", detail: "Study file storage is unavailable." });
    expect(JSON.stringify(body)).not.toMatch(/signed|storage_path|file_name/i);
  });

  it("names missing privileged storage configuration honestly", async () => {
    mocks.hasAdminSupabaseEnv.mockReturnValue(false);
    const body = await (await GET()).json();
    expect(body.checks.storage.status).toBe("configuration_error");
  });

  it("does not treat auto as configured without a usable provider key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("NVIDIA_API_KEY", "");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.checks.aiConfiguration.status).toBe("configuration_error");
  });

  it("checks both default and summary profiles without making paid AI calls", async () => {
    mocks.getAIProviderRuntimeInfo
      .mockReturnValueOnce(runtime("gemini"))
      .mockReturnValueOnce(runtime("nvidia"));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.checks.aiConfiguration.status).toBe("configuration_error");
    expect(mocks.getAIProviderRuntimeInfo).toHaveBeenCalledWith("default");
    expect(mocks.getAIProviderRuntimeInfo).toHaveBeenCalledWith("summary");
  });

  it("never exposes configured credentials", async () => {
    const body = await (await GET()).json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("test-gemini-key");
    expect(serialized).not.toContain("test-anon-key");
    expect(serialized).not.toContain("test-service-role");
  });
});
