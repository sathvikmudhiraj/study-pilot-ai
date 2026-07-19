import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { buildAnswerKey, generateQuiz, type QuizDifficulty, type QuizQuestionType } from "@/backend/lib/aiQuiz";
import { chunkDocument } from "@/backend/lib/documentProcessing";
import { processStudyMaterial } from "@/backend/lib/studyMaterial";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { getAiUserMessage, isAiBusyError, isAiQuotaError } from "@/backend/lib/aiProvider";
import { sanitizeQuizForClient } from "@/backend/lib/quizSecurity";
import { buildLearnerProfile, buildPersonalizedQuizOptions } from "@/backend/lib/learnerProfile";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Helpers (mirror app/api/revision/route.ts)
// ---------------------------------------------------------------------------

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (!isDev()) return;
  console.log(`[quiz] ${message}`, details ?? "");
}

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
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
  const geminiMessage = getAiUserMessage(error);
  if (geminiMessage !== "AI request failed. Please try again.") return geminiMessage;

  const message = error instanceof Error ? error.message : "Network or AI request failed.";
  const lower = message.toLowerCase();

  if (lower.includes("gemini_api_key") || lower.includes("ai service is not configured")) {
    return "AI service is not configured. Add GEMINI_API_KEY in .env.local.";
  }
  if (lower.includes("quota") || lower.includes("429") || lower.includes("free ai limit")) {
    return "Free AI limit reached. Please try again later.";
  }
  if (lower.includes("json") || lower.includes("could not read") || lower.includes("quiz format")) {
    return "AI returned a quiz format StudyPilot could not read. Please try again.";
  }
  if (lower.includes("no readable text")) {
    return "No readable text found to generate a quiz from. Try another file or add manual notes.";
  }

  return message;
}

function isMissingColumnLike(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("column") || lower.includes("schema cache") || lower.includes("could not find");
}

class BadRequestError extends Error {}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function asDifficulty(value: unknown): QuizDifficulty | undefined {
  const lower = String(value ?? "").toLowerCase().trim();
  if (lower === "easy" || lower === "medium" || lower === "hard") return lower;
  return undefined;
}

function asQuestionTypes(value: unknown): QuizQuestionType[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const types = value
    .map((item) => String(item ?? "").toLowerCase().trim())
    .filter((item): item is QuizQuestionType => item === "mcq" || item === "short");
  return uniqueInOrder(types);
}

