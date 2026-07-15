// Development-only telemetry for Voice Tutor latency measurement
// Only active in development mode (NODE_ENV !== 'production')

type StageName =
  | "speech_start"
  | "speech_end"
  | "final_transcript"
  | "api_request_start"
  | "authentication"
  | "conversation_loading"
  | "message_loading"
  | "file_context_loading"
  | "prompt_building"
  | "ai_provider_request"
  | "ai_provider_response"
  | "response_parsing"
  | "database_persistence"
  | "ui_render"
  | "tts_start";

interface TelemetryEvent {
  stage: StageName;
  requestId: string;
  timestamp: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

interface RequestTelemetry {
  requestId: string;
  startTime: number;
  stages: Map<StageName, { start: number; end?: number; durationMs?: number }>;
  metadata: Record<string, unknown>;
}

const isDev = process.env.NODE_ENV !== "production";
const activeRequests = new Map<string, RequestTelemetry>();
let requestCounter = 0;
let globalStartTime = Date.now();

function generateRequestId(): string {
  requestCounter += 1;
  return `req_${Date.now() - globalStartTime}_${requestCounter}`;
}

export function telemetryStartStage(requestId: string, stage: StageName, metadata?: Record<string, unknown>): void {
  if (!isDev) return;
  const request = activeRequests.get(requestId);
  if (!request) return;
  const now = performance.now();
  const existing = request.stages.get(stage);
  if (existing) {
    existing.start = now;
    existing.end = undefined;
    existing.durationMs = undefined;
  } else {
    request.stages.set(stage, { start: now, metadata });
  }
}

export function telemetryEndStage(requestId: string, stage: StageName): void {
  if (!isDev) return;
  const request = activeRequests.get(requestId);
  if (!request) return;
  const now = performance.now();
  const stageData = request.stages.get(stage);
  if (stageData) {
    stageData.end = now;
    stageData.durationMs = now - stageData.start;
  }
}

export function telemetryRecordDuration(requestId: string, stage: StageName, durationMs: number, metadata?: Record<string, unknown>): void {
  if (!isDev) return;
  const request = activeRequests.get(requestId);
  if (!request) return;
  request.stages.set(stage, { start: performance.now() - durationMs, end: performance.now(), durationMs, metadata });
}

export function telemetryStartRequest(): string {
  if (!isDev) return "";
  const requestId = generateRequestId();
  activeRequests.set(requestId, {
    requestId,
    startTime: performance.now(),
    stages: new Map(),
    metadata: {},
  });
  console.log(`[telemetry] Request started: ${requestId}`);
  return requestId;
}

export function telemetryEndRequest(requestId: string, metadata?: Record<string, unknown>): RequestTelemetry | null {
  if (!isDev) return null;
  const request = activeRequests.get(requestId);
  if (!request) return null;
  
  const totalDuration = performance.now() - request.startTime;
  const result: RequestTelemetry = {
    ...request,
    metadata: { ...request.metadata, ...metadata },
  };
  
  console.log(`[telemetry] Request completed: ${requestId} (${totalDuration.toFixed(2)}ms total)`);
  
  // Log all stages
  const stageNames: StageName[] = [
    "speech_start",
    "speech_end",
    "final_transcript",
    "api_request_start",
    "authentication",
    "conversation_loading",
    "message_loading",
    "file_context_loading",
    "prompt_building",
    "ai_provider_request",
    "ai_provider_response",
    "response_parsing",
    "database_persistence",
    "ui_render",
    "tts_start",
  ];
  
  console.log(`[telemetry] ${requestId} Stage Timings:`);
  for (const stage of stageNames) {
    const stageData = request.stages.get(stage);
    if (stageData?.durationMs !== undefined) {
      console.log(`  ${stage}: ${stageData.durationMs.toFixed(2)}ms`);
    }
  }
  
  activeRequests.delete(requestId);
  return result;
}

export function telemetryGetRequest(requestId: string): RequestTelemetry | undefined {
  return activeRequests.get(requestId);
}

export function telemetrySetMetadata(requestId: string, metadata: Record<string, unknown>): void {
  if (!isDev) return;
  const request = activeRequests.get(requestId);
  if (request) {
    request.metadata = { ...request.metadata, ...metadata };
  }
}

export function telemetryGetAllCompleted(): RequestTelemetry[] {
  // In a real implementation, we'd store completed requests
  return [];
}

export function telemetryLogSummary(): void {
  if (!isDev) return;
  console.log("[telemetry] === LATENCY SUMMARY ===");
}