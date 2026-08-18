import "server-only";

import {
  claimNextBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  updateBackgroundJobProgress,
  type BackgroundJobRow,
} from "./backgroundJobs";
import { createAdminSupabaseClient } from "./adminSupabase";
import { analyzeCnsCoverage, summarizeStudyText, validateCnsExtractionCoverage } from "./aiSummary";
import { processStudyMaterial } from "./studyMaterial";
import { chunkDocument } from "./documentProcessing";
import { sanitizeSummaryForDisplay } from "@/shared/summarySanitizer";
import { DEFAULT_LANGUAGE, isSupportedLanguageCode, type SupportedLanguageCode } from "@/shared/languages";
import { recordMonitoringEvent } from "./monitoring";

type WorkerRunResult = {
  claimed: number;
  completed: number;
  failed: number;
};

type FileRow = {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string | null;
  storage_path: string | null;
  extracted_text?: string | null;
};

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[backgroundWorker] ${message}`, details ?? "");
}

function payloadLanguage(job: BackgroundJobRow): SupportedLanguageCode {
  const language = String(job.payload?.language ?? DEFAULT_LANGUAGE);
  return isSupportedLanguageCode(language) ? language : DEFAULT_LANGUAGE;
}

function isCnsFile(fileName: string, text: string) {
  return /cns|cryptography|network[-\s]?security/i.test(fileName) || analyzeCnsCoverage(text).isLikelyCns;
}

async function updateFile(
  fileId: string,
  userId: string,
  values: Record<string, unknown>,
) {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from("files").update(values).eq("id", fileId).eq("user_id", userId);
  if (error) throw error;
}

async function processPdfExtractionJob(job: BackgroundJobRow) {
  if (!job.file_id || !job.user_id) throw new Error("PDF extraction job is missing file/user context.");
  const supabase = createAdminSupabaseClient();
  const fileResult = await supabase
    .from("files")
    .select("id, user_id, file_name, mime_type, storage_path")
    .eq("id", job.file_id)
    .eq("user_id", job.user_id)
    .maybeSingle();

  if (fileResult.error) throw fileResult.error;
  const file = fileResult.data as FileRow | null;
  if (!file) throw new Error("File not found for PDF extraction job.");
  if (!file.storage_path) throw new Error("File storage path is missing.");

  await updateBackgroundJobProgress(job.id, { stage: "downloading", fileId: file.id });
  await updateFile(file.id, file.user_id, {
    processing_status: "extracting",
    status: "extracting",
    processing_notes: ["Background extraction started."],
  });

  const download = await supabase.storage.from("study-files").download(file.storage_path);
  if (download.error) throw new Error("Could not read the uploaded file from storage.");

  const buffer = Buffer.from(await download.data.arrayBuffer());
  await updateBackgroundJobProgress(job.id, { stage: "extracting", fileId: file.id, byteSize: buffer.length });

  const validateExtractedText = (text: string) => {
    const coverage = validateCnsExtractionCoverage(text, file.file_name);
    return coverage.required ? coverage.valid : text.trim().length >= 40;
  };
  const processed = await processStudyMaterial({
    buffer,
    fileName: file.file_name,
    mimeType: file.mime_type || download.data.type || "",
    userId: file.user_id,
    validateExtractedText,
  });

  if (!processed.extractedText.trim()) {
    await updateFile(file.id, file.user_id, {
      processing_status: "failed",
      status: "failed",
      processing_notes: processed.processingNotes,
      extracted_metadata: {
        ...(processed.documentMetadata ?? {}),
        ...(processed.pageMetadata ?? {}),
        extractionValidated: false,
        processedBy: "background-worker",
      },
    });
    throw new Error(processed.extractionFailure?.message ?? "No readable text found during background extraction.");
  }

  const coverage = isCnsFile(file.file_name, processed.extractedText)
    ? validateCnsExtractionCoverage(processed.extractedText, file.file_name)
    : null;
  if (coverage?.required && !coverage.valid) {
    await updateFile(file.id, file.user_id, {
      processing_status: "failed",
      status: "failed",
      processing_notes: [
        "Full file extraction is incomplete. Re-extract the file or upload the original PPTX/DOCX.",
        `Missing required topics: ${coverage.missingTopics.join(", ")}.`,
      ],
      extracted_metadata: {
        ...(processed.documentMetadata ?? {}),
        ...(processed.pageMetadata ?? {}),
        extractionValidated: false,
        missingRequiredTopics: coverage.missingTopics,
        processedBy: "background-worker",
      },
    });
    throw new Error("Full file extraction is incomplete.");
  }

  await updateFile(file.id, file.user_id, {
    extracted_text: processed.extractedText,
    processing_status: "extracted",
    status: "extracted",
    chunks_count: processed.chunksCount,
    content_type: processed.contentType,
    processing_notes: [...processed.processingNotes, "Background extraction completed."],
    extracted_metadata: {
      ...(processed.documentMetadata ?? {}),
      ...(processed.pageMetadata ?? {}),
      extractionValidated: true,
      processedBy: "background-worker",
    },
  });

  await completeBackgroundJob(job, {
    fileId: file.id,
    textLength: processed.extractedText.length,
    chunksCount: processed.chunksCount,
    pageCount: processed.pageMetadata?.totalPages ?? null,
    extractedPageCount: processed.pageMetadata?.extractedPageCount ?? null,
  });
}

async function saveSummary(job: BackgroundJobRow, summary: Awaited<ReturnType<typeof summarizeStudyText>>, language: SupportedLanguageCode) {
  if (!job.user_id) throw new Error("Summary job is missing user context.");
  const supabase = createAdminSupabaseClient();
  const sanitizedSummary = sanitizeSummaryForDisplay(summary);
  const existingQuery = supabase
    .from("ai_outputs")
    .select("id")
    .eq("user_id", job.user_id)
    .eq("language_code", language)
    .order("created_at", { ascending: false })
    .limit(1);

  const existing = job.file_id
    ? await existingQuery.eq("file_id", job.file_id).maybeSingle()
    : await existingQuery.eq("note_id", job.note_id ?? "").maybeSingle();
  if (existing.error) throw existing.error;

  const payload = {
    user_id: job.user_id,
    file_id: job.file_id,
    note_id: job.note_id,
    output_type: "summary",
    language_code: language,
    content: JSON.stringify(sanitizedSummary),
    ...sanitizedSummary,
  };

  const result = existing.data?.id
    ? await supabase.from("ai_outputs").update(payload).eq("id", String(existing.data.id)).eq("user_id", job.user_id).select().single()
    : await supabase.from("ai_outputs").insert(payload).select().single();

  if (result.error) throw result.error;
  return result.data;
}

async function processSummaryGenerationJob(job: BackgroundJobRow) {
  if (!job.user_id || (!job.file_id && !job.note_id)) throw new Error("Summary job is missing source context.");
  const supabase = createAdminSupabaseClient();
  const language = payloadLanguage(job);
  let sourceText = "";
  let sourceName = "Study material";
  let sourceType: "file" | "note" = "file";

  await updateBackgroundJobProgress(job.id, { stage: "loading-source" });

  if (job.file_id) {
    const result = await supabase
      .from("files")
      .select("id, user_id, file_name, extracted_text")
      .eq("id", job.file_id)
      .eq("user_id", job.user_id)
      .maybeSingle();
    if (result.error) throw result.error;
    const file = result.data as FileRow | null;
    if (!file) throw new Error("File not found for summary job.");
    sourceName = file.file_name;
    sourceText = String(file.extracted_text ?? "").trim();
    if (!sourceText) throw new Error("No extracted text found for summary job.");
  } else if (job.note_id) {
    const result = await supabase
      .from("notes")
      .select("id, user_id, title, raw_notes")
      .eq("id", job.note_id)
      .eq("user_id", job.user_id)
      .maybeSingle();
    if (result.error) throw result.error;
    const note = result.data as { title?: string | null; raw_notes?: string | null } | null;
    if (!note) throw new Error("Note not found for summary job.");
    sourceType = "note";
    sourceName = note.title || "Manual note";
    sourceText = String(note.raw_notes ?? "").trim();
  }

  await updateBackgroundJobProgress(job.id, {
    stage: "summarizing",
    textLength: sourceText.length,
    chunksCount: chunkDocument(sourceText, { sourceId: job.file_id ?? job.note_id ?? "summary-job" }).length,
  });

  const summary = await summarizeStudyText(sourceText, {
    sourceId: job.file_id ?? job.note_id ?? undefined,
    sourceType,
    sourceName,
    language,
  });
  const saved = await saveSummary(job, summary, language);
  if (job.file_id && job.user_id) {
    await updateFile(job.file_id, job.user_id, {
      processing_status: "completed",
      status: "completed",
      chunks_count: chunkDocument(sourceText, { sourceId: job.file_id, dedupe: true }).length,
    });
  }

  await completeBackgroundJob(job, { summaryId: (saved as { id?: string })?.id ?? null, language });
}

async function processJob(job: BackgroundJobRow) {
  await recordMonitoringEvent({
    eventType: "job.started",
    metadata: { jobId: job.id, jobType: job.job_type, fileId: job.file_id, noteId: job.note_id },
  });
  devLog("job started", { jobId: job.id, jobType: job.job_type, attempt: job.attempt_count });

  if (job.job_type === "pdf_extraction") {
    await processPdfExtractionJob(job);
    return;
  }
  if (job.job_type === "summary_generation") {
    await processSummaryGenerationJob(job);
    return;
  }
  throw new Error(`Unsupported background job type: ${job.job_type}`);
}

export async function runBackgroundWorkerOnce({
  workerId,
  maxJobs = 1,
}: {
  workerId: string;
  maxJobs?: number;
}): Promise<WorkerRunResult> {
  const result: WorkerRunResult = { claimed: 0, completed: 0, failed: 0 };
  const limit = Math.max(1, Math.min(maxJobs, 5));

  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextBackgroundJob(workerId);
    if (!job) break;
    result.claimed += 1;
    try {
      await processJob(job);
      result.completed += 1;
    } catch (error) {
      result.failed += 1;
      devLog("job failed", {
        jobId: job.id,
        jobType: job.job_type,
        error: error instanceof Error ? error.message : "unknown",
      });
      await failBackgroundJob(job, error);
    }
  }

  return result;
}
