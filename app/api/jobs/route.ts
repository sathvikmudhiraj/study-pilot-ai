import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import {
  buildJobIdempotencyKey,
  enqueueBackgroundJob,
  readBackgroundJobs,
  type BackgroundJobType,
} from "@/backend/lib/backgroundJobs";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";
import { isSupportedLanguageCode } from "@/shared/languages";

export const runtime = "nodejs";

type JobRequestBody = {
  jobType?: unknown;
  fileId?: unknown;
  noteId?: unknown;
  language?: unknown;
};

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseJobType(value: unknown): BackgroundJobType | null {
  const raw = stringValue(value);
  if (raw === "pdf_extraction" || raw === "summary_generation") return raw;
  return null;
}

async function verifySourceOwnership(userId: string, fileId: string, noteId: string) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) throw new Error("Supabase is not configured.");

  if (fileId) {
    const result = await supabase.from("files").select("id").eq("id", fileId).eq("user_id", userId).maybeSingle();
    if (result.error) throw result.error;
    return Boolean(result.data);
  }

  if (noteId) {
    const result = await supabase.from("notes").select("id").eq("id", noteId).eq("user_id", userId).maybeSingle();
    if (result.error) throw result.error;
    return Boolean(result.data);
  }

  return false;
}

export async function GET(request: Request) {
  return withRequestObservability(request, "/api/jobs", async () => {
    const user = await requireUser();
    if (!user) return apiError("Please log in first.", 401);
    const jobs = await readBackgroundJobs(50, user.id);
    return NextResponse.json({
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
  return withRequestObservability(request, "/api/jobs", async () => {
    const user = await requireUser();
    if (!user) return apiError("Please log in first.", 401);

    let body: JobRequestBody;
    try {
      const value = await request.json();
      body = value && typeof value === "object" && !Array.isArray(value) ? value as JobRequestBody : {};
    } catch {
      return apiError("Invalid request body.", 400);
    }

    const jobType = parseJobType(body.jobType);
    if (!jobType) return apiError("Choose a supported job type.", 400);

    const fileId = stringValue(body.fileId);
    const noteId = stringValue(body.noteId);
    if (jobType === "pdf_extraction" && !fileId) return apiError("Choose a file to extract.", 400);
    if (jobType === "summary_generation" && !fileId && !noteId) return apiError("Choose a file or note to summarize.", 400);
    if (fileId && noteId) return apiError("Choose either a file or a note, not both.", 400);

    const language = stringValue(body.language) || user.preferredLanguage;
    if (!isSupportedLanguageCode(language)) return apiError("Choose a supported language.", 400);

    const ownsSource = await verifySourceOwnership(user.id, fileId, noteId);
    if (!ownsSource) return apiError("Source not found or you do not have access to it.", 404);

    try {
      const job = await enqueueBackgroundJob({
        jobType,
        userId: user.id,
        fileId: fileId || null,
        noteId: noteId || null,
        payload: { language },
        idempotencyKey: buildJobIdempotencyKey([jobType, user.id, fileId, noteId, language]),
      });
      return NextResponse.json({ job }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not enqueue background job.";
      return apiError(message, 500);
    }
  });
}
