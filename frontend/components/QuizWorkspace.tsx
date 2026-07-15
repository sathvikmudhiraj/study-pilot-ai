"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Shared types (kept loose - they mirror backend/lib/aiQuiz.ts but are
// JSON-serializable shapes coming from the server / API response).
// ---------------------------------------------------------------------------

type QuestionType = "mcq" | "short";

type QuizQuestion = {
  id: string;
  type: QuestionType;
  question: string;
  topic: string;
  options: string[];
  marks?: number | null;
  difficulty?: string | null;
  display_order?: number;
};

type AnswerKeyEntry = {
  id: string;
  type: QuestionType;
  topic?: string;
  correct_index: number | null;
  acceptable_answers: string[];
  explanation: string;
};

type Quiz = {
  id: string;
  file_id?: string | null;
  title: string | null;
  quiz_title?: string | null;
  difficulty?: string | null;
  questions: QuizQuestion[];
  answer_key?: AnswerKeyEntry[] | null;
  source_summary?: string | null;
  created_at: string;
};

type SourceOption = {
  value: string;
  label: string;
};

type QuizSources = {
  files: SourceOption[];
  notes: SourceOption[];
  summaries: SourceOption[];
};

type InitialSource =
  | { kind: "file"; id: string }
  | { kind: "note"; id: string }
  | { kind: "summary"; id: string }
  | null;

type QuizAnalytics = {
  attemptCount: number;
  strongTopics: string[];
  weakTopics: string[];
  lastQuizScore: {
    score: number;
    total: number;
    percentage: number;
    attemptedAt: string;
  } | null;
};

type SavedAttempt = {
  score: number;
  total_questions: number;
  percentage: number;
  weak_topics: string[];
  strong_topics: string[];
  user_answers?: {
    question_id: string;
    topic: string;
    user_answer: string;
    is_correct: boolean;
  }[];
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function textOr(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeQuestion(raw: unknown, index: number): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const question = textOr(record.question ?? record.prompt ?? record.stem);
  if (!question) return null;

  const declared = String(record.type ?? record.question_type ?? record.kind ?? "").toLowerCase();
  const hasOptions = Array.isArray(record.options) && asList(record.options).length >= 2;
  const type: QuestionType = declared.includes("short") || declared.includes("sa")
    ? "short"
    : declared.includes("mcq") || declared.includes("choice") || declared.includes("multiple")
      ? "mcq"
      : hasOptions
        ? "mcq"
        : "short";

  const topic = textOr(record.topic ?? record.subject ?? record.concept, "General review");
  const options = asList(record.options ?? record.choices);
  const marks = typeof record.marks === "number" && Number.isFinite(record.marks) ? record.marks : null;
  const displayOrder = typeof record.display_order === "number" && Number.isFinite(record.display_order) ? record.display_order : index + 1;

  if (type === "mcq") {
    if (options.length < 2) return null;
    return { id: textOr(record.id, `q${index + 1}`), type, question, topic, options, marks, difficulty: textOr(record.difficulty) || null, display_order: displayOrder };
  }

  return {
    id: textOr(record.id, `q${index + 1}`),
    type: "short",
    question,
    topic,
    options: [],
    marks,
    difficulty: textOr(record.difficulty) || null,
    display_order: displayOrder,
  };
}

function normalizeAnswerKey(raw: unknown): AnswerKeyEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map<AnswerKeyEntry | null>((entry, i) => {
      if (!entry || typeof entry !== "object") return null;
      const r = entry as Record<string, unknown>;
      const correctIndex = typeof r.correct_index === "number" ? r.correct_index : typeof r.correctIndex === "number" ? r.correctIndex : null;

      return {
        id: textOr(r.id, `q${i + 1}`),
        type: (String(r.type ?? "").toLowerCase().includes("short") ? "short" : "mcq") as QuestionType,
        topic: textOr(r.topic) || undefined,
        correct_index: correctIndex,
        acceptable_answers: asList(r.acceptable_answers ?? r.acceptableAnswers),
        explanation: textOr(r.explanation ?? r.rationale ?? r.reason),
      };
    })
    .filter((entry): entry is AnswerKeyEntry => Boolean(entry));
}

