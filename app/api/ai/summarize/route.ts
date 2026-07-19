import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import {
  analyzeCnsCoverage,
  summarizeStudyText,
  validateCnsExtractionCoverage,
  type StructuredSummary,
} from "@/backend/lib/aiSummary";
import { sanitizeSummaryForDisplay } from "@/shared/summarySanitizer";
import { estimateChunks } from "@/backend/lib/pdfText";
import {
  buildDocumentProcessingMetadata,
  buildGenerationCacheKey,
  chunkDocument,
  createProcessingProgress,
  stableHash,
  type DocumentProcessingMetadata,
} from "@/backend/lib/documentProcessing";
import { processStudyMaterial, type StudyPageMetadata } from "@/backend/lib/studyMaterial";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { buildLearnerProfile, buildSummaryPersonalization } from "@/backend/lib/learnerProfile";
import {
  getAIProviderRuntimeInfo,
  getAiUserMessage,
  isAiBusyError,
  isAiQuotaError,
  isAiTimeoutError,
  SUMMARY_TIMEOUT_MESSAGE,
} from "@/backend/lib/aiProvider";

export const runtime = "nodejs";

// Hard top-level guard for the entire summarize orchestration. Per-call
// provider timeouts can stack across chunks, so we cap the whole job to keep
// the file from being stranded in "summarizing" indefinitely. Slightly below
// the platform/serverless ceiling so our finally block still gets to write a
// terminal status before the function is killed.
const SUMMARY_ORCHESTRATION_TIMEOUT_MS = 110_000;
const SUMMARY_IN_PROGRESS_MESSAGE = "A summary is already being generated for this file. Please wait for it to finish.";

type SummarizeBody = {
  fileId?: string;
  noteId?: string;
  reextractOnly?: boolean;
  // Legacy aliases retained for older clients. They now perform extraction
  // only; summary synthesis is a separate validated action.
  forceRefresh?: boolean;
  // Alternate flag name accepted by the API (true | "true").
  regenerate?: boolean | string;
};

const FULL_EXTRACTION_INCOMPLETE_MESSAGE =
  "Full file extraction is incomplete. Re-extract the file or upload the original PPTX/DOCX.";

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (!isDev()) return;
  console.log(`[summarize] ${message}`, details ?? "");
}

type SummaryOutcome = "completed" | "failed" | "in-progress" | "deduplicated";
type SummaryEvent = {
  fileId?: string | null;
  noteId?: string | null;
  provider: string;
  model: string;
  fallbackProvider?: string | null;
  fallbackModel?: string | null;
  promptChars?: number;
  chunkCount?: number;
  retryCount?: number;
  elapsedMs?: number;
  status: SummaryOutcome;
  error?: string;
};

// Production-visible structured log so summary hangs are observable regardless
// of NODE_ENV. One line per summary job lifecycle event.
function logSummaryEvent(event: SummaryEvent) {
  const payload = {
    scope: "summary",
    fileId: event.fileId ?? null,
    noteId: event.noteId ?? null,
    provider: event.provider,
    model: event.model,
    fallbackProvider: event.fallbackProvider ?? null,
    fallbackModel: event.fallbackModel ?? null,
    promptChars: event.promptChars ?? null,
    chunkCount: event.chunkCount ?? null,
    retryCount: event.retryCount ?? null,
    elapsedMs: event.elapsedMs ?? null,
    status: event.status,
    error: event.error ?? null,
  };
  if (isDev()) {
    console.log(`[summarize] summary-event`, payload);
  } else {
    // Stable JSON line for log aggregation in production.
    console.log(JSON.stringify(payload));
  }
}

