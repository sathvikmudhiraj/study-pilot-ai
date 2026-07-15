import { AppShell } from "@/frontend/components/AppShell";
import { QuizWorkspace } from "@/frontend/components/QuizWorkspace";
import { PageHeader } from "@/frontend/components/ui";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { buildQuizAnalytics, emptyQuizAnalytics } from "@/backend/lib/quizAnalytics";
import { sanitizeQuizForClient, type ClientQuiz } from "@/backend/lib/quizSecurity";
import { supabaseSetupMessage } from "@/frontend/lib/supabase/errors";

export const dynamic = "force-dynamic";

const QUIZ_SOURCE_LIMIT = 100;

type QuizSearchParams = {
  fileId?: string | string[];
  noteId?: string | string[];
  summaryId?: string | string[];
};

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function QuizPage({ searchParams }: { searchParams?: Promise<QuizSearchParams> }) {
  const params = searchParams ? await searchParams : {};
  const requestedFileId = singleParam(params.fileId);
  const requestedNoteId = singleParam(params.noteId);
  const requestedSummaryId = singleParam(params.summaryId);
  const initialSource =
    requestedFileId ? { kind: "file" as const, id: requestedFileId } :
    requestedNoteId ? { kind: "note" as const, id: requestedNoteId } :
    requestedSummaryId ? { kind: "summary" as const, id: requestedSummaryId } :
    null;

  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  let savedQuizzes: ClientQuiz[] = [];
  let quizAnalytics = emptyQuizAnalytics;
  const sources = { files: [] as { value: string; label: string }[], notes: [] as { value: string; label: string }[], summaries: [] as { value: string; label: string }[] };
  let error = "";

  if (supabase && user) {
    const [quizzesResult, filesResult, notesResult, summariesResult, attemptsResult] = await Promise.all([
      supabase
        .from("quizzes")
        .select("id, file_id, note_id, quiz_title, title, difficulty, questions, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      // The quiz API can extract supported files on demand, so the picker can
      // safely show the user's files and return a clean error if text is not readable.
      supabase
        .from("files")
        .select("id, file_name")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(QUIZ_SOURCE_LIMIT),
      supabase
        .from("notes")
        .select("id, title, topic")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(QUIZ_SOURCE_LIMIT),
      supabase
        .from("ai_outputs")
        .select("id, suggested_title")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("quiz_attempts")
        .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (quizzesResult.error) {
      error = supabaseSetupMessage(quizzesResult.error.message);
    } else {
      savedQuizzes = (quizzesResult.data ?? []).map((quiz) => sanitizeQuizForClient(quiz as Record<string, unknown>));
    }

    (filesResult.data ?? []).forEach((file) => {
      sources.files.push({ value: file.id, label: file.file_name ?? "Untitled file" });
    });
    (notesResult.data ?? []).forEach((note) => {
      const label = note.title ? (note.topic ? `${note.title} - ${note.topic}` : note.title) : "Untitled note";
      sources.notes.push({ value: note.id, label });
    });
    (summariesResult.data ?? []).forEach((summary) => {
      sources.summaries.push({ value: summary.id, label: summary.suggested_title ?? "Untitled summary" });
    });
    if (!attemptsResult.error) {
      quizAnalytics = buildQuizAnalytics(attemptsResult.data ?? []);
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Quiz generator"
        description="Generate MCQ and short-answer questions from your files, notes, or summaries, then attempt and review them."
      />

      {error ? (
        <div className="mb-6 rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-5 text-sm leading-6 text-amber-100 animate-fade-in">{error}</div>
      ) : null}

      <QuizWorkspace savedQuizzes={savedQuizzes} sources={sources} initialAnalytics={quizAnalytics} initialSource={initialSource} />
    </AppShell>
  );
}
