import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { buildQuizAnalytics, gradeQuizAttempt } from "@/backend/lib/quizAnalytics";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function cleanAnswers(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, answer]) => [key.trim(), String(answer ?? "").trim().slice(0, 2000)] as const)
      .filter(([key]) => Boolean(key))
      .slice(0, 50),
  );
}

function attemptStorageError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("quiz_attempts") || lower.includes("schema cache") || lower.includes("relation")) {
    return "Quiz attempt storage is not configured. Run supabase/schema.sql in Supabase, then try again.";
  }
  return "Could not save this quiz attempt. Please try again.";
}

async function loadAnalytics(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string,
) {
  const result = await supabase
    .from("quiz_attempts")
    .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (result.error) throw result.error;
  return buildQuizAnalytics(result.data ?? []);
}

export async function GET() {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  try {
    return NextResponse.json({ analytics: await loadAnalytics(supabase, user.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quiz attempt query failed.";
    return apiError(attemptStorageError(message), 500);
  }
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  let body: { quizId?: string; answers?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const quizId = body.quizId?.trim();
  const answers = cleanAnswers(body.answers);
  if (!quizId) return apiError("Choose a quiz first.", 400);

  const quizResult = await supabase
    .from("quizzes")
    .select("id, questions, answer_key")
    .eq("id", quizId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (quizResult.error) return apiError("Could not load this quiz.", 500);
  if (!quizResult.data) return apiError("Quiz not found or you do not have access to it.", 404);

  const graded = gradeQuizAttempt({
    questions: quizResult.data.questions,
    answerKey: quizResult.data.answer_key,
    answers,
  });

  if (!graded.total_questions) return apiError("This quiz has no readable questions.", 400);
  if (graded.user_answers.some((answer) => !answer.user_answer)) {
    return apiError("Answer all questions before submitting.", 400);
  }

  const saved = await supabase
    .from("quiz_attempts")
    .insert({
      user_id: user.id,
      quiz_id: quizId,
      ...graded,
    })
    .select("id, quiz_id, score, total_questions, percentage, wrong_questions, weak_topics, strong_topics, created_at")
    .single();

  if (saved.error) return apiError(attemptStorageError(saved.error.message), 500);

  try {
    const analytics = await loadAnalytics(supabase, user.id);
    return NextResponse.json({ attempt: saved.data, analytics });
  } catch {
    return NextResponse.json({ attempt: saved.data, analytics: null });
  }
}