function errorResponse(message: string, status = 500, debug?: Record<string, unknown>) {
  return NextResponse.json(
    {
      error: message,
      ...(isDev() && debug ? { debug } : {}),
    },
    { status },
  );
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Network or AI request failed.";
  const lower = message.toLowerCase();

  if (isAiTimeoutError(error)) {
    return SUMMARY_TIMEOUT_MESSAGE;
  }

  const geminiMessage = getAiUserMessage(error);

  if (geminiMessage !== "AI request failed. Please try again.") {
    return geminiMessage;
  }

  if (lower.includes("gemini_api_key") || lower.includes("ai service is not configured")) {
    return "AI service is not configured. Add GEMINI_API_KEY in .env.local.";
  }

  if (lower.includes("quota") || lower.includes("429") || lower.includes("free ai limit")) {
    return "Free AI limit reached. Please try again later.";
  }

  if (lower.includes("json parse")) {
    return "AI returned a summary format StudyPilot could not read. Please try again.";
  }

  if (lower.includes("pdf text extraction failed")) {
    return "No readable text found in this file. Try another file or add manual notes.";
  }

  if (lower.includes("unsupported file type")) {
    return "Unsupported file type.";
  }

  if (lower.includes("file too large")) {
    return "File too large for free-tier processing.";
  }

  if (lower.includes("no supported study files")) {
    return "No supported study files found inside this ZIP.";
  }

  return message;
}

function isMissingColumnLike(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("column") || lower.includes("schema cache") || lower.includes("could not find");
}

async function updateFileStatus(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  {
    fileId,
    userId,
    values,
  }: {
    fileId: string;
    userId: string;
    values: Record<string, unknown>;
  },
) {
  if (!supabase) return;
  const result = await supabase.from("files").update(values).eq("id", fileId).eq("user_id", userId);
  if (!result.error) return;

  if (!isMissingColumnLike(result.error.message)) return;

  const legacyValues = Object.fromEntries(
    Object.entries(values).filter(([key]) => !["content_type", "processing_notes", "extracted_metadata"].includes(key)),
  );

  await supabase.from("files").update(legacyValues).eq("id", fileId).eq("user_id", userId);
}

async function saveSummaryOutput({
  supabase,
  existingId,
  payload,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  existingId?: string;
  payload: Record<string, unknown>;
}) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const write = async (values: Record<string, unknown>) => {
    const query = existingId
      ? supabase.from("ai_outputs").update(values).eq("id", existingId).eq("user_id", values.user_id)
      : supabase.from("ai_outputs").insert(values);

    return query.select().single();
  };

  const result = await write(payload);
  if (!result.error) return result;
  if (!isMissingColumnLike(result.error.message)) throw result.error;

  const legacyWithContent = Object.fromEntries(
    Object.entries(payload).filter(([key]) =>
      [
        "user_id",
        "file_id",
        "note_id",
        "short_summary",
        "key_points",
        "action_items",
        "important_concepts",
        "suggested_tags",
        "suggested_title",
        "suggested_next_step",
        "output_type",
        "content",
      ].includes(key),
    ),
  );

  const contentResult = await write(legacyWithContent);
  if (!contentResult.error) return contentResult;
  if (!isMissingColumnLike(contentResult.error.message)) throw contentResult.error;

  const legacyCore = Object.fromEntries(
    Object.entries(legacyWithContent).filter(([key]) => !["output_type", "content"].includes(key)),
  );
  const coreResult = await write(legacyCore);
  if (coreResult.error) throw coreResult.error;
  return coreResult;
}

async function hasSavedSummary(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  {
    userId,
    fileId,
    noteId,
  }: {
    userId: string;
    fileId: string | null;
    noteId: string | null;
  },
) {
  if (!supabase) return false;

  const query = supabase.from("ai_outputs").select("id").eq("user_id", userId).limit(1);
  const result = fileId ? await query.eq("file_id", fileId).maybeSingle() : await query.eq("note_id", noteId).maybeSingle();
  return Boolean(result.data);
}

async function loadSummaryPersonalization(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
) {
  if (!supabase) return "";
  const result = await supabase
    .from("quiz_attempts")
    .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, wrong_questions, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (result.error) {
    devLog("summary personalization skipped", { error: result.error.message });
    return "";
  }

  return buildSummaryPersonalization(buildLearnerProfile(result.data ?? []));
}

type ReExtractOutcome =
  | { ok: true; text: string; contentType: string; processingNotes: string[]; pageMetadata?: StudyPageMetadata; documentMetadata?: DocumentProcessingMetadata }
  | {
      ok: false;
      reason: "no-storage-path" | "download-failed" | "no-text";
      message: string;
      processingNotes: string[];
      pageMetadata?: StudyPageMetadata;
      documentMetadata?: DocumentProcessingMetadata;
      details?: Record<string, unknown>;
    };

