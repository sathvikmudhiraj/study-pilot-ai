import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { externalMonitoringConfigured, sendExternalAlert } from "../externalMonitoring";

describe("external monitoring webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("STUDYPILOT_MONITORING_WEBHOOK_URL", "https://monitoring.example.test/webhook");
    vi.stubEnv("STUDYPILOT_ENVIRONMENT", "test");
    vi.stubEnv("STUDYPILOT_RELEASE", "test-release");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reports whether the webhook is configured", () => {
    expect(externalMonitoringConfigured()).toBe(true);
  });

  it("sends sanitized operational metadata only", async () => {
    const delivered = await sendExternalAlert({
      source: "server",
      severity: "error",
      message: "Failure for admin@example.com with Bearer private-token",
      category: "Synthetic",
      requestId: "req-test",
      route: "/api/test",
      method: "GET",
      status: 500,
      metadata: {
        apiKey: "secret-value",
        prompt: "private student prompt",
        noteContent: "private note text",
        safeComponent: "database",
      },
    });

    expect(delivered).toBe(true);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(JSON.stringify(body)).not.toContain("admin@example.com");
    expect(JSON.stringify(body)).not.toContain("private-token");
    expect(JSON.stringify(body)).not.toContain("secret-value");
    expect(JSON.stringify(body)).not.toContain("private student prompt");
    expect(JSON.stringify(body)).not.toContain("private note text");
    expect(body.metadata.safeComponent).toBe("database");
  });

  it("returns false when the webhook fails without throwing", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network down"));
    await expect(sendExternalAlert({
      source: "server",
      message: "safe test",
      category: "Synthetic",
    })).resolves.toBe(false);
  });
});
