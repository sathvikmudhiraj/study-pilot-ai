import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { generateRevisionPlan, type StudyContext } from "@/backend/lib/aiRevisionPlan";
import { chunkDocument } from "@/backend/lib/documentProcessing";
import { buildQuizAnalytics, emptyQuizAnalytics } from "@/backend/lib/quizAnalytics";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { getAiUserMessage, isAiBusyError, isAiQuotaError } from "@/backend/lib/aiProvider";
import { buildLearnerProfile } from "@/backend/lib/learnerProfile";

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

  const [filesResult, notesResult, summariesResult, quizzesResult, attemptsResult] = await Promise.all([
    supabase
      .from("files")
      .select("file_name, content_type, extracted_text")
      .eq("user_id", userId)
      .in("processing_status", ["completed", "extracted"]),
    supabase.from("notes").select("title, topic, raw_notes").eq("user_id", userId),
    supabase
      .from("ai_outputs")
      .select(
        "suggested_title, covered_topics, key_points, exam_focus_points, common_mistakes, memory_lines, action_items, important_concepts",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("quizzes").select("title, difficulty, questions").eq("user_id", userId),
    supabase
      .from("quiz_attempts")
      .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, wrong_questions, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const files = (filesResult.data ?? []).map((f) => ({
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

async function savePlan(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
  plan: Awaited<ReturnType<typeof generateRevisionPlan>>,
): Promise<PlanRow> {
  const payload = {
    user_id: userId,
    title: plan.title,
    important_topics: plan.important_topics,
    revise_first: plan.revise_first,
    pending_topics: plan.pending_topics,
    daily_plan: plan.daily_plan,
    plan: plan.plan,
    starts_on: plan.starts_on,
    ends_on: plan.ends_on,
  };

  if (!supabase) throw new Error("Supabase is not configured.");

  // Try replacing any existing plan first (upsert semantics: one active plan
  // per user). If that fails with a missing column, try without new columns.
  const existing = await supabase.from("revision_plans").select("id").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();

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

export async function GET() {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const result = await supabase
    .from("revision_plans")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (result.error) {
    devLog("fetch plan failed", { error: result.error.message });
    return errorResponse("Could not load revision plan.", 500, { dbError: result.error.message });
  }

  if (!result.data) {
    return NextResponse.json({ plan: null });
  }

  return NextResponse.json({ plan: result.data });
}

// ---------------------------------------------------------------------------
// POST — aggregate data, generate plan, save
// ---------------------------------------------------------------------------

export async function POST() {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  devLog("request received", { userId: user.id });

  try {
    const ctx = await aggregateStudyContext(supabase, user.id);

    devLog("study context aggregated", {
      fileCount: ctx.files.length,
      noteCount: ctx.notes.length,
      summaryCount: ctx.summaries.length,
      quizCount: ctx.quizzes.length,
      quizAttemptCount: ctx.quiz_analytics.attempt_count,
      weakTopicCount: ctx.quiz_analytics.weak_topics.length,
    });

    if (!ctx.files.length && !ctx.notes.length && !ctx.summaries.length) {
      return errorResponse("No study material found. Upload files or add notes before generating a revision plan.", 400);
    }

    const plan = await generateRevisionPlan(ctx);

    const saved = await savePlan(supabase, user.id, plan);

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
        plan: plan.plan,
        starts_on: plan.starts_on,
        ends_on: plan.ends_on,
      },
    });
  } catch (error) {
    const normalized = normalizeError(error);
    devLog("plan generation failed", { error: normalized });
    return errorResponse(
      normalized,
      isAiBusyError(error) ? 503 : isAiQuotaError(error) ? 429 : 500,
      { error: normalized },
    );
  }
}