/**
 * Force re-download the original file from Supabase Storage and re-run study
 * material processing. This is used for both the explicit Regenerate Summary
 * action and the coverage-gated re-extraction path. It deliberately ignores
 * any stored extracted_text so a stale/partial extract can never be reused.
 */
async function downloadAndReprocess(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  file: {
    id: string;
    file_name: string;
    mime_type: string | null;
    storage_path: string | null;
  },
  userId: string,
  validateExtractedText?: (text: string) => boolean,
): Promise<ReExtractOutcome> {
  if (!supabase) {
    return {
      ok: false,
      reason: "download-failed",
      message: "Supabase is not configured.",
      processingNotes: ["Fresh extraction failed because storage is unavailable."],
    };
  }

  if (!file.storage_path) {
    return {
      ok: false,
      reason: "no-storage-path",
      message: "The original file is no longer available in storage.",
      processingNotes: ["Fresh extraction failed because the original file is unavailable."],
    };
  }

  const download = await supabase.storage.from("study-files").download(file.storage_path);
  if (download.error) {
    return {
      ok: false,
      reason: "download-failed",
      message: "Could not read the uploaded file from storage.",
      processingNotes: ["Fresh extraction failed because StudyPilot could not read the stored PDF."],
      details: { failureCode: "storage-download" },
    };
  }

  try {
    const buffer = Buffer.from(await download.data.arrayBuffer());
    const processed = await processStudyMaterial({
      buffer,
      fileName: file.file_name,
      mimeType: file.mime_type || download.data.type || "",
      userId,
      validateExtractedText,
    });

    if (!processed.extractedText.trim()) {
      const failureMessage = validateExtractedText
        ? FULL_EXTRACTION_INCOMPLETE_MESSAGE
        : processed.extractionFailure?.message ?? "No readable text found. This file may be scanned or image-based.";
      return {
        ok: false,
        reason: "no-text",
        message: failureMessage,
        processingNotes: processed.processingNotes,
        pageMetadata: processed.pageMetadata,
        documentMetadata: processed.documentMetadata,
        details: {
          contentType: processed.contentType,
          failureCode: processed.extractionFailure?.code ?? "insufficient",
        },
      };
    }

    return {
      ok: true,
      text: processed.extractedText.trim(),
      contentType: processed.contentType,
      processingNotes: processed.processingNotes,
      pageMetadata: processed.pageMetadata,
      documentMetadata: processed.documentMetadata,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      ok: false,
      reason: "no-text",
      message: normalized,
      processingNotes: [`Fresh PDF extraction failed: ${normalized}`],
      details: { failureCode: "processing" },
    };
  }
}

