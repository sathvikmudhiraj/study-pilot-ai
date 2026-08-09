import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestId } from "../observability";

import {
  getOrCreateRequestId,
  getRequestIdHeaderName,
  sanitizeForLogging,
  createRequestLogger,
  logProviderTelemetry,
  withRequestObservability,
  sanitizeError,
  logDebug,
  logInfo,
  logWarn,
  logError,
} from "../observability";

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

describe("Observability - Request IDs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it("generates a request ID when none provided", () => {
    const id = getOrCreateRequestId();
    expect(id).toMatch(/^req_[a-f0-9-]{36}$/);
  });

  it("accepts valid incoming request ID", () => {
    const id = getOrCreateRequestId("req_valid-id_123");
    expect(id).toBe("req_valid-id_123");
  });

  it("rejects invalid request ID format", () => {
    const id = getOrCreateRequestId("invalid@id");
    expect(id).toMatch(/^req_[a-f0-9-]{36}$/);
  });

  it("rejects overly long request ID", () => {
    const longId = "req_" + "a".repeat(70);
    const id = getOrCreateRequestId(longId);
    expect(id).toMatch(/^req_[a-f0-9-]{36}$/);
  });

  it("rejects newline and control-character injection", () => {
    expect(getOrCreateRequestId("safe\r\nx-forged: value")).toMatch(/^req_[a-f0-9-]{36}$/);
    expect(getOrCreateRequestId("safe\u0000value")).toMatch(/^req_[a-f0-9-]{36}$/);
  });

  it("returns correct header name", () => {
    expect(getRequestIdHeaderName()).toBe("x-request-id");
  });
});

describe("Observability - Sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it("redacts API keys in strings", () => {
    expect(sanitizeForLogging("sk-abc123")).toBe("[REDACTED]");
    expect(sanitizeForLogging("Bearer token123")).toBe("[REDACTED]");
  });

  it("redacts JWT tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(sanitizeForLogging(jwt)).toBe("[REDACTED]");
  });

  it("redacts sensitive keys in objects", () => {
    const obj = { api_key: "secret", normal: "value", password: "pass123" };
    const sanitized = sanitizeForLogging(obj) as Record<string, unknown>;
    expect(sanitized.api_key).toBe("[REDACTED]");
    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.normal).toBe("value");
  });

  it("redacts nested sensitive keys", () => {
    const obj = { config: { service_role_key: "secret" } };
    const sanitized = sanitizeForLogging(obj) as Record<string, unknown>;
    expect((sanitized.config as Record<string, unknown>).service_role_key).toBe("[REDACTED]");
  });

  it("redacts authorization, token, password, and key fields recursively", () => {
    const sanitized = sanitizeForLogging({
      headers: { Authorization: "Bearer private" },
      nested: { accessToken: "token", password: "pass", privateKey: "key" },
    }) as Record<string, unknown>;
    expect(sanitized.headers).toEqual({ Authorization: "[REDACTED]" });
    expect(sanitized.nested).toEqual({ accessToken: "[REDACTED]", password: "[REDACTED]", privateKey: "[REDACTED]" });
  });

  it("handles arrays", () => {
    const arr = ["normal", "sk-secret", { api_key: "nested" }];
    const sanitized = sanitizeForLogging(arr) as unknown[];
    expect(sanitized[0]).toBe("normal");
    expect(sanitized[1]).toBe("[REDACTED]");
    expect((sanitized[2] as Record<string, unknown>).api_key).toBe("[REDACTED]");
  });

  it("preserves non-sensitive data types", () => {
    expect(sanitizeForLogging(123)).toBe(123);
    expect(sanitizeForLogging(true)).toBe(true);
    expect(sanitizeForLogging(null)).toBe(null);
    expect(sanitizeForLogging(undefined)).toBe(undefined);
  });
});

describe("Observability - Structured Logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it("logs debug with context", () => {
    logDebug("test message", { requestId: "req-123" as RequestId, route: "/api/test" });
    expect(consoleSpy).toHaveBeenCalled();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.level).toBe("debug");
    expect(logged.message).toBe("test message");
    expect(logged.context.requestId).toBe("req-123");
    expect(logged.context.route).toBe("/api/test");
  });

  it("logs info with context", () => {
    logInfo("test message", { requestId: "req-123" as RequestId });
    expect(consoleSpy).toHaveBeenCalled();
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.level).toBe("info");
  });

  it("logs warn to stderr", () => {
    logWarn("test message", { requestId: "req-123" as RequestId });
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
    expect(logged.level).toBe("warn");
  });

  it("logs error to stderr", () => {
    logError("test message", { requestId: "req-123" as RequestId });
    expect(consoleErrorSpy).toHaveBeenCalled();
    const logged = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
    expect(logged.level).toBe("error");
  });

  it("sanitizes metadata in logs", () => {
    logInfo("test", { metadata: { api_key: "secret", normal: "value" } });
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.context.metadata.api_key).toBe("[REDACTED]");
    expect(logged.context.metadata.normal).toBe("value");
  });

  it("does not throw when the logging transport fails", () => {
    consoleSpy.mockImplementationOnce(() => {
      throw new Error("logger unavailable");
    });
    expect(() => logInfo("test", { metadata: { normal: "value" } })).not.toThrow();
  });
});

describe("Observability - Request Logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy.mockClear();
    consoleErrorSpy.mockClear();
  });

  it("creates logger with request context", () => {
    const logger = createRequestLogger("req-123" as RequestId, "/api/test", "GET");
    logger.info("test");
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.context.requestId).toBe("req-123");
    expect(logged.context.route).toBe("/api/test");
    expect(logged.context.method).toBe("GET");
  });

  it("withDuration adds durationMs", () => {
    const logger = createRequestLogger("req-123" as RequestId, "/api/test", "GET");
    const withDuration = logger.withDuration();
    withDuration.info("test");
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(typeof logged.context.durationMs).toBe("number");
    expect(logged.context.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("correlates provider telemetry with the active request", async () => {
    const request = new Request("http://localhost/api/test", { headers: { "x-request-id": "req-provider-test" } });
    const response = await withRequestObservability(request, "/api/test", async () => {
      logProviderTelemetry({
        event: "provider_finished",
        provider: "gemini",
        model: "test-model",
        durationMs: 42,
        retryCount: 1,
        fallbackTriggered: false,
      });
      return new Response(null, { status: 204 });
    });
    expect(response.headers.get("x-request-id")).toBe("req-provider-test");
    const entries = consoleSpy.mock.calls.map(([value]) => JSON.parse(value));
    const providerEntry = entries.find((entry) => entry.message === "ai.provider.telemetry");
    expect(providerEntry.context).toMatchObject({
      requestId: "req-provider-test",
      provider: "gemini",
      model: "test-model",
      durationMs: 42,
      retryCount: 1,
      fallbackUsed: false,
    });
  });
});

describe("Observability - Error Sanitization", () => {
  it("sanitizes Error objects", () => {
    const result = sanitizeError(new Error("test error"));
    expect(result.message).toBe("test error");
    expect(result.category).toBe("Error");
  });

  it("sanitizes string errors", () => {
    const result = sanitizeError("string error");
    expect(result.message).toBe("string error");
    expect(result.category).toBe("Error");
  });

  it("handles unknown errors", () => {
    const result = sanitizeError({ weird: "object" });
    expect(result.message).toBe("Unknown error");
    expect(result.category).toBe("UnknownError");
  });
});
