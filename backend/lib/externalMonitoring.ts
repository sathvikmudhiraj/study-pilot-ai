import "server-only";

type CaptureExternalErrorInput = {
  source: "server" | "client";
  severity?: "info" | "warning" | "error";
  message: string;
  category?: string;
  requestId?: string | null;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  metadata?: Record<string, unknown>;
};

const MAX_STRING_LENGTH = 500;
const MONITORING_TIMEOUT_MS = 1500;

function monitoringWebhookUrl() {
  return process.env.STUDYPILOT_MONITORING_WEBHOOK_URL?.trim() || "";
}

function environmentName() {
  return process.env.STUDYPILOT_ENVIRONMENT?.trim() || process.env.NODE_ENV || "unknown";
}

function releaseName() {
  return process.env.STUDYPILOT_RELEASE?.trim() || "local";
}

function sanitizeString(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(apikey|api_key|token|secret|password|service_role|signedUrl|signed_url)=([^&\s]+)/gi, "$1=[REDACTED]")
    .slice(0, MAX_STRING_LENGTH);
}

function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (/api|key|token|secret|password|authorization|auth|email|prompt|note|content|signed|storage_path/i.test(key)) {
        output[key] = "[REDACTED]";
      } else {
        output[key] = sanitizeValue(nested);
      }
    }
    return output;
  }
  return "[UNSERIALIZABLE]";
}

export function externalMonitoringConfigured() {
  return Boolean(monitoringWebhookUrl());
}

export async function captureExternalError(input: CaptureExternalErrorInput): Promise<void> {
  const webhookUrl = monitoringWebhookUrl();
  if (!webhookUrl) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MONITORING_TIMEOUT_MS);

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        service: "studypilot-ai",
        environment: environmentName(),
        release: releaseName(),
        source: input.source,
        severity: input.severity ?? "error",
        message: sanitizeString(input.message || "Unknown error"),
        category: sanitizeString(input.category || "Error"),
        requestId: input.requestId ?? null,
        route: input.route ?? null,
        method: input.method ?? null,
        status: input.status ?? null,
        metadata: sanitizeValue(input.metadata ?? {}),
        occurredAt: new Date().toISOString(),
      }),
    });
  } catch {
    // External monitoring must never affect app requests.
  } finally {
    clearTimeout(timeout);
  }
}
