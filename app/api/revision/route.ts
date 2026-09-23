import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { generateRevisionPlan, type StudyContext } from "@/backend/lib/aiRevisionPlan";
import { chunkDocument } from "@/backend/lib/documentProcessing";
import { buildQuizAnalytics, emptyQuizAnalytics } from "@/backend/lib/quizAnalytics";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";
import { getAiUserMessage, isAiBusyError, isAiQuotaError } from "@/backend/lib/aiProvider";
import { buildLearnerProfile } from "@/backend/lib/learnerProfile";
import { isSupportedLanguageCode, type SupportedLanguageCode } from "@/shared/languages";
import { enforceAiRateLimit } from "@/backend/lib/rateLimit";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (!isDev()) return;
  console.log(`[revision] ${message}`, details ?? "");
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
  if (lower.includes("json parse") || lower.includes("could not read")) {
    return "AI returned a plan format StudyPilot could not read. Please try again.";
  }

  return message;
}

function isMissingColumnLike(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("column") || lower.includes("schema cache") || lower.includes("could not find");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function revisionCoverageText(text: string, fileName: string, maxChunks = 18) {
  const chunks = chunkDocument(text, { sourceId: fileName, dedupe: true });
  if (chunks.length <= maxChunks) return text;

  const stride = Math.max(1, Math.floor(chunks.length / maxChunks));
  const indexes = new Set<number>();
  for (let index = 0; index < chunks.length && indexes.size < maxChunks; index += stride) {
    indexes.add(index);
  }
  indexes.add(chunks.length - 1);

  const selected = [...indexes]
    .sort((a, b) => a - b)
    .slice(0, maxChunks)
    .map((index) => chunks[index])
    .filter(Boolean);

  return [
    `PROCESSING COVERAGE NOTICE: Revision planning is using ${selected.length} representative chunks out of ${chunks.length} extracted document chunks for "${fileName}". Keep the plan full-chapter, and mark any uncovered areas as retry/continue candidates.`,
    ...selected.map((chunk) => {
      const locator = chunk.startPage
        ? `pages ${chunk.startPage}${chunk.endPage && chunk.endPage !== chunk.startPage ? `-${chunk.endPage}` : ""}`
        : `chunk ${chunk.index + 1}`;
      return `[${locator}]\n${chunk.text}`;
    }),
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Data aggregation
// ---------------------------------------------------------------------------

async function aggregateStudyContext(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  language: SupportedLanguageCode,
  sourceFile?: RevisionSourceFile | null,
): Promise<StudyContext> {
  const empty: StudyContext = {
    files: [],
    notes: [],
    summaries: [],
    quizzes: [],
    quiz_analytics: { attempt_count: 0, strong_topics: [], weak_topics: [], last_quiz_score: null },
    learner_profile: buildLearnerProfile([]),
  };
  if (!supabase) return empty;

  const filesQuery = supabase
    .from("files")
    .select("file_name, content_type, extracted_text")
    .eq("user_id", userId);
  const notesQuery = supabase.from("notes").select("title, topic, raw_notes").eq("user_id", userId);
  const summariesQuery = supabase
    .from("ai_outputs")
    .select(
      "suggested_title, covered_topics, key_points, exam_focus_points, common_mistakes, memory_lines, action_items, important_concepts",
    )
    .eq("user_id", userId)
    .eq("language_code", language)
    .order("created_at", { ascending: false });
  const quizzesQuery = supabase.from("quizzes").select("title, difficulty, questions").eq("user_id", userId).eq("language_code", language);

  if (sourceFile) {
    filesQuery.eq("id", sourceFile.id);
    notesQuery.eq("file_id", sourceFile.id);
    summariesQuery.eq("file_id", sourceFile.id).limit(5);
    quizzesQuery.eq("file_id", sourceFile.id);
  } else {
    filesQuery.in("processing_status", ["completed", "extracted"]);
    summariesQuery.limit(20);
  }

  const [filesResult, notesResult, summariesResult, quizzesResult, attemptsResult] = await Promise.all([
    filesQuery,
    notesQuery,
    summariesQuery,
    quizzesQuery,
    supabase
      .from("quiz_attempts")
      .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, wrong_questions, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const sourceRows = sourceFile && !(filesResult.data ?? []).length
    ? [sourceFile]
    : filesResult.data ?? [];
  const files = sourceRows.map((f) => ({
    file_name: String(f.file_name ?? "Untitled"),
    content_type: f.content_type as string | null,
    extracted_text: revisionCoverageText(String(f.extracted_text ?? ""), String(f.file_name ?? "Untitled")),
  }));

  const notes = (notesResult.data ?? []).map((n) => ({
    title: String(n.title ?? "Untitled note"),
    topic: n.topic as string | null,
    raw_notes: String(n.raw_notes ?? ""),
  }));

  const summaries = (summariesResult.data ?? []).map((s) => ({
    suggested_title: s.suggested_title as string | null,
    covered_topics: stringList(s.covered_topics),
    key_points: stringList(s.key_points),
    exam_focus_points: stringList(s.exam_focus_points),
    common_mistakes: stringList(s.common_mistakes),
    memory_lines: stringList(s.memory_lines),
    action_items: stringList(s.action_items),
    important_concepts: stringList(s.important_concepts),
  }));

  const quizzes = (quizzesResult.data ?? []).map((q) => ({
    title: q.title as string | null,
    difficulty: q.difficulty as string | null,
    question_count: Array.isArray(q.questions) ? q.questions.length : 0,
  }));

  const attemptRows = attemptsResult.error ? [] : attemptsResult.data ?? [];
  const quizAnalytics = attemptsResult.error ? emptyQuizAnalytics : buildQuizAnalytics(attemptRows);
  const learnerProfile = buildLearnerProfile(attemptRows);
  const quiz_analytics = {
    attempt_count: quizAnalytics.attemptCount,
    strong_topics: quizAnalytics.strongTopics,
    weak_topics: quizAnalytics.weakTopics,
    last_quiz_score: quizAnalytics.lastQuizScore
      ? {
          score: quizAnalytics.lastQuizScore.score,
          total: quizAnalytics.lastQuizScore.total,
          percentage: quizAnalytics.lastQuizScore.percentage,
          attempted_at: quizAnalytics.lastQuizScore.attemptedAt,
        }
      : null,
  };

  return { files, notes, summaries, quizzes, quiz_analytics, learner_profile: learnerProfile };
}

// ---------------------------------------------------------------------------
// Persist revision plan
// ---------------------------------------------------------------------------

type PlanRow = {
  id: string;
  user_id: string;
  title: string | null;
  important_topics: unknown;
  revise_first: unknown;
  pending_topics: unknown;
  daily_plan: unknown;
  plan: unknown;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
};

type RevisionSourceFile = {
  id: string;
  file_name: string;
  content_type: string | null;
  extracted_text: string | null;
  processing_status?: string | null;
};

type RevisionRequestBody = {
  language?: SupportedLanguageCode;
  fileId?: string;
};

function cleanUuid(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : "";
}

function planSourceFileId(row: { plan?: unknown }) {
  const plan = row.plan && typeof row.plan === "object" ? row.plan as Record<string, unknown> : null;
  return typeof plan?.source_file_id === "string" ? plan.source_file_id : null;
}

async function findOwnedRevisionFile(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  fileId: string,
): Promise<RevisionSourceFile | null> {
  if (!supabase) return null;
  const result = await supabase
    .from("files")
    .select("id, file_name, content_type, extracted_text, processing_status")
    .eq("id", fileId)
    .eq("user_id", userId)
    .maybeSingle();

  if (result.error) throw result.error;
  return result.data as RevisionSourceFile | null;
}

async function getExistingRevisionPlan(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  language: SupportedLanguageCode,
  fileId: string | null,
) {
  if (!supabase) return null;

  if (fileId) {
    const result = await supabase
      .from("revision_plans")
      .select("*")
      .eq("user_id", userId)
      .eq("language_code", language)
      .contains("plan", { source_file_id: fileId })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (result.error) throw result.error;
    return result.data as PlanRow | null;
  }

  const result = await supabase
    .from("revision_plans")
    .select("*")
    .eq("user_id", userId)
    .eq("language_code", language)
    .order("created_at", { ascending: false })
    .limit(20);

  if (result.error) throw result.error;
  return ((result.data ?? []) as PlanRow[]).find((row) => !planSourceFileId(row)) ?? null;
}

async function savePlan(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  plan: Awaited<ReturnType<typeof generateRevisionPlan>>,
  language: SupportedLanguageCode,
  sourceFile: RevisionSourceFile | null,
): Promise<PlanRow> {
  const payload = {
    user_id: userId,
    title: plan.title,
    important_topics: plan.important_topics,
    revise_first: plan.revise_first,
    pending_topics: plan.pending_topics,
    daily_plan: plan.daily_plan,
    plan: {
      ...plan.plan,
      ...(sourceFile ? { source_file_id: sourceFile.id, source_file_name: sourceFile.file_name } : {}),
    },
    starts_on: plan.starts_on,
    ends_on: plan.ends_on,
    language_code: language,
  };

  if (!supabase) throw new Error("Supabase is not configured.");

  // Try replacing any existing plan first (upsert semantics: one active plan
  // per user). If that fails with a missing column, try without new columns.
  const existingPlan = await getExistingRevisionPlan(supabase, userId, language, sourceFile?.id ?? null);
  const existing = existingPlan ? { data: { id: existingPlan.id }, error: null } : { data: null, error: null };

  if (existing.data && !existing.error) {
    const result = await supabase.from("revision_plans").update(payload).eq("id", existing.data.id).eq("user_id", userId).select().single();
    if (!result.error) return result.data as PlanRow;
    if (!isMissingColumnLike(result.error.message)) throw result.error;

    // Fallback without columns that may not exist
    const fallback = { ...payload };
    delete (fallback as Record<string, unknown>).plan;
    delete (fallback as Record<string, unknown>).starts_on;
    delete (fallback as Record<string, unknown>).ends_on;
    const fbResult = await supabase.from("revision_plans").update(fallback).eq("id", existing.data.id).eq("user_id", userId).select().single();
    if (!fbResult.error) return fbResult.data as PlanRow;
    throw fbResult.error;
  }

  // Insert new plan
  const result = await supabase.from("revision_plans").insert(payload).select().single();
  if (!result.error) return result.data as PlanRow;
  if (!isMissingColumnLike(result.error.message)) throw result.error;

  const fallback = { ...payload };
  delete (fallback as Record<string, unknown>).plan;
  delete (fallback as Record<string, unknown>).starts_on;
  delete (fallback as Record<string, unknown>).ends_on;
  const fbResult = await supabase.from("revision_plans").insert(fallback).select().single();
  if (!fbResult.error) return fbResult.data as PlanRow;
  throw fbResult.error;
}

// ---------------------------------------------------------------------------
// GET — fetch the latest plan
// ---------------------------------------------------------------------------

async function handleGet(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);
  const requestedLanguage = new URL(request.url).searchParams.get("language");
  if (requestedLanguage && !isSupportedLanguageCode(requestedLanguage)) return apiError("Choose a supported language.", 400);
  const language: SupportedLanguageCode = requestedLanguage && isSupportedLanguageCode(requestedLanguage)
    ? requestedLanguage
    : user.preferredLanguage;
  const fileId = cleanUuid(new URL(request.url).searchParams.get("fileId"));
  let sourceFile: RevisionSourceFile | null = null;

  if (fileId) {
    sourceFile = await findOwnedRevisionFile(supabase, user.id, fileId);
    if (!sourceFile) return apiError("File not found or you do not have access to it.", 404);
  }

  let plan: PlanRow | null = null;
  try {
    plan = await getExistingRevisionPlan(supabase, user.id, language, fileId || null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load revision plan.";
    devLog("fetch plan failed", { error: message });
    return errorResponse("Could not load revision plan.", 500, { dbError: message });
  }

  if (!plan) {
    return NextResponse.json({ plan: null, sourceFile });
  }

  return NextResponse.json({ plan, sourceFile });
}

// ---------------------------------------------------------------------------
// POST — aggregate data, generate plan, save
// ---------------------------------------------------------------------------

async function handlePost(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const rateLimited = enforceAiRateLimit(user.id);
  if (rateLimited) return rateLimited;

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);
  let body: RevisionRequestBody = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is valid and uses the saved preference.
  }
  if (body.language !== undefined && !isSupportedLanguageCode(body.language)) return apiError("Choose a supported language.", 400);
  const language = body.language ?? user.preferredLanguage;
  const fileId = cleanUuid(body.fileId);
  let sourceFile: RevisionSourceFile | null = null;

  // Create AbortController for request timeout (server-side budget: ~30s)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s hard stop

  if (fileId) {
    sourceFile = await findOwnedRevisionFile(supabase, user.id, fileId);
    if (!sourceFile) {
      clearTimeout(timeoutId);
      return apiError("File not found or you do not have access to it.", 404);
    }

    const existing = await getExistingRevisionPlan(supabase, user.id, language, fileId);
    if (existing) {
      clearTimeout(timeoutId);
      return NextResponse.json({ plan: existing, sourceFile, reused: true });
    }
  }

  devLog("request received", { userId: user.id, fileId: fileId || null });

  try {
    const ctx = await aggregateStudyContext(supabase, user.id, language, sourceFile);

    devLog("study context aggregated", {
      fileCount: ctx.files.length,
      noteCount: ctx.notes.length,
      summaryCount: ctx.summaries.length,
      quizCount: ctx.quizzes.length,
      quizAttemptCount: ctx.quiz_analytics.attempt_count,
      weakTopicCount: ctx.quiz_analytics.weak_topics.length,
    });

    if (!ctx.files.length && !ctx.notes.length && !ctx.summaries.length) {
      clearTimeout(timeoutId);
      return errorResponse("No study material found. Upload files or add notes before generating a revision plan.", 400);
    }

    // Pass the AbortSignal to the AI generation for proper timeout propagation
    const plan = await generateRevisionPlan(ctx, language, controller.signal);

    clearTimeout(timeoutId);

    const saved = await savePlan(supabase, user.id, plan, language, sourceFile);

    devLog("plan saved", { planId: saved.id, title: saved.title });

    return NextResponse.json({
      plan: {
        ...saved,
        // Merge validated plan fields on top for consistent typing
        title: plan.title,
        important_topics: plan.important_topics,
        revise_first: plan.revise_first,
        pending_topics: plan.pending_topics,
        daily_plan: plan.daily_plan,
        plan: {
          ...plan.plan,
          ...(sourceFile ? { source_file_id: sourceFile.id, source_file_name: sourceFile.file_name } : {}),
        },
        starts_on: plan.starts_on,
        ends_on: plan.ends_on,
      },
      sourceFile,
      reused: false,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    
    // Check if it was an abort/timeout
    if (error instanceof Error && error.name === "AbortError") {
      devLog("revision generation aborted due to timeout", { fileId: fileId || null });
      return errorResponse(
        "Revision plan generation timed out. Please try again.",
        504,
        { error: "timeout", fileId: fileId || null }
      );
    }
    
    const normalized = normalizeError(error);
    devLog("plan generation failed", { error: normalized });
    return errorResponse(
      normalized,
      isAiBusyError(error) ? 503 : isAiQuotaError(error) ? 429 : 500,
      { error: normalized },
    );
  }
}

export async function GET(request: Request) {
  return withRequestObservability(request, "/api/revision", async () => handleGet(request));
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/revision", async () => handlePost(request));
}