function metadataForSourceText(text: string, sourceId: string | null, stage: "extracted" | "generating" | "complete") {
  const chunks = chunkDocument(text, { sourceId: sourceId ?? "summary-source", dedupe: true });
  return buildDocumentProcessingMetadata({
    text,
    chunks,
    progress: createProcessingProgress(stage === "complete" ? "complete" : stage, {
      chunksProcessed: stage === "generating" ? 0 : chunks.length,
      totalChunks: chunks.length,
      cache: "miss",
    }),
  });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  let body: SummarizeBody;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const fileId = body.fileId?.trim();
  const noteId = body.noteId?.trim();
  const reextractOnly = body.reextractOnly === true || body.forceRefresh === true || body.regenerate === true || body.regenerate === "true";
  const debug: Record<string, unknown> = {
    fileId: fileId ?? null,
    noteId: noteId ?? null,
    reextractOnly,
  };

  devLog("request received", debug);

  if ((!fileId && !noteId) || (fileId && noteId)) {
    return apiError("Provide either fileId or noteId.", 400);
  }
  if (reextractOnly && noteId) {
    return apiError("Re-extraction is available for uploaded files only.", 400);
  }

  let sourceText = "";
  let sourceFileId: string | null = null;
  let sourceNoteId: string | null = null;
  let sourceName = "Study material";

  try {
    if (fileId) {
      sourceFileId = fileId;
      const { data: file, error } = await supabase
        .from("files")
        .select("id, user_id, file_name, mime_type, storage_path, extracted_text, processing_status")
        .eq("id", fileId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      debug.fileRowFound = Boolean(file);
      devLog("file row lookup", { fileId, found: Boolean(file), storagePath: file?.storage_path ?? null });
      if (!file) return errorResponse("File not found.", 404, debug);
      sourceName = file.file_name;

      // Duplicate-job guard: a second "Generate Summary" click on a file that
      // is already being summarized must not kick off a second AI job. The
      // status is the source of truth — if it is still "summarizing" from a
      // prior in-flight request, return a 409 immediately, with the runtime
      // info logged for observability. (Re-extraction sets "extracting" and is
      // handled separately below.)
      const currentStatus = file.processing_status;
      if (!reextractOnly && currentStatus === "summarizing") {
        const runtime = getAIProviderRuntimeInfo("summary");
        logSummaryEvent({
          fileId,
          provider: runtime.configuredProvider,
          model: runtime.primaryModel,
          fallbackProvider: runtime.fallbackProvider,
          fallbackModel: runtime.fallbackModel,
          status: "deduplicated",
        });
        return NextResponse.json(
          {
            error: SUMMARY_IN_PROGRESS_MESSAGE,
          },
          { status: 409 },
        );
      }

      const storedText = (file.extracted_text ?? "").trim();

      let coverage = analyzeCnsCoverage(storedText);
      const strictCoverage = validateCnsExtractionCoverage(storedText, file.file_name);
      const savedCoverageValid = strictCoverage.required ? strictCoverage.valid : storedText.length >= 40;
      debug.coverageFromStoredText = {
        isLikelyCns: coverage.isLikelyCns,
        topicCount: coverage.topicCount,
        detectedTopics: coverage.detectedTopics,
        isWeak: coverage.isWeak,
        strictCoverageRequired: strictCoverage.required,
        strictCoverageValid: strictCoverage.valid,
        missingRequiredTopics: strictCoverage.missingTopics,
      };

      if (!reextractOnly && !savedCoverageValid) {
        const validationNotes = [
          FULL_EXTRACTION_INCOMPLETE_MESSAGE,
          ...(strictCoverage.missingTopics.length
            ? [`Missing required topics: ${strictCoverage.missingTopics.join(", ")}.`]
            : []),
        ];
        const savedSummaryExists = await hasSavedSummary(supabase, { userId: user.id, fileId, noteId: null });
        await updateFileStatus(supabase, {
          fileId: file.id,
          userId: user.id,
          values: {
            processing_status: savedSummaryExists ? "completed" : "failed",
            status: savedSummaryExists ? "completed" : "failed",
            processing_notes: validationNotes,
          },
        });
        return errorResponse(FULL_EXTRACTION_INCOMPLETE_MESSAGE, 409, debug);
      }

      const needsReextract = reextractOnly;
      let sourceOrigin: "stored" | "fresh-extraction" = "stored";

      devLog("extraction decision", {
        fileId,
        storedTextLength: storedText.length,
        savedCoverageValid,
        missingRequiredTopics: strictCoverage.missingTopics,
        reextractOnly,
        needsReextract,
      });

      if (needsReextract) {
        await updateFileStatus(supabase, {
          fileId: file.id,
          userId: user.id,
          values: {
            processing_status: "extracting",
            status: "extracting",
            processing_notes: ["Re-extracting the PDF page by page and validating full-module coverage."],
          },
        });
        debug.storagePath = file.storage_path;
        devLog("fresh re-extraction triggered", {
          fileId,
          storagePath: file.storage_path,
          reason: "explicit-reextract",
        });

        const validateFreshText = (text: string) => {
          const result = validateCnsExtractionCoverage(text, file.file_name);
          return result.required ? result.valid : text.trim().length >= 40;
        };
        const outcome = await downloadAndReprocess(supabase, file, user.id, validateFreshText);

        if (!outcome.ok) {
          devLog("fresh re-extraction failed", {
            fileId,
            reason: outcome.reason,
            failureCode: outcome.details?.failureCode ?? null,
          });

          const savedSummaryExists = await hasSavedSummary(supabase, { userId: user.id, fileId, noteId: null });
          const freshFailureNotes = Array.from(new Set([
            ...outcome.processingNotes.filter(Boolean),
            ...(strictCoverage.required ? [FULL_EXTRACTION_INCOMPLETE_MESSAGE] : []),
          ]));
          await updateFileStatus(supabase, {
            fileId: file.id,
            userId: user.id,
            values: {
              processing_status: savedSummaryExists ? "completed" : "failed",
              status: savedSummaryExists ? "completed" : "failed",
              processing_notes: freshFailureNotes,
              extracted_metadata: {
                ...(outcome.documentMetadata ?? {}),
                ...(outcome.pageMetadata ?? {}),
                processedAt: new Date().toISOString(),
                extractionValidated: false,
                freshExtractionFailureCode: outcome.details?.failureCode ?? outcome.reason,
              },
            },
          });
          const status = outcome.reason === "download-failed" ? 500 : strictCoverage.required ? 409 : 400;
          return errorResponse(strictCoverage.required ? FULL_EXTRACTION_INCOMPLETE_MESSAGE : outcome.message, status, {
            ...debug,
            ...(outcome.details ?? {}),
          });
        }

        sourceText = outcome.text;
        sourceOrigin = "fresh-extraction";
        coverage = analyzeCnsCoverage(sourceText);
        const freshStrictCoverage = validateCnsExtractionCoverage(sourceText, file.file_name);
        if (freshStrictCoverage.required && !freshStrictCoverage.valid) {
          const savedSummaryExists = await hasSavedSummary(supabase, { userId: user.id, fileId, noteId: null });
          await updateFileStatus(supabase, {
            fileId: file.id,
            userId: user.id,
            values: {
              processing_status: savedSummaryExists ? "completed" : "failed",
              status: savedSummaryExists ? "completed" : "failed",
              processing_notes: [
                FULL_EXTRACTION_INCOMPLETE_MESSAGE,
                `Missing required topics: ${freshStrictCoverage.missingTopics.join(", ")}.`,
              ],
              extracted_metadata: {
                ...(outcome.documentMetadata ?? {}),
                ...(outcome.pageMetadata ?? {}),
                processedAt: new Date().toISOString(),
                extractionValidated: false,
                missingRequiredTopics: freshStrictCoverage.missingTopics,
              },
            },
          });
          return errorResponse(FULL_EXTRACTION_INCOMPLETE_MESSAGE, 409, {
            ...debug,
            missingRequiredTopics: freshStrictCoverage.missingTopics,
          });
        }
        const extractedProcessingNotes = Array.from(new Set([
          ...outcome.processingNotes,
          ...(freshStrictCoverage.required
            ? ["Full-module extraction coverage validated successfully."]
            : ["File extraction validation passed successfully."]),
        ]));

        debug.coverageFromResolvedExtraction = {
          isLikelyCns: coverage.isLikelyCns,
          topicCount: coverage.topicCount,
          detectedTopics: coverage.detectedTopics,
          isWeak: coverage.isWeak,
          strictCoverageValid: freshStrictCoverage.valid,
          missingRequiredTopics: freshStrictCoverage.missingTopics,
        };

        debug.contentType = outcome.contentType;
        debug.processingNotes = extractedProcessingNotes;
        debug.extractedTextLength = sourceText.length;
        debug.chunkCount = estimateChunks(sourceText);
        devLog("study material processing resolved", {
          fileId,
          contentType: outcome.contentType,
          extractedTextLength: sourceText.length,
          chunkCount: debug.chunkCount,
          detectedTopics: coverage.detectedTopics,
          processingNotes: extractedProcessingNotes,
        });

        // Persist only after strict coverage validation succeeds.
        await updateFileStatus(supabase, {
          fileId: file.id,
          userId: user.id,
          values: {
            extracted_text: sourceText,
            processing_status: "extracted",
            status: "extracted",
            chunks_count: estimateChunks(sourceText),
            content_type: outcome.contentType,
            processing_notes: extractedProcessingNotes,
            extracted_metadata: {
              ...(outcome.documentMetadata ?? metadataForSourceText(sourceText, file.id, "extracted")),
              ...(outcome.pageMetadata ?? {}),
              extractedTextLength: sourceText.length,
              chunksCount: estimateChunks(sourceText),
              processedAt: new Date().toISOString(),
              reextractedReason: "explicit-reextract",
              coverageTopicCount: coverage.topicCount,
              requiredTopicsDetected: freshStrictCoverage.detectedTopics,
              missingRequiredTopics: freshStrictCoverage.missingTopics,
              extractionValidated: true,
              source: sourceOrigin,
            },
          },
        });

        devLog("extraction completed", {
          fileId,
          extractedTextLength: sourceText.length,
          pageCount: outcome.pageMetadata?.totalPages ?? null,
          extractedPageCount: outcome.pageMetadata?.extractedPageCount ?? null,
          detectedRequiredTopics: freshStrictCoverage.detectedTopics,
        });

        return NextResponse.json({
          extraction: {
            textLength: sourceText.length,
            chunksCount: estimateChunks(sourceText),
            pageCount: outcome.pageMetadata?.totalPages ?? null,
            extractedPageCount: outcome.pageMetadata?.extractedPageCount ?? null,
            detectedTopics: freshStrictCoverage.detectedTopics,
          },
          notice: "Full file extraction completed. You can now regenerate the full-module summary.",
          ...(isDev() ? { debug } : {}),
        });
      } else {
        sourceText = storedText;
        debug.extractedTextLength = sourceText.length;
        const storedChunks = chunkDocument(sourceText, { sourceId: file.id, dedupe: true });
        debug.chunkCount = storedChunks.length;
      }

      debug.sourceOrigin = sourceOrigin;
      debug.detectedCoverageKeywords = coverage.detectedKeywords;
      devLog("source text resolved", { fileId, sourceOrigin, textLength: sourceText.length, chunkCount: estimateChunks(sourceText) });

      await updateFileStatus(supabase, { fileId: file.id, userId: user.id, values: { processing_status: "summarizing", status: "summarizing" } });
      const runtimeInfo = getAIProviderRuntimeInfo("summary");
      devLog("summary provider/model started", {
        fileId,
        extractedTextLength: sourceText.length,
        chunkCount: estimateChunks(sourceText),
        provider: runtimeInfo.configuredProvider,
        primaryModel: runtimeInfo.primaryModel,
        fallbackProvider: runtimeInfo.fallbackProvider,
        fallbackModel: runtimeInfo.fallbackModel,
        timeoutMs: runtimeInfo.timeoutMs,
        fastFallbackTimeoutMs: runtimeInfo.fastFallbackTimeoutMs,
      });
    }

    if (noteId) {
      sourceNoteId = noteId;
      const { data: note, error } = await supabase
        .from("notes")
        .select("id, user_id, title, raw_notes")
        .eq("id", noteId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;
      devLog("note row lookup", { noteId, found: Boolean(note) });
      if (!note) return errorResponse("Note not found.", 404, debug);
      sourceName = note.title || "Manual note";
      sourceText = (note.raw_notes ?? "").trim();
    }

    if (!sourceText) {
      return errorResponse("No readable text found in this file. Try another file or add manual notes.", 400, debug);
    }

    const chunkCount = estimateChunks(sourceText);
    const runtimeInfo = getAIProviderRuntimeInfo("summary");
    const summaryStartedAt = Date.now();
    const personalizationHint = await loadSummaryPersonalization(supabase, user.id);
    const contentHash = stableHash(sourceText);
    const summaryCacheKey = buildGenerationCacheKey({
      fileId: sourceFileId,
      noteId: sourceNoteId,
      contentHash,
      generationType: "summary",
      provider: runtimeInfo.configuredProvider,
      model: runtimeInfo.primaryModel,
      promptVersion: "summary-v3-sanitized-hierarchical",
      personalizationHash: stableHash(personalizationHint || "none"),
    });
    debug.personalizedSummary = Boolean(personalizationHint);
    debug.summaryCacheKey = summaryCacheKey.slice(0, 12);
    let orchestrationTimeoutFired = false;
    let orchestrationAborted = false;

    // Hard top-level timeout so a hung provider stack (Gemini fast-attempt +
    // NVIDIA fallback + coverage retries stacked across N chunks) can never
    // strand the file in "summarizing". The finally block below reconciles to
    // a terminal state if the timer wins the race.
    let orchestrationTimerId: ReturnType<typeof setTimeout> | undefined;
    const orchestrationTimer = new Promise<never>((_, reject) => {
      orchestrationTimerId = setTimeout(() => {
        orchestrationTimeoutFired = true;
        reject(new Error("Summary orchestration timed out."));
      }, SUMMARY_ORCHESTRATION_TIMEOUT_MS);
    });

    let summary: StructuredSummary;
    try {
      summary = sanitizeSummaryForDisplay(await Promise.race([
        summarizeStudyText(sourceText, {
          sourceId: sourceFileId ?? sourceNoteId ?? undefined,
          sourceType: sourceFileId ? "file" : "note",
          sourceName,
          personalizationHint,
        }),
        orchestrationTimer,
      ]));
      const elapsedMs = Date.now() - summaryStartedAt;
      debug.summaryElapsedMs = elapsedMs;
      debug.coveredTopicsCount = summary.covered_topics.length;
      logSummaryEvent({
        fileId: sourceFileId,
        noteId: sourceNoteId,
        provider: runtimeInfo.configuredProvider,
        model: runtimeInfo.primaryModel,
        fallbackProvider: runtimeInfo.fallbackProvider,
        fallbackModel: runtimeInfo.fallbackModel,
        promptChars: sourceText.length,
        chunkCount,
        elapsedMs,
        status: "completed",
      });
      devLog("AI summarization complete", {
        fileId: sourceFileId,
        noteId: sourceNoteId,
        sourceOrigin: debug.sourceOrigin ?? "note",
        coveredTopicsCount: summary.covered_topics.length,
        elapsedMs,
      });
    } catch (summaryError) {
      orchestrationAborted = true;
      const elapsedMs = Date.now() - summaryStartedAt;
      const retryCount =
        typeof (summaryError as { retries?: unknown })?.retries === "number"
          ? Number((summaryError as { retries: number }).retries)
          : 0;
      logSummaryEvent({
        fileId: sourceFileId,
        noteId: sourceNoteId,
        provider: runtimeInfo.configuredProvider,
        model: runtimeInfo.primaryModel,
        fallbackProvider: runtimeInfo.fallbackProvider,
        fallbackModel: runtimeInfo.fallbackModel,
        promptChars: sourceText.length,
        chunkCount,
        retryCount,
        elapsedMs,
        status: "failed",
        error:
          (orchestrationTimeoutFired ? "orchestration-timeout" : "") ||
          (summaryError instanceof Error ? summaryError.message : "summary-failed"),
      });
      // Re-throw so the outer catch reconciles status to failed/extracted
      // exactly like any other AI failure.
      throw summaryError;
    } finally {
      // Clear the orchestration timer so it can never resolve/reject after we
      // already settled (avoids an unhandled rejection on the success path).
      if (orchestrationTimerId) clearTimeout(orchestrationTimerId);
      // Terminal-state guarantee: no matter how we exit (timeout, error, or
      // success), a file that is STILL recorded as "summarizing" gets pushed
      // to a terminal state here. The success path overwrote it to
      // "completed" already; this catches the abandoned/timeout case where
      // the outer try hadn't run the success status write yet.
      if (sourceFileId && orchestrationAborted) {
        await updateFileStatus(supabase, {
          fileId: sourceFileId,
          userId: user.id,
          values: { processing_status: "failed", status: "failed" },
        });
      }
    }
    debug.coveredTopicsCount = summary.covered_topics.length;

    const existingQuery = supabase
      .from("ai_outputs")
      .select("id")
      .eq("user_id", user.id)
      // Order by created_at desc so the row we update is the same row the
      // file-detail RSC displays (which also orders by created_at desc).
      // Without this, the lookup is non-deterministic and regeneration could
      // update an older row while the UI reads a newer one.
      .order("created_at", { ascending: false })
      .limit(1);

    const existing = sourceFileId
      ? await existingQuery.eq("file_id", sourceFileId).maybeSingle()
      : await existingQuery.eq("note_id", sourceNoteId).maybeSingle();

    if (existing.error) throw existing.error;

    const sanitizedSummary = sanitizeSummaryForDisplay(summary);

    const payload = {
      user_id: user.id,
      file_id: sourceFileId,
      note_id: sourceNoteId,
      output_type: "summary",
      content: JSON.stringify(sanitizedSummary),
      ...sanitizedSummary,
    };

    const saved = await saveSummaryOutput({
      supabase,
      existingId: existing.data?.id,
      payload,
    });

    if (sourceFileId) {
      // A successful (even partial) regeneration completes the file's AI
      // processing pipeline. Partial coverage is flagged on the saved summary
      // row itself via the generation_metadata content blob; the file row's
      // status remains "completed" so the user can still act on it.
      await updateFileStatus(supabase, {
        fileId: sourceFileId,
        userId: user.id,
        values: {
          processing_status: "completed",
          status: "completed",
          chunks_count: chunkDocument(sourceText, { sourceId: sourceFileId, dedupe: true }).length,
          extracted_metadata: metadataForSourceText(sourceText, sourceFileId, "complete"),
        },
      });
    }

    const generationMetadata = summary.generation_metadata;
    const partialCoverage = Boolean(generationMetadata?.partialCoverage);
    const notice = partialCoverage
      ? `Partial summary saved: ${generationMetadata?.successfulChunks.length ?? 0} of ${generationMetadata?.attemptedChunks ?? 0} source sections processed. Some source sections were unavailable. Regenerate to retry the full module.`
      : "";

    return NextResponse.json({
      summary: sanitizeSummaryForDisplay({ ...(saved.data ?? {}), ...sanitizedSummary }),
      regenerationSucceeded: true,
      staleSummary: false,
      partialCoverage,
      elapsedMs: typeof debug.summaryElapsedMs === "number" ? debug.summaryElapsedMs : undefined,
      ...(notice ? { notice } : {}),
      ...(isDev() ? { debug } : {}),
    });
  } catch (error) {
    const normalized = normalizeError(error) || "Unknown summarization error.";
    devLog("summarization failed", { fileId: sourceFileId, noteId: sourceNoteId, error: normalized, busy: isAiBusyError(error), quota: isAiQuotaError(error) });
    const savedSummaryExists = await hasSavedSummary(supabase, {
      userId: user.id,
      fileId: sourceFileId,
      noteId: sourceNoteId,
    });
    if (sourceFileId) {
      // Regeneration failed. Do NOT mark the file as "completed": this would
      // mask the fact that the displayed summary is a stale saved row from a
      // previous run. Keep it as "extracted" (a valid, supported status that
      // also keeps the file eligible for the /api/revision route's
      // ["completed","extracted"] filter) when there's any valid extraction to
      // fall back to, otherwise "failed". We never overwrite the valid
      // extracted_text — the catch block only writes status fields.
      const fallbackStatus =
        debug.sourceOrigin === "fresh-extraction" || savedSummaryExists
          ? "extracted"
          : "failed";
      await updateFileStatus(supabase, {
        fileId: sourceFileId,
        userId: user.id,
        values: { processing_status: fallbackStatus, status: fallbackStatus },
      });
    }
    const status = isAiBusyError(error) ? 503 : isAiQuotaError(error) ? 429 : 500;
    // When a saved summary already exists, the front-end must know it is
    // showing a stale saved row, not a freshly generated one. Return:
    // - staleSummary: true
    // - regenerationSucceeded: false
    // - a user-facing notice that labels the displayed summary as older.
    if (savedSummaryExists) {
      const staleNotice =
        "Summary regeneration failed. The displayed summary is an older saved version.";
      return NextResponse.json(
        {
          error: normalized,
          notice: staleNotice,
          staleSummary: true,
          regenerationSucceeded: false,
          ...(isDev() ? { debug, error: normalized } : {}),
        },
        { status },
      );
    }
    return errorResponse(normalized, status, {
      ...debug,
      error: normalized,
      staleSummary: false,
      regenerationSucceeded: false,
    });
  }
}