function uniqueInOrder<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function chapterCoverageText(text: string, fileId: string | null, maxChunks = 14) {
  const chunks = chunkDocument(text, { sourceId: fileId ?? "quiz-source", dedupe: true });
  if (chunks.length <= maxChunks) {
    return { text, chunksCount: chunks.length, partialCoverage: false };
  }

  const selectedIndexes = new Set<number>();
  const stride = Math.max(1, Math.floor(chunks.length / maxChunks));
  for (let index = 0; index < chunks.length && selectedIndexes.size < maxChunks; index += stride) {
    selectedIndexes.add(index);
  }
  selectedIndexes.add(chunks.length - 1);

  const selected = [...selectedIndexes]
    .sort((a, b) => a - b)
    .slice(0, maxChunks)
    .map((index) => chunks[index])
    .filter(Boolean);

  return {
    text: [
      `PROCESSING COVERAGE NOTICE: Quiz generation is using ${selected.length} representative chunks out of ${chunks.length} extracted document chunks to preserve broad chapter coverage within the AI budget.`,
      ...selected.map((chunk) => {
        const locator = chunk.startPage
          ? `pages ${chunk.startPage}${chunk.endPage && chunk.endPage !== chunk.startPage ? `-${chunk.endPage}` : ""}`
          : `chunk ${chunk.index + 1}`;
        return `[${locator}]\n${chunk.text}`;
      }),
    ].join("\n\n"),
    chunksCount: chunks.length,
    partialCoverage: true,
  };
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

type SourceResolution = {
  text: string;
  fileId: string | null;
  noteId: string | null;
  summaryId: string | null;
  chunksCount?: number;
  partialCoverage?: boolean;
};

type SummaryRow = {
  id: string;
  user_id: string;
  short_summary: string | null;
  module_overview: string | null;
  covered_topics: unknown;
  key_points: unknown;
  topic_wise_summary: unknown;
  exam_focus_points: unknown;
  important_concepts: unknown;
  memory_lines: unknown;
  common_mistakes: unknown;
  action_items: unknown;
  content: string | null;
  suggested_title: string | null;
};

function readableSummaryText(row: SummaryRow): string {
  // The ai_outputs.content column stores the full StructuredSummary as JSON.
  // Merge it on top of the top-level columns so the quiz has rich material
  // regardless of which summary shape was saved.
  let merged: Record<string, unknown> = { ...row };
  if (row.content) {
    try {
      const parsed = JSON.parse(row.content);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        merged = { ...parsed, ...row };
      }
    } catch {
      // fall back to top-level columns only
    }
  }

  const topicWise = Array.isArray(merged.topic_wise_summary) ? merged.topic_wise_summary : [];
  const topicBlocks = topicWise
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const r = item as Record<string, unknown>;
      const topic = String(r.topic ?? r.title ?? "").trim();
      const explanation = String(r.explanation ?? "").trim();
      const points = stringList(r.important_points);
      if (!topic && !explanation && !points.length) return "";
      return [topic ? `Topic: ${topic}` : null, explanation || null, points.length ? `Points: ${points.join("; ")}` : null].filter(Boolean).join("\n");
    })
    .filter(Boolean);

  const sections = [
    merged.suggested_title ? `Summary: ${merged.suggested_title}` : null,
    merged.short_summary ? `Short summary: ${merged.short_summary}` : null,
    merged.module_overview ? `Overview: ${merged.module_overview}` : null,
    stringList(merged.covered_topics).length ? `Covered topics: ${stringList(merged.covered_topics).join(", ")}` : null,
    stringList(merged.key_points).length ? `Key points:\n${stringList(merged.key_points).map((p) => `- ${p}`).join("\n")}` : null,
    topicBlocks.length ? `Topic-wise summary:\n${topicBlocks.join("\n\n")}` : null,
    stringList(merged.exam_focus_points).length ? `Exam focus: ${stringList(merged.exam_focus_points).join("; ")}` : null,
    stringList(merged.important_concepts).length ? `Important concepts: ${stringList(merged.important_concepts).join("; ")}` : null,
    stringList(merged.common_mistakes).length ? `Common mistakes: ${stringList(merged.common_mistakes).join("; ")}` : null,
    stringList(merged.memory_lines).length ? `Memory lines: ${stringList(merged.memory_lines).join("; ")}` : null,
    stringList(merged.action_items).length ? `Action items: ${stringList(merged.action_items).join("; ")}` : null,
  ].filter(Boolean);

  return sections.join("\n\n").trim();
}

async function getLatestFileSummaryText(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string,
  fileId: string,
) {
  const { data, error } = await supabase
    .from("ai_outputs")
    .select(
      "id, user_id, short_summary, module_overview, covered_topics, key_points, topic_wise_summary, exam_focus_points, important_concepts, memory_lines, common_mistakes, action_items, content, suggested_title",
    )
    .eq("user_id", userId)
    .eq("file_id", fileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    devLog("file summary context skipped", { fileId, error: error.message });
    return "";
  }

  return data ? readableSummaryText(data as SummaryRow) : "";
}

