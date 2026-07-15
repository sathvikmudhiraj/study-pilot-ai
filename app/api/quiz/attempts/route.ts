import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { buildQuizAnalytics, gradeQuizAttempt } from "@/backend/lib/quizAnalytics";
import { buildReviewAnswerKey, findUnknownAnswerQuestionIds, normalizeSubmittedAnswers } from "@/backend/lib/quizSecurity";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

type QuizAttemptRequestBody = {
  quizId?: string;
  fileId?: string | null;
  answers?: unknown;
  score?: unknown;
};

type CorrectAnswerResult = {
  questionId: string;
  userAnswer: string;
};

type WrongAnswerResult = {
  questionId: string;
  question: string;
  userAnswer: string;
  correctAnswer: string;
};

type SecureQuizGradeResponse = {
  score: number;
  totalQuestions: number;
  percentage: number;
  correctAnswers: CorrectAnswerResult[];
  wrongAnswers: WrongAnswerResult[];
};

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
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

  let body: QuizAttemptRequestBody;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  if (Object.prototype.hasOwnProperty.call(body, "score")) {
    return apiError("Client-provided scores are not accepted.", 400);
  }

  const quizId = body.quizId?.trim();
  const fileId = typeof body.fileId === "string" && body.fileId.trim() ? body.fileId.trim() : null;
  const submitted = normalizeSubmittedAnswers(body.answers);
  if (!quizId) return apiError("Choose a quiz first.", 400);
  if (submitted.invalid) return apiError("Submit answers as questionId and selectedAnswer pairs.", 400);
  if (submitted.duplicateQuestionIds.length) return apiError("Duplicate question IDs are not allowed.", 400);

  const quizResult = await supabase
    .from("quizzes")
    .select("id, file_id, questions, answer_key")
    .eq("id", quizId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (quizResult.error) return apiError("Could not load this quiz.", 500);
  if (!quizResult.data) return apiError("Quiz not found or you do not have access to it.", 404);
  if (fileId && quizResult.data.file_id !== fileId) return apiError("Quiz file context does not match this attempt.", 400);

  const unknownQuestionIds = findUnknownAnswerQuestionIds(quizResult.data.questions, submitted.answers);
  if (unknownQuestionIds.length) return apiError("Submitted answers contain unknown questions.", 400);

  const graded = gradeQuizAttempt({
    questions: quizResult.data.questions,
    answerKey: quizResult.data.answer_key,
    answers: submitted.answers,
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

  const attempt = {
    ...saved.data,
    user_answers: graded.user_answers,
    wrong_questions: graded.wrong_questions,
  };
  const gradeResponse: SecureQuizGradeResponse = {
    score: graded.score,
    totalQuestions: graded.total_questions,
    percentage: graded.percentage,
    correctAnswers: graded.user_answers
      .filter((answer) => answer.is_correct)
      .map((answer) => ({
        questionId: answer.question_id,
        userAnswer: answer.user_answer,
      })),
    wrongAnswers: graded.wrong_questions.map((answer) => ({
      questionId: answer.question_id,
      question: answer.question,
      userAnswer: answer.user_answer,
      correctAnswer: answer.correct_answer,
    })),
  };
  const answerKey = buildReviewAnswerKey({
    questions: quizResult.data.questions,
    answerKey: quizResult.data.answer_key,
  });

  try {
    const analytics = await loadAnalytics(supabase, user.id);
    return NextResponse.json({ ...gradeResponse, attempt, answer_key: answerKey, analytics });
  } catch {
    return NextResponse.json({ ...gradeResponse, attempt, answer_key: answerKey, analytics: null });
  }
}
