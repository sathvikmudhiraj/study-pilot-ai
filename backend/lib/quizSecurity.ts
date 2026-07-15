type QuestionType = "mcq" | "short";

const SENSITIVE_FIELD_NAMES = new Set([
  "answer",
  "answer_index",
  "answerindex",
  "answer_key",
  "answerkey",
  "answers",
  "acceptable_answers",
  "acceptableanswers",
  "correct",
  "correct_answer",
  "correctanswer",
  "correct_index",
  "correctindex",
  "correct_option",
  "correctoption",
  "correct_option_index",
  "correctoptionindex",
  "explanation",
  "grading_rubric",
  "gradingrubric",
  "rationale",
  "reason",
  "rubric",
]);

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function maybeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedFieldName(key: string) {
  return key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isSensitiveField(key: string) {
  return SENSITIVE_FIELD_NAMES.has(key.toLowerCase()) || SENSITIVE_FIELD_NAMES.has(normalizedFieldName(key));
}

function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadata).filter((item) => item !== undefined);
  }

  if (!value || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !isSensitiveField(key))
    .map(([key, item]) => [key, sanitizeMetadata(item)] as const)
    .filter(([, item]) => item !== undefined);

  if (!entries.length) return undefined;
  return Object.fromEntries(entries);
}

export type ClientQuizQuestion = {
  id: string;
  type: QuestionType;
  question: string;
  topic: string;
  options: string[];
  marks: number | null;
  difficulty: string | null;
  display_order: number;
  metadata?: unknown;
};

export type ClientQuiz = {
  id: string;
  file_id: string | null;
  note_id: string | null;
  quiz_title: string | null;
  title: string | null;
  difficulty: string | null;
  questions: ClientQuizQuestion[];
  source_summary?: string | null;
  created_at: string;
  updated_at?: string;
};

export type ReviewAnswerKeyEntry = {
  id: string;
  type: QuestionType;
  topic?: string;
  correct_index: number | null;
  acceptable_answers: string[];
  explanation: string;
};

export function sanitizeQuizQuestionForClient(raw: unknown, index: number): ClientQuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const question = text(record.question ?? record.prompt ?? record.stem);
  if (!question) return null;

  const options = stringList(record.options ?? record.choices);
  const declared = String(record.type ?? record.question_type ?? record.kind ?? "").toLowerCase();
  const type: QuestionType =
    declared.includes("short") || declared.includes("sa")
      ? "short"
      : declared.includes("mcq") || declared.includes("choice") || declared.includes("multiple") || options.length
        ? "mcq"
        : "short";

  if (type === "mcq" && options.length < 2) return null;

  const displayOrder = numberOrNull(record.display_order ?? record.displayOrder ?? record.order);
  const metadata = sanitizeMetadata(record.metadata);

  return {
    id: text(record.id, `q${index + 1}`),
    type,
    question,
    topic: text(record.topic ?? record.subject ?? record.concept, "General review"),
    options: type === "mcq" ? options : [],
    marks: numberOrNull(record.marks ?? record.points),
    difficulty: maybeText(record.difficulty),
    display_order: displayOrder ?? index + 1,
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

export function sanitizeQuizQuestionsForClient(questions: unknown) {
  return (Array.isArray(questions) ? questions : [])
    .map((question, index) => sanitizeQuizQuestionForClient(question, index))
    .filter((question): question is ClientQuizQuestion => Boolean(question));
}

export function sanitizeQuizForClient(
  row: Record<string, unknown>,
  overrides: { questions?: unknown; source_summary?: unknown } = {},
): ClientQuiz {
  const title = maybeText(row.quiz_title ?? row.title);

  return {
    id: text(row.id),
    file_id: maybeText(row.file_id),
    note_id: maybeText(row.note_id),
    quiz_title: title,
    title,
    difficulty: maybeText(row.difficulty),
    questions: sanitizeQuizQuestionsForClient(overrides.questions ?? row.questions),
    source_summary: maybeText(overrides.source_summary ?? row.source_summary),
    created_at: text(row.created_at, new Date().toISOString()),
    ...(typeof row.updated_at === "string" ? { updated_at: row.updated_at } : {}),
  };
}

export function buildReviewAnswerKey({
  questions,
  answerKey,
}: {
  questions: unknown;
  answerKey: unknown;
}): ReviewAnswerKeyEntry[] {
  const questionRows = Array.isArray(questions)
    ? questions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const keyRows = Array.isArray(answerKey)
    ? answerKey.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
  const keyById = new Map(keyRows.map((entry, index) => [text(entry.id, `q${index + 1}`), entry]));

  return questionRows.map((question, index) => {
    const id = text(question.id, `q${index + 1}`);
    const key = keyById.get(id) ?? question;
    const type: QuestionType = text(question.type ?? key.type).toLowerCase().includes("short") ? "short" : "mcq";

    return {
      id,
      type,
      topic: text(question.topic ?? key.topic),
      correct_index: numberOrNull(key.correct_index ?? key.correctIndex ?? question.correct_index ?? question.correctIndex),
      acceptable_answers: stringList(key.acceptable_answers ?? key.acceptableAnswers ?? question.acceptable_answers ?? question.acceptableAnswers),
      explanation: text(key.explanation ?? key.rationale ?? key.reason ?? question.explanation ?? question.rationale ?? question.reason),
    };
  });
}

export type SubmittedAnswersResult = {
  answers: Record<string, string>;
  duplicateQuestionIds: string[];
  invalid: boolean;
};

export function normalizeSubmittedAnswers(value: unknown): SubmittedAnswersResult {
  const answers: Record<string, string> = {};
  const duplicateQuestionIds: string[] = [];
  const seen = new Set<string>();

  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) {
      if (!item || typeof item !== "object") return { answers, duplicateQuestionIds, invalid: true };
      const record = item as Record<string, unknown>;
      const questionId = text(record.questionId ?? record.question_id ?? record.id);
      if (!questionId) return { answers, duplicateQuestionIds, invalid: true };
      if (seen.has(questionId)) duplicateQuestionIds.push(questionId);
      seen.add(questionId);
      answers[questionId] = String(record.selectedAnswer ?? record.selected_answer ?? record.answer ?? record.value ?? "").trim().slice(0, 2000);
    }
    return { answers, duplicateQuestionIds, invalid: false };
  }

  if (!value || typeof value !== "object") return { answers, duplicateQuestionIds, invalid: true };

  Object.entries(value as Record<string, unknown>)
    .map(([key, answer]) => [key.trim(), String(answer ?? "").trim().slice(0, 2000)] as const)
    .filter(([key]) => Boolean(key))
    .slice(0, 50)
    .forEach(([key, answer]) => {
      answers[key] = answer;
    });

  return { answers, duplicateQuestionIds, invalid: false };
}

export function getQuizQuestionIds(questions: unknown) {
  return sanitizeQuizQuestionsForClient(questions).map((question) => question.id);
}

export function findUnknownAnswerQuestionIds(questions: unknown, answers: Record<string, string>) {
  const questionIds = new Set(getQuizQuestionIds(questions));
  return Object.keys(answers).filter((questionId) => !questionIds.has(questionId));
}