function normalizeQuiz(raw: unknown): Quiz | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const questions = Array.isArray(record.questions) ? record.questions : [];
  const normalized = questions
    .map((q, i) => normalizeQuestion(q, i))
    .filter((q): q is QuizQuestion => Boolean(q))
    .map((q, i) => ({ ...q, id: q.id || `q${i + 1}` }));
  if (!normalized.length) return null;

  const answerKey = normalizeAnswerKey(record.answer_key);

  return {
    id: textOr(record.id, `quiz_${Date.now()}`),
    file_id: textOr(record.file_id) || null,
    title: textOr(record.quiz_title ?? record.title) || null,
    quiz_title: textOr(record.quiz_title ?? record.title) || null,
    difficulty: textOr(record.difficulty, "medium") || "medium",
    questions: normalized,
    answer_key: answerKey.length ? answerKey : null,
    source_summary: textOr(record.source_summary) || null,
    created_at: textOr(record.created_at, new Date().toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function difficultyColor(difficulty: string | null | undefined) {
  const d = String(difficulty ?? "medium").toLowerCase();
  if (d === "easy") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (d === "hard") return "border-rose-300/30 bg-rose-300/10 text-rose-100";
  return "border-amber-300/30 bg-amber-300/10 text-amber-100";
}

function OptionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

// ---------------------------------------------------------------------------
// Source picker
// ---------------------------------------------------------------------------

function SourcePicker({
  sources,
  onGenerate,
  generating,
  initialSource,
}: {
  sources: QuizSources;
  onGenerate: (params: GenerateParams) => void;
  generating: boolean;
  initialSource: InitialSource;
}) {
  const allEmpty = !sources.files.length && !sources.notes.length && !sources.summaries.length;

  function hasInitialSource(kind: "file" | "note" | "summary") {
    if (initialSource?.kind !== kind) return false;
    const options = kind === "file" ? sources.files : kind === "note" ? sources.notes : sources.summaries;
    return options.some((option) => option.value === initialSource.id);
  }

  const [sourceKind, setSourceKind] = useState<"file" | "note" | "summary">(() => {
    if (hasInitialSource("file")) return "file";
    if (hasInitialSource("note")) return "note";
    if (hasInitialSource("summary")) return "summary";
    return sources.files.length ? "file" : sources.notes.length ? "note" : "summary";
  });
  const list = sourceKind === "file" ? sources.files : sourceKind === "note" ? sources.notes : sources.summaries;
  const [sourceId, setSourceId] = useState<string>(() => {
    if (initialSource?.kind === sourceKind && list.some((option) => option.value === initialSource.id)) {
      return initialSource.id;
    }
    return list[0]?.value ?? "";
  });

  const [count, setCount] = useState<number>(8);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>("medium");
  const [types, setTypes] = useState<QuizTypeSelection>("all");

  function handleKindChange(kind: "file" | "note" | "summary") {
    setSourceKind(kind);
    const next = kind === "file" ? sources.files : kind === "note" ? sources.notes : sources.summaries;
    setSourceId(next[0]?.value ?? "");
  }

  function submit() {
    if (!sourceId) return;
    onGenerate({
      sourceKind,
      sourceId,
      count,
      difficulty,
      types,
    });
  }

  if (allEmpty) {
    return (
      <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/70 p-8 text-center">
        <h2 className="text-lg font-semibold text-white">No study material yet</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
          Upload files or add notes first, or generate a summary. Quizzes are built from your own material.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <Link href="/upload" className="inline-flex h-10 items-center rounded-md bg-emerald-400 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-300">
            Upload notes
          </Link>
          <Link href="/files" className="inline-flex h-10 items-center rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white hover:bg-white/10">
            Go to files
          </Link>
        </div>
      </div>
    );
  }

  const currentList = sourceKind === "file" ? sources.files : sourceKind === "note" ? sources.notes : sources.summaries;

  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Build a quiz</h2>
          <p className="mt-1 text-sm text-slate-400">Pick a file, note, or summary to generate MCQs and short-answer questions.</p>
        </div>
      </div>

      <div className="grid gap-4">
        <div>
          <span className="text-xs font-semibold uppercase text-slate-500">Source type</span>
          <div className="mt-2 grid w-full grid-cols-3 rounded-md border border-white/10 bg-slate-950/70 p-1 sm:inline-flex sm:w-auto">
            {([
              ["file", "File", sources.files.length],
              ["note", "Note", sources.notes.length],
              ["summary", "Summary", sources.summaries.length],
            ] as const).map(([kind, label, len]) => (
              <button
                key={kind}
                type="button"
                onClick={() => handleKindChange(kind)}
                className={`min-w-0 rounded px-2 py-1.5 text-sm font-medium transition sm:px-3 ${
                  sourceKind === kind ? "bg-emerald-400 text-slate-950" : "text-slate-300 hover:text-white"
                }`}
              >
                {label} {len > 0 ? <span className="opacity-60">({len})</span> : null}
              </button>
            ))}
          </div>
        </div>

        <label className="grid gap-2 text-sm font-medium text-slate-200">
          <span className="text-xs font-semibold uppercase text-slate-500">Choose source</span>
          <select
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            disabled={!currentList.length}
            className="h-11 min-w-0 rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300 disabled:opacity-60"
          >
            {!currentList.length ? <option value="">No {sourceKind}s available</option> : currentList.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2 text-sm font-medium text-slate-200">
            <span className="text-xs font-semibold uppercase text-slate-500">Questions</span>
            <select
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-11 min-w-0 rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300"
            >
              {[5, 6, 8, 10, 12, 15].map((n) => (
                <option key={n} value={n}>{n} questions</option>
              ))}
            </select>
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-200">
            <span className="text-xs font-semibold uppercase text-slate-500">Difficulty</span>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}
              className="h-11 min-w-0 rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300"
            >
              <option value="easy">Easy - recall</option>
              <option value="medium">Medium - apply</option>
              <option value="hard">Hard - analyse</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm font-medium text-slate-200">
            <span className="text-xs font-semibold uppercase text-slate-500">Question types</span>
            <select
              value={types}
              onChange={(e) => setTypes(e.target.value as QuizTypeSelection)}
              className="h-11 min-w-0 rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300"
            >
              <option value="all">Mixed (MCQ + short)</option>
              <option value="mcq">Multiple choice only</option>
              <option value="short">Short answer only</option>
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={generating || !sourceId}
          className="h-10 w-full rounded-md bg-emerald-400 px-5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-fit"
        >
          {generating ? "Generating quiz..." : "Generate quiz"}
        </button>
      </div>
    </div>
  );
}

type QuizDifficulty = "easy" | "medium" | "hard";
type QuizTypeSelection = "all" | "mcq" | "short";
type GenerateParams = {
  sourceKind: "file" | "note" | "summary";
  sourceId: string;
  count: number;
  difficulty: QuizDifficulty;
  types: QuizTypeSelection;
};

// ---------------------------------------------------------------------------
// Question renderer (attempt + review)
// ---------------------------------------------------------------------------

function QuestionCard({
  question,
  index,
  selected,
  onSelect,
  result,
}: {
  question: QuizQuestion;
  index: number;
  selected: string;
  onSelect: (value: string) => void;
  result?: { isCorrect: boolean; entry: AnswerKeyEntry };
}) {
  const reviewed = result !== undefined;

  return (
    <article
      className={`min-w-0 rounded-lg border p-4 sm:p-5 ${
        result
          ? result.isCorrect
            ? "border-emerald-300/30 bg-emerald-300/[0.06]"
            : "border-rose-300/30 bg-rose-300/[0.06]"
          : "border-white/10 bg-slate-950/60"
      }`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-white/10 px-1.5 text-xs font-bold text-slate-200">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {question.type === "mcq" ? "Multiple choice" : "Short answer"}
            </span>
            <span className="max-w-full break-words rounded border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">
              {question.topic}
            </span>
            {result ? (
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${result.isCorrect ? "bg-emerald-400/20 text-emerald-100" : "bg-rose-400/20 text-rose-100"}`}>
                {result.isCorrect ? "Correct" : "Incorrect"}
              </span>
            ) : null}
          </div>
          <p className="mt-2 break-words text-sm font-medium leading-6 text-white">{question.question}</p>

          {question.type === "mcq" ? (
            <div className="mt-3 grid gap-2">
              {question.options.map((option, optIndex) => {
                const isSelected = selected === String(optIndex);
                const isCorrectOption = result?.entry?.correct_index === optIndex;
                return (
                  <button
                    key={optIndex}
                    type="button"
                    disabled={reviewed}
                    onClick={() => onSelect(String(optIndex))}
                    className={`flex min-w-0 items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition ${
                      reviewed
                        ? isCorrectOption
                          ? "border-emerald-300/40 bg-emerald-300/10 text-emerald-50"
                          : isSelected
                            ? "border-rose-300/40 bg-rose-300/10 text-rose-50"
                            : "border-white/10 bg-slate-950/50 text-slate-400"
                        : isSelected
                          ? "border-emerald-300/50 bg-emerald-300/10 text-white"
                          : "border-white/10 bg-slate-950/50 text-slate-200 hover:border-white/25"
                    }`}
                  >
                    <span className="mt-0.5 text-xs font-bold text-slate-400">{OptionLetter(optIndex)}</span>
                    <span className="min-w-0 break-words">{option}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              type="text"
              value={selected}
              disabled={reviewed}
              onChange={(e) => onSelect(e.target.value)}
              placeholder="Type your answer..."
              className="mt-3 h-11 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-300 disabled:opacity-80"
            />
          )}

          {result ? (
            <div className="mt-4 rounded-md border border-white/10 bg-slate-950/70 p-3 text-sm leading-6 text-slate-300">
              {question.type === "mcq" ? (
                <p>
                  <span className="font-semibold text-slate-200">Correct answer: </span>
                  {typeof result.entry.correct_index === "number" && result.entry.correct_index >= 0
                    ? question.options[result.entry.correct_index] ?? "-"
                    : "-"}
                </p>
              ) : (
                <p>
                  <span className="font-semibold text-slate-200">Acceptable answers: </span>
                  {result.entry.acceptable_answers.length ? result.entry.acceptable_answers.join("; ") : "-"}
                </p>
              )}
              {result.entry.explanation ? (
                <p className="mt-2 text-slate-400">
                  <span className="font-semibold text-slate-300">Explanation: </span>
                  {result.entry.explanation}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function QuizAnalyticsPanel({ analytics }: { analytics: QuizAnalytics }) {
  const last = analytics.lastQuizScore;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-white">Learning analytics</h2>
          <p className="mt-1 text-sm text-slate-400">Updated from saved quiz attempts.</p>
        </div>
        <span className="text-xs text-slate-500">{analytics.attemptCount} attempt{analytics.attemptCount === 1 ? "" : "s"}</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="text-xs font-semibold uppercase text-slate-500">Last quiz score</div>
          <div className="mt-2 text-2xl font-bold text-white">
            {last ? `${Math.round(last.percentage)}%` : "No attempts"}
          </div>
          {last ? <div className="mt-1 text-xs text-slate-400">{last.score} of {last.total} correct</div> : null}
        </div>
        <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/[0.06] p-4">
          <div className="text-xs font-semibold uppercase text-emerald-200">Strong topics</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {analytics.strongTopics.length ? analytics.strongTopics.slice(0, 5).map((topic) => (
              <span key={topic} className="max-w-full break-words rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-xs text-emerald-100">{topic}</span>
            )) : <span className="text-sm text-slate-400">Complete a quiz to identify strengths.</span>}
          </div>
        </div>
        <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-4">
          <div className="text-xs font-semibold uppercase text-amber-200">Weak topics</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {analytics.weakTopics.length ? analytics.weakTopics.slice(0, 5).map((topic) => (
              <span key={topic} className="max-w-full break-words rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">{topic}</span>
            )) : <span className="text-sm text-slate-400">No weak topics tracked yet.</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuizWorkspace({
  savedQuizzes,
  sources,
  initialAnalytics,
  initialSource = null,
}: {
  savedQuizzes: unknown[];
  sources: QuizSources;
  initialAnalytics: QuizAnalytics;
  initialSource?: InitialSource;
}) {
  const normalizedSaved = useMemo(() => savedQuizzes.map(normalizeQuiz).filter((q): q is Quiz => Boolean(q)), [savedQuizzes]);

  const [mode, setMode] = useState<"picker" | "attempt" | "review">("picker");
  const [generating, setGenerating] = useState(false);
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [savedAttempt, setSavedAttempt] = useState<SavedAttempt | null>(null);
  const [analytics, setAnalytics] = useState<QuizAnalytics>(initialAnalytics);

  const attemptByQuestion = useMemo(() => {
    if (mode !== "review" || !savedAttempt?.user_answers?.length) return new Map<string, NonNullable<SavedAttempt["user_answers"]>[number]>();
    return new Map(savedAttempt.user_answers.map((answer) => [answer.question_id, answer]));
  }, [mode, savedAttempt]);

  function startQuiz(quiz: Quiz) {
    setActiveQuiz({ ...quiz, answer_key: null });
    setAnswers({});
    setError("");
    setNotice("");
    setSavedAttempt(null);
    setMode("attempt");
  }

  function setAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function submitQuiz() {
    if (!activeQuiz) return;
    const unanswered = activeQuiz.questions.filter((q) => !(answers[q.id] ?? "").trim());
    if (unanswered.length) {
      setError(`Answer all questions before submitting. ${unanswered.length} left.`);
      return;
    }
    setError("");
    setNotice("");
    setSubmitting(true);

    try {
      const response = await fetch("/api/quiz/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizId: activeQuiz.id,
          fileId: activeQuiz.file_id ?? null,
          answers: activeQuiz.questions.map((question) => ({
            questionId: question.id,
            selectedAnswer: answers[question.id] ?? "",
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save this quiz attempt.");

      setSavedAttempt(data.attempt as SavedAttempt);
      setActiveQuiz((current) => current ? { ...current, answer_key: normalizeAnswerKey(data.answer_key) } : current);
      if (data.analytics) setAnalytics(data.analytics as QuizAnalytics);
      setNotice("Attempt saved. Weak topics are now available to the Revision Planner.");
      setMode("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save this quiz attempt.");
    } finally {
      setSubmitting(false);
    }
  }

  function retake() {
    setActiveQuiz((current) => current ? { ...current, answer_key: null } : current);
    setAnswers({});
    setError("");
    setNotice("");
    setSavedAttempt(null);
    setMode("attempt");
  }

  function backToPicker() {
    setMode("picker");
    setActiveQuiz(null);
    setAnswers({});
    setError("");
    setNotice("");
    setSavedAttempt(null);
  }

  async function handleGenerate(params: GenerateParams) {
    setGenerating(true);
    setError("");

    const payload: Record<string, unknown> = {
      count: params.count,
      difficulty: params.difficulty,
      questionTypes: params.types === "all" ? ["mcq", "short"] : [params.types],
    };
    if (params.sourceKind === "file") payload.fileId = params.sourceId;
    else if (params.sourceKind === "note") payload.noteId = params.sourceId;
    else payload.summaryId = params.sourceId;

    try {
      const response = await fetch("/api/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Could not generate the quiz. Please try again.");
      }

      const quiz = normalizeQuiz(data.quiz);
      if (!quiz) {
        throw new Error("The generated quiz could not be read. Please try again.");
      }

      startQuiz(quiz);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not generate the quiz. Please try again.";
      setError(message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6">
      {mode === "picker" ? (
        <>
          <QuizAnalyticsPanel analytics={analytics} />

          {error ? (
            <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-200">{error}</div>
          ) : null}

          <SourcePicker sources={sources} onGenerate={handleGenerate} generating={generating} initialSource={initialSource} />

          {generating ? (
            <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-5 text-sm text-emerald-100">
              Generating your quiz from the selected material...
            </div>
          ) : null}

          <section>
            <h2 className="text-lg font-semibold text-white">Saved quizzes</h2>
            <p className="mt-1 text-sm text-slate-400">Retake any quiz you have generated before.</p>
            <div className="mt-4 grid gap-3">
              {!normalizedSaved.length ? (
                <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-6 text-sm text-slate-400">
                  No quizzes yet. Generate your first quiz above.
                </div>
              ) : (
                normalizedSaved.map((quiz) => (
                  <article key={quiz.id} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words font-semibold text-white">{quiz.title || "Practice quiz"}</h3>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${difficultyColor(quiz.difficulty)}`}>
                            {quiz.difficulty}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {quiz.questions.length} questions - {new Date(quiz.created_at).toLocaleDateString()}
                        </p>
                        {quiz.source_summary ? <p className="mt-2 text-sm leading-6 text-slate-400">{quiz.source_summary}</p> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => startQuiz(quiz)}
                        className="h-9 w-full rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto"
                      >
                        Take quiz
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>
        </>
      ) : null}

      {mode !== "picker" && activeQuiz ? (
        <>
          <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="break-words text-xl font-bold text-white sm:text-2xl">{activeQuiz.title || "Practice quiz"}</h2>
                  <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ${difficultyColor(activeQuiz.difficulty)}`}>
                    {activeQuiz.difficulty}
                  </span>
                </div>
                {activeQuiz.source_summary ? <p className="mt-2 text-sm leading-6 text-slate-400">{activeQuiz.source_summary}</p> : null}
                {mode === "review" && savedAttempt ? (
                  <p className="mt-3 text-sm font-semibold text-emerald-200">
                    Score: {savedAttempt.score} / {savedAttempt.total_questions} ({Math.round(savedAttempt.percentage)}%)
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-slate-500">{activeQuiz.questions.length} questions</p>
                )}
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                {mode === "review" ? (
                  <button type="button" onClick={retake} className="h-10 flex-1 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 sm:flex-none">
                    Retake quiz
                  </button>
                ) : null}
                <button type="button" onClick={backToPicker} className="h-10 flex-1 rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 sm:flex-none">
                  {mode === "review" ? "New quiz" : "Back"}
                </button>
              </div>
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-200">{error}</div>
          ) : null}

          {notice ? (
            <div className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-100">{notice}</div>
          ) : null}

          {mode === "review" && savedAttempt?.weak_topics?.length ? (
            <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.06] p-4">
              <div className="text-xs font-semibold uppercase text-amber-200">Topics to revise</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {savedAttempt.weak_topics.map((topic) => (
                  <span key={topic} className="rounded-md border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-xs text-amber-100">{topic}</span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4">
            {activeQuiz.questions.map((question, index) => {
              const entry = activeQuiz.answer_key?.find((k) => k.id === question.id);
              const serverResult = attemptByQuestion.get(question.id);
              const result =
                mode === "review" && entry && serverResult
                  ? { isCorrect: serverResult.is_correct, entry }
                  : undefined;
              return (
                <QuestionCard
                  key={question.id}
                  question={question}
                  index={index}
                  selected={answers[question.id] ?? ""}
                  onSelect={(value) => setAnswer(question.id, value)}
                  result={result}
                />
              );
            })}
          </div>

          {mode === "attempt" ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={submitQuiz} disabled={submitting} className="h-10 w-full rounded-md bg-emerald-400 px-6 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
                {submitting ? "Saving attempt..." : "Submit answers"}
              </button>
              <button type="button" onClick={backToPicker} className="h-10 w-full rounded-md border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10 sm:w-auto">
                Cancel
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export type { Quiz, QuizSources };
