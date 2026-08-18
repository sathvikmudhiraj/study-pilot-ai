import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireAdmin } from "@/backend/lib/auth";
import { runBackgroundWorkerOnce } from "@/backend/lib/backgroundWorker";
import { readBackgroundJobs } from "@/backend/lib/backgroundJobs";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 120;

function workerSecretConfigured() {
  return Boolean(process.env.STUDYPILOT_WORKER_SECRET?.trim());
}

function timingSafeSecretEqual(provided: string, configured: string) {
  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);
  return providedBuffer.length === configuredBuffer.length && crypto.timingSafeEqual(providedBuffer, configuredBuffer);
}

async function authorizeWorker(request: Request) {
  const configuredSecret = process.env.STUDYPILOT_WORKER_SECRET?.trim();
  if (configuredSecret) {
    const provided = request.headers.get("x-studypilot-worker-secret")?.trim();
    if (provided && timingSafeSecretEqual(provided, configuredSecret)) return { ok: true as const };
  }

  const admin = await requireAdmin();
  if (admin.ok) return { ok: true as const };
  return { ok: false as const, status: admin.status, message: admin.message };
}

export async function GET(request: Request) {
  return withRequestObservability(request, "/api/jobs/worker", async () => {
    const auth = await authorizeWorker(request);
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });
    const jobs = await readBackgroundJobs(25);
    return NextResponse.json({
      secretConfigured: workerSecretConfigured(),
      jobs: jobs.map((job) => ({
        id: job.id,
        job_type: job.job_type,
        status: job.status,
        file_id: job.file_id,
        note_id: job.note_id,
        progress: job.progress,
        attempt_count: job.attempt_count,
        max_attempts: job.max_attempts,
        next_run_at: job.next_run_at,
        last_error_category: job.last_error_category,
        last_error_message: job.last_error_message,
        created_at: job.created_at,
        updated_at: job.updated_at,
      })),
    });
  });
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/jobs/worker", async ({ logger }) => {
    const auth = await authorizeWorker(request);
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

    let maxJobs = 1;
    try {
      const body = await request.json();
      if (typeof body?.maxJobs === "number" && Number.isFinite(body.maxJobs)) maxJobs = body.maxJobs;
    } catch {
      // Empty body is valid.
    }

    const workerId = `worker_${crypto.randomUUID()}`;
    const result = await runBackgroundWorkerOnce({ workerId, maxJobs });
    logger.info("background.worker.completed", { metadata: { workerId, ...result } });
    return NextResponse.json({ workerId, ...result });
  });
}
