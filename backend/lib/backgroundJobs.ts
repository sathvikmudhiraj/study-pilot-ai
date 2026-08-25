import "server-only";

import crypto from "node:crypto";
import { createAdminSupabaseClient, hasAdminSupabaseEnv } from "./adminSupabase";
import { recordMonitoringEvent } from "./monitoring";
import { sanitizeError, sanitizeForLogging } from "./observability";

export type BackgroundJobType = "pdf_extraction" | "summary_generation";
export type BackgroundJobStatus = "queued" | "processing" | "retrying" | "completed" | "failed" | "cancelled";

export type BackgroundJobRow = {
  id: string;
  job_type: BackgroundJobType;
  status: BackgroundJobStatus;
  user_id: string | null;
  file_id: string | null;
  note_id: string | null;
  idempotency_key: string | null;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  attempt_count: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  next_run_at: string;
  last_error_category: string | null;
  last_error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type EnqueueJobInput = {
  jobType: BackgroundJobType;
  userId?: string | null;
  fileId?: string | null;
  noteId?: string | null;
  idempotencyKey?: string | null;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
};

const DEFAULT_STALE_LOCK_MS = 15 * 60 * 1000;
const MAX_RETRY_DELAY_SECONDS = 300;

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[backgroundJobs] ${message}`, details ?? "");
}

function requireJobsConfigured() {
  if (!hasAdminSupabaseEnv()) throw new Error("Background jobs require SUPABASE_SERVICE_ROLE_KEY.");
}

function sanitizePayload(payload: Record<string, unknown> | undefined) {
  const sanitized = sanitizeForLogging(payload ?? {});
  if (sanitized && !Array.isArray(sanitized) && typeof sanitized === "object") {
    return sanitized as Record<string, unknown>;
  }
  return {};
}

function getStaleLockMs() {
  const configured = Number(process.env.STUDYPILOT_JOB_STALE_LOCK_MS);
  if (Number.isFinite(configured) && configured >= 60_000) return configured;
  return DEFAULT_STALE_LOCK_MS;
}

export function buildJobIdempotencyKey(parts: Array<string | number | boolean | null | undefined>) {
  return crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part ?? "")).join(":"))
    .digest("hex");
}

export async function enqueueBackgroundJob(input: EnqueueJobInput): Promise<BackgroundJobRow> {
  requireJobsConfigured();
  const supabase = createAdminSupabaseClient();
  const idempotencyKey = input.idempotencyKey ?? buildJobIdempotencyKey([
    input.jobType,
    input.userId,
    input.fileId,
    input.noteId,
    JSON.stringify(sanitizePayload(input.payload)),
  ]);

  const existing = await supabase
    .from("background_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing.data && !existing.error) return existing.data as BackgroundJobRow;

  const result = await supabase
    .from("background_jobs")
    .insert({
      job_type: input.jobType,
      user_id: input.userId ?? null,
      file_id: input.fileId ?? null,
      note_id: input.noteId ?? null,
      idempotency_key: idempotencyKey,
      payload: sanitizePayload(input.payload),
      progress: { stage: "queued" },
      max_attempts: Math.max(1, Math.min(input.maxAttempts ?? 3, 10)),
    })
    .select()
    .single();

  if (result.error) throw result.error;
  return result.data as BackgroundJobRow;
}

export async function claimNextBackgroundJob(workerId: string): Promise<BackgroundJobRow | null> {
  requireJobsConfigured();
  const supabase = createAdminSupabaseClient();
  const now = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - getStaleLockMs()).toISOString();

  const staleJobs = await supabase
    .from("background_jobs")
    .select("*")
    .eq("status", "processing")
    .lte("locked_at", staleCutoff)
    .order("locked_at", { ascending: true })
    .limit(10);

  if (staleJobs.error) throw staleJobs.error;

  for (const staleJob of (staleJobs.data ?? []) as BackgroundJobRow[]) {
    const exhausted = staleJob.attempt_count >= staleJob.max_attempts;
    const { error } = await supabase
      .from("background_jobs")
      .update({
        status: exhausted ? "failed" : "retrying",
        locked_at: null,
        locked_by: null,
        next_run_at: now,
        completed_at: exhausted ? now : null,
        last_error_category: "StaleWorkerLock",
        last_error_message: "Worker lock expired before the job completed.",
        progress: sanitizePayload({
          ...staleJob.progress,
          stage: exhausted ? "failed" : "retrying",
          staleLockRecovered: true,
        }),
      })
      .eq("id", staleJob.id)
      .eq("status", "processing");

    if (error) devLog("stale lock recovery failed", { jobId: staleJob.id, error: error.message });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const next = await supabase
      .from("background_jobs")
      .select("*")
      .in("status", ["queued", "retrying"])
      .lte("next_run_at", now)
      .order("next_run_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (next.error) throw next.error;
    if (!next.data) return null;

    const job = next.data as BackgroundJobRow;
    const claimed = await supabase
      .from("background_jobs")
      .update({
        status: "processing",
        locked_at: now,
        locked_by: workerId,
        started_at: job.started_at ?? now,
        attempt_count: job.attempt_count + 1,
        progress: { ...job.progress, stage: "processing", attempt: job.attempt_count + 1 },
      })
      .eq("id", job.id)
      .in("status", ["queued", "retrying"])
      .select()
      .maybeSingle();

    if (claimed.error) throw claimed.error;
    if (claimed.data) return claimed.data as BackgroundJobRow;

    await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }

  return null;
}

export async function updateBackgroundJobProgress(jobId: string, progress: Record<string, unknown>) {
  requireJobsConfigured();
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from("background_jobs").update({ progress: sanitizePayload(progress) }).eq("id", jobId);
  if (error) devLog("progress update failed", { jobId, error: error.message });
}

export async function completeBackgroundJob(job: BackgroundJobRow, progress: Record<string, unknown> = {}) {
  requireJobsConfigured();
  const supabase = createAdminSupabaseClient();
  const now = new Date().toISOString();
  let query = supabase
    .from("background_jobs")
    .update({
      status: "completed",
      completed_at: now,
      locked_at: null,
      locked_by: null,
      progress: sanitizePayload({ ...job.progress, ...progress, stage: "completed" }),
    })
    .eq("id", job.id)
    .eq("status", "processing");
  if (job.locked_by) query = query.eq("locked_by", job.locked_by);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw error;
  if (!data) {
    devLog("complete skipped because job ownership changed", { jobId: job.id, lockedBy: job.locked_by });
    return;
  }

  await recordMonitoringEvent({
    eventType: "job.completed",
    errorCategory: null,
    metadata: { jobId: job.id, jobType: job.job_type, fileId: job.file_id, noteId: job.note_id },
  });
}

export function getBackgroundJobRetryPlan(job: Pick<BackgroundJobRow, "attempt_count" | "max_attempts">, nowMs = Date.now()) {
  const shouldRetry = job.attempt_count < job.max_attempts;
  const delaySeconds = Math.min(MAX_RETRY_DELAY_SECONDS, 20 * 2 ** Math.max(0, job.attempt_count - 1));
  return {
    shouldRetry,
    delaySeconds,
    nextRunAt: shouldRetry ? new Date(nowMs + delaySeconds * 1000).toISOString() : null,
    finalStatus: shouldRetry ? "retrying" : "failed",
  } as const;
}

export async function failBackgroundJob(job: BackgroundJobRow, error: unknown, progress: Record<string, unknown> = {}) {
  requireJobsConfigured();
  const supabase = createAdminSupabaseClient();
  const sanitized = sanitizeError(error);
  const retryPlan = getBackgroundJobRetryPlan(job);
  let query = supabase
    .from("background_jobs")
    .update({
      status: retryPlan.finalStatus,
      locked_at: null,
      locked_by: null,
      next_run_at: retryPlan.nextRunAt ?? new Date().toISOString(),
      last_error_category: sanitized.category,
      last_error_message: sanitized.message,
      completed_at: retryPlan.shouldRetry ? null : new Date().toISOString(),
      progress: sanitizePayload({
        ...job.progress,
        ...progress,
        stage: retryPlan.finalStatus,
        nextRunAt: retryPlan.nextRunAt,
      }),
    })
    .eq("id", job.id)
    .eq("status", "processing");
  if (job.locked_by) query = query.eq("locked_by", job.locked_by);
  const { data, error: updateError } = await query.select("id").maybeSingle();
  if (updateError) throw updateError;
  if (!data) {
    devLog("failure update skipped because job ownership changed", { jobId: job.id, lockedBy: job.locked_by });
    return;
  }

  await recordMonitoringEvent({
    eventType: "job.failed",
    errorCategory: sanitized.category,
    metadata: {
      jobId: job.id,
      jobType: job.job_type,
      fileId: job.file_id,
      noteId: job.note_id,
      retrying: retryPlan.shouldRetry,
    },
  });
}

export async function readBackgroundJobs(limit = 25, userId?: string): Promise<BackgroundJobRow[]> {
  if (!hasAdminSupabaseEnv()) return [];
  try {
    const supabase = createAdminSupabaseClient();
    let query = supabase
      .from("background_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Math.min(limit, 100)));

    if (userId) query = query.eq("user_id", userId);

    const { data, error } = await query;

    if (error) {
      devLog("read jobs failed", { error: error.message });
      return [];
    }

    return (data ?? []) as BackgroundJobRow[];
  } catch (error) {
    devLog("read jobs failed", { error: error instanceof Error ? error.message : "unknown" });
    return [];
  }
}
