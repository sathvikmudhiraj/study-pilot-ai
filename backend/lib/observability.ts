import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

export type RequestId = string & { readonly __brand: unique symbol };

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

function generateRequestId(): RequestId {
  return `req_${crypto.randomUUID()}` as RequestId;
}

function isValidRequestId(value: string): value is RequestId {
  return REQUEST_ID_REGEX.test(value);
}

export function getOrCreateRequestId(incoming?: string | null): RequestId {
  if (incoming && isValidRequestId(incoming)) {
    return incoming;
  }
  return generateRequestId();
}

export function getRequestIdHeaderName(): string {
  return REQUEST_ID_HEADER;
}

export interface SanitizedLogObject {
  [key: string]: SanitizedLogValue | undefined;
}

export type SanitizedLogValue =
  | SanitizedLogObject
  | Array<SanitizedLogValue | undefined>
  | string
  | number
  | boolean
  | null;

function sanitizeValue(value: unknown, seen: WeakSet<object>): SanitizedLogValue | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (looksLikeSecret(value)) return "[REDACTED]";
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    return value.map((item) => sanitizeValue(item, seen));
  }
  if (typeof value === "object") {
    if (seen.has(value)) return "[CIRCULAR]";
    seen.add(value);
    const sanitized: SanitizedLogObject = {};
    for (const [key, val] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeValue(val, seen);
      }
    }
    return sanitized;
  }
  return "[UNSERIALIZABLE]";
}

export function sanitizeForLogging(value: unknown): SanitizedLogValue | undefined {
  return sanitizeValue(value, new WeakSet<object>());
}

function looksLikeSecret(value: string): boolean {
  const secretPatterns = [
    /^sk-/,
    /^Bearer\s+/i,
    /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    /^[A-Za-z0-9]{32,}$/,
    /^supabase\.key\./i,
  ];
  return secretPatterns.some((pattern) => pattern.test(value));
}

function isSensitiveKey(key: string): boolean {
  const sensitiveKeys = [
    "api_key",
    "apikey",
    "secret",
    "password",
    "token",
    "authorization",
    "auth",
    "key",
    "credential",
    "private",
    "service_role",
    "serviceRole",
    "anon_key",
    "anonKey",
  ];
  const lowerKey = key.toLowerCase();
  return sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive));
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  requestId?: RequestId;
  route?: string;
  method?: string;
  operation?: string;
  status?: number;
  durationMs?: number;
  provider?: string;
  model?: string;
  retryCount?: number;
  fallbackUsed?: boolean;
  errorCategory?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context: LogContext;
}

function formatLogEntry(level: LogLevel, message: string, context: LogContext): StructuredLogEntry {
  const sanitizedMetadata = context.metadata
    ? sanitizeForLogging(context.metadata)
    : undefined;

  return {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: {
      ...context,
      metadata:
        sanitizedMetadata && !Array.isArray(sanitizedMetadata) && typeof sanitizedMetadata === "object"
          ? sanitizedMetadata
          : undefined,
    },
  };
}

function writeLog(entry: StructuredLogEntry): void {
  try {
    const output = JSON.stringify(entry);
    if (entry.level === "error" || entry.level === "warn") {
      console.error(output);
    } else {
      console.log(output);
    }
  } catch {
    // Logging must never change the request outcome.
  }
}

export function logDebug(message: string, context: LogContext = {}): void {
  writeLog(formatLogEntry("debug", message, context));
}

export function logInfo(message: string, context: LogContext = {}): void {
  writeLog(formatLogEntry("info", message, context));
}

export function logWarn(message: string, context: LogContext = {}): void {
  writeLog(formatLogEntry("warn", message, context));
}

export function logError(message: string, context: LogContext = {}): void {
  writeLog(formatLogEntry("error", message, context));
}

export function createRequestLogger(requestId: RequestId, route: string, method: string) {
  const startTime = Date.now();

  return {
    debug: (message: string, extra?: Partial<LogContext>) =>
      logDebug(message, { requestId, route, method, ...extra }),
    info: (message: string, extra?: Partial<LogContext>) =>
      logInfo(message, { requestId, route, method, ...extra }),
    warn: (message: string, extra?: Partial<LogContext>) =>
      logWarn(message, { requestId, route, method, ...extra }),
    error: (message: string, extra?: Partial<LogContext>) =>
      logError(message, { requestId, route, method, ...extra }),
    withDuration: (extra?: Partial<LogContext>) => ({
      debug: (message: string) =>
        logDebug(message, { requestId, route, method, durationMs: Date.now() - startTime, ...extra }),
      info: (message: string) =>
        logInfo(message, { requestId, route, method, durationMs: Date.now() - startTime, ...extra }),
      warn: (message: string) =>
        logWarn(message, { requestId, route, method, durationMs: Date.now() - startTime, ...extra }),
      error: (message: string) =>
        logError(message, { requestId, route, method, durationMs: Date.now() - startTime, ...extra }),
    }),
  };
}

export type RequestLogger = ReturnType<typeof createRequestLogger>;

type RequestContext = {
  requestId: RequestId;
  logger: RequestLogger;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

export async function withRequestObservability<T extends Response>(
  request: Request,
  route: string,
  handler: (context: RequestContext) => Promise<T>,
): Promise<T> {
  const requestId = getOrCreateRequestId(request.headers.get(REQUEST_ID_HEADER));
  const logger = createRequestLogger(requestId, route, request.method);

  return requestContext.run({ requestId, logger }, async () => {
    logger.info("request.started");
    try {
      const response = await handler({ requestId, logger });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      logger.withDuration({ status: response.status }).info("request.completed");
      return response;
    } catch (error) {
      logger.withDuration({ status: 500, errorCategory: sanitizeError(error).category }).error("request.failed");
      throw error;
    }
  });
}

export type ProviderTelemetryLogEvent = {
  event: string;
  provider: string;
  model?: string;
  durationMs?: number;
  retryCount?: number;
  fallbackTriggered?: boolean;
  errorKind?: string;
};

export function logProviderTelemetry(event: ProviderTelemetryLogEvent): void {
  const context = requestContext.getStore();
  if (!context) return;

  const fields: Partial<LogContext> = {
    operation: `ai.${event.event}`,
    provider: event.provider,
    model: event.model,
    durationMs: event.durationMs,
    retryCount: event.retryCount,
    fallbackUsed: event.fallbackTriggered,
    errorCategory: event.errorKind,
  };

  if (event.event === "provider_failed") {
    context.logger.warn("ai.provider.failed", fields);
  } else {
    context.logger.info("ai.provider.telemetry", fields);
  }
}

export function sanitizeError(error: unknown): { message: string; category: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      category: error.name,
    };
  }
  if (typeof error === "string") {
    return { message: error, category: "Error" };
  }
  return { message: "Unknown error", category: "UnknownError" };
}