async function resolveSource(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  user: { id: string },
  body: QuizBody,
): Promise<SourceResolution> {
  const sources = [body.fileId, body.noteId, body.summaryId].filter(Boolean);
  if (sources.length !== 1) {
    throw new BadRequestError("Provide exactly one source: fileId, noteId, or summaryId.");
  }

  if (body.fileId) {
    const { data: file, error } = await supabase
      .from("files")
      .select("id, user_id, file_name, mime_type, storage_path, extracted_text")
      .eq("id", body.fileId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!file) throw new BadRequestError("File not found.");

    let text = (file.extracted_text ?? "").trim();

    // If there is no stored text but the original is still in storage, extract
    // it on demand so quizzes work on files that were uploaded but never
    // summarized. Mirrors the summarize route's re-extraction path.
    if (!text && file.storage_path) {
      const download = await supabase.storage.from("study-files").download(file.storage_path);
      if (download.error) {
        throw new Error("Could not read the uploaded file from storage.");
      }
      const buffer = Buffer.from(await download.data.arrayBuffer());
      const processed = await processStudyMaterial({
        buffer,
        fileName: file.file_name,
        mimeType: file.mime_type || download.data.type || "",
        userId: user.id,
      });
      text = processed.extractedText.trim();

      // Persist the recovered extraction for later use.
      await supabase
        .from("files")
        .update({
          extracted_text: text,
          processing_status: "extracted",
          status: "extracted",
          chunks_count: processed.chunksCount,
          content_type: processed.contentType,
          processing_notes: processed.processingNotes,
          extracted_metadata: processed.documentMetadata,
        })
        .eq("id", file.id)
        .eq("user_id", user.id);
    }

    if (!text) {
      throw new BadRequestError("No readable text found in this file. Try another file or add manual notes.");
    }

    const summaryText = await getLatestFileSummaryText(supabase, user.id, file.id);
    if (summaryText) {
      text = [
        "SAVED SUMMARY CONTEXT:",
        summaryText,
        "SELECTED FILE EXTRACTED TEXT:",
        text,
      ].join("\n\n");
    }

    const coverage = chapterCoverageText(text, file.id);
    return {
      text: coverage.text,
      fileId: file.id,
      noteId: null,
      summaryId: null,
      chunksCount: coverage.chunksCount,
      partialCoverage: coverage.partialCoverage,
    };
  }

  if (body.noteId) {
    const { data: note, error } = await supabase
      .from("notes")
      .select("id, user_id, raw_notes")
      .eq("id", body.noteId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!note) throw new BadRequestError("Note not found.");
    const text = (note.raw_notes ?? "").trim();
    if (!text) throw new BadRequestError("This note has no content to build a quiz from.");
    return { text, fileId: null, noteId: note.id, summaryId: null };
  }

  // summaryId
  const { data: summary, error } = await supabase
    .from("ai_outputs")
    .select(
      "id, user_id, short_summary, module_overview, covered_topics, key_points, topic_wise_summary, exam_focus_points, important_concepts, memory_lines, common_mistakes, action_items, content, suggested_title",
    )
    .eq("id", body.summaryId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (!summary) throw new BadRequestError("Summary not found.");

  const text = readableSummaryText(summary as SummaryRow);
  if (!text) throw new BadRequestError("This summary has no content to build a quiz from.");
  return { text, fileId: null, noteId: null, summaryId: summary.id };
}

// ---------------------------------------------------------------------------
// Persist quiz
// ---------------------------------------------------------------------------

type QuizRow = {
  id: string;
  user_id: string;
  file_id: string | null;
  note_id: string | null;
  quiz_title: string | null;
  title: string | null;
  difficulty: string | null;
  questions: unknown;
  answer_key: unknown;
  created_at: string;
  updated_at: string;
};

async function saveQuiz(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  user: { id: string },
  source: SourceResolution,
  quiz: Awaited<ReturnType<typeof generateQuiz>>,
): Promise<QuizRow> {
  const payload = {
    user_id: user.id,
    file_id: source.fileId,
    note_id: source.noteId,
    quiz_title: quiz.title,
    title: quiz.title,
    difficulty: quiz.difficulty,
    questions: quiz.questions,
    answer_key: buildAnswerKey(quiz.questions),
  };

  const result = await supabase.from("quizzes").insert(payload).select().single();
  if (!result.error) return result.data as QuizRow;
  if (!isMissingColumnLike(result.error.message)) throw result.error;

  // Fallback without optional columns that may not exist on older schemas.
  const fallback = { ...payload };
  delete (fallback as Record<string, unknown>).quiz_title;
  const fbResult = await supabase.from("quizzes").insert(fallback).select().single();
  if (!fbResult.error) return fbResult.data as QuizRow;
  throw fbResult.error;
}

async function loadLearnerQuizOptions(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string,
) {
  const result = await supabase
    .from("quiz_attempts")
    .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, wrong_questions, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (result.error) {
    devLog("learner profile skipped for quiz", { error: result.error.message });
    return buildPersonalizedQuizOptions(buildLearnerProfile([]));
  }

  return buildPersonalizedQuizOptions(buildLearnerProfile(result.data ?? []));
}

// ---------------------------------------------------------------------------
// Request body type
// ---------------------------------------------------------------------------

type QuizBody = {
  fileId?: string;
  noteId?: string;
  summaryId?: string;
  count?: number;
  difficulty?: string;
  questionTypes?: unknown;
};

// ---------------------------------------------------------------------------
// GET — return the user's saved quizzes
// ---------------------------------------------------------------------------

export async function GET() {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const result = await supabase
    .from("quizzes")
    .select("id, user_id, file_id, note_id, quiz_title, title, difficulty, questions, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (result.error) {
    devLog("fetch quizzes failed", { error: result.error.message });
    return errorResponse("Could not load saved quizzes.", 500, { dbError: result.error.message });
  }

  return NextResponse.json({
    quizzes: (result.data ?? []).map((quiz) => sanitizeQuizForClient(quiz as Record<string, unknown>)),
  });
}

// ---------------------------------------------------------------------------
// POST — resolve source, generate quiz, save
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  let body: QuizBody;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const count = typeof body.count === "number" && Number.isFinite(body.count) ? body.count : undefined;
  const difficulty = asDifficulty(body.difficulty);
  const questionTypes = asQuestionTypes(body.questionTypes);

  const debug: Record<string, unknown> = {
    fileId: body.fileId ?? null,
    noteId: body.noteId ?? null,
    summaryId: body.summaryId ?? null,
    count: count ?? null,
    difficulty: difficulty ?? null,
    questionTypes: questionTypes ?? null,
  };
  devLog("request received", debug);

  try {
    const source = await resolveSource(supabase, user, body);
    debug.sourceTextLength = source.text.length;
    debug.sourceChunksCount = source.chunksCount ?? null;
    debug.partialSourceCoverage = Boolean(source.partialCoverage);
    const personalized = await loadLearnerQuizOptions(supabase, user.id);
    debug.personalizedFocusTopics = personalized.focusTopics;

    const quiz = await generateQuiz(source.text, {
      count,
      difficulty: difficulty ?? personalized.difficulty,
      questionTypes,
      focusTopics: personalized.focusTopics,
      personalizationNote: personalized.extraQuestionBias,
    });

    devLog("quiz generated", {
      title: quiz.title,
      difficulty: quiz.difficulty,
      questionCount: quiz.questions.length,
    });

    const saved = await saveQuiz(supabase, user, source, quiz);

    devLog("quiz saved", { quizId: saved.id });

    return NextResponse.json({
      quiz: sanitizeQuizForClient(
        {
          ...saved,
          // Merge validated fields on top for consistent typing on the client.
          title: quiz.title,
          quiz_title: quiz.title,
          difficulty: quiz.difficulty,
        },
        {
          questions: quiz.questions,
          source_summary: quiz.source_summary,
        },
      ),
    });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return errorResponse(error.message, 400, debug);
    }
    const normalized = normalizeError(error);
    devLog("quiz generation failed", {
      error: normalized,
      busy: isAiBusyError(error),
      quota: isAiQuotaError(error),
    });
    return errorResponse(
      normalized,
      isAiBusyError(error) ? 503 : isAiQuotaError(error) ? 429 : 500,
      { ...debug, error: normalized },
    );
  }
}
