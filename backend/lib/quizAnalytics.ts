import "server-only";

export type QuizAttemptAnswer = {
  question_id: string;
  topic: string;
  user_answer: string;
  is_correct: boolean;
};

export type WrongQuestion = {
  question_id: string;
  question: string;
  topic: string;
  user_answer: string;
  correct_answer: string;
};

export type TopicResult = {
  topic: string;
  correct: number;
  total: number;
};

export type GradedQuizAttempt = {
  user_answers: QuizAttemptAnswer[];
  score: number;
  total_questions: number;
  percentage: number;
  wrong_questions: WrongQuestion[];
  weak_topics: string[];
  strong_topics: string[];
  topic_results: TopicResult[];
};

export type QuizAnalytics = {
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

export const emptyQuizAnalytics: QuizAnalytics = {
  attemptCount: 0,
  strongTopics: [],
  weakTopics: [],
  lastQuizScore: null,
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function normalizeShortAnswer(value: string) {
  return value.toLowerCase().replace(/[\s.,;:'"!?()[\]]+/g, " ").trim();
}

function shortAnswerMatches(answer: string, acceptable: string[]) {
  const normalized = normalizeShortAnswer(answer);
  if (!normalized) return false;

  return acceptable.some((candidate) => {
    const expected = normalizeShortAnswer(candidate);
    return Boolean(expected) && (normalized === expected || normalized.includes(expected) || expected.includes(normalized));
  });
}

function questionTopic(question: Record<string, unknown>) {
  return text(question.topic ?? question.subject ?? question.concept) || "General review";
}

export function gradeQuizAttempt({
  questions,
  answerKey,
  answers,
}: {
  questions: unknown;
  answerKey: unknown;
  answers: Record<string, string>;
}): GradedQuizAttempt {
  const questionRows = Array.isArray(questions) ? questions.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const keyRows = Array.isArray(answerKey) ? answerKey.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
  const keyById = new Map(keyRows.map((entry, index) => [text(entry.id) || `q${index + 1}`, entry]));
  const topicMap = new Map<string, TopicResult>();
  const userAnswers: QuizAttemptAnswer[] = [];
  const wrongQuestions: WrongQuestion[] = [];
  let score = 0;

  for (let index = 0; index < questionRows.length; index += 1) {
    const question = questionRows[index];
    const questionId = text(question.id) || `q${index + 1}`;
    const key = keyById.get(questionId) ?? question;
    const type = text(question.type ?? key.type).toLowerCase().includes("short") ? "short" : "mcq";
    const userAnswer = text(answers[questionId]).slice(0, 2000);
    const topic = questionTopic(question);
    let isCorrect = false;
    let correctAnswer = "";

    if (type === "mcq") {
      const options = stringList(question.options ?? question.choices);
      const correctIndexRaw = key.correct_index ?? key.correctIndex ?? question.correct_index ?? question.correctIndex;
      const correctIndex = typeof correctIndexRaw === "number" ? correctIndexRaw : Number(correctIndexRaw);
      const selectedIndex = Number(userAnswer);
      isCorrect = Boolean(userAnswer) && Number.isFinite(selectedIndex) && Number.isFinite(correctIndex) && selectedIndex === correctIndex;
      correctAnswer = Number.isFinite(correctIndex) ? options[correctIndex] ?? "" : "";
    } else {
      const acceptable = stringList(
        key.acceptable_answers ?? key.acceptableAnswers ?? question.acceptable_answers ?? question.acceptableAnswers,
      );
      isCorrect = shortAnswerMatches(userAnswer, acceptable);
      correctAnswer = acceptable.join("; ");
    }

    if (isCorrect) score += 1;
    userAnswers.push({ question_id: questionId, topic, user_answer: userAnswer, is_correct: isCorrect });

    const topicResult = topicMap.get(topic) ?? { topic, correct: 0, total: 0 };
    topicResult.total += 1;
    if (isCorrect) topicResult.correct += 1;
    topicMap.set(topic, topicResult);

    if (!isCorrect) {
      wrongQuestions.push({
        question_id: questionId,
        question: text(question.question ?? question.prompt ?? question.stem),
        topic,
        user_answer: userAnswer,
        correct_answer: correctAnswer,
      });
    }
  }

  const topicResults = [...topicMap.values()];
  const weakTopics = topicResults.filter((result) => result.correct / Math.max(result.total, 1) < 0.7).map((result) => result.topic);
  const strongTopics = topicResults.filter((result) => result.correct / Math.max(result.total, 1) >= 0.7).map((result) => result.topic);
  const totalQuestions = questionRows.length;

  return {
    user_answers: userAnswers,
    score,
    total_questions: totalQuestions,
    percentage: totalQuestions ? Math.round((score / totalQuestions) * 10000) / 100 : 0,
    wrong_questions: wrongQuestions,
    weak_topics: weakTopics,
    strong_topics: strongTopics,
    topic_results: topicResults,
  };
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function buildQuizAnalytics(rows: unknown[]): QuizAnalytics {
  const attempts = rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)));

  if (!attempts.length) return emptyQuizAnalytics;

  const totals = new Map<string, { correct: number; total: number }>();
  for (const attempt of attempts) {
    const topicResults = Array.isArray(attempt.topic_results) ? attempt.topic_results : [];
    if (topicResults.length) {
      for (const item of topicResults) {
        if (!item || typeof item !== "object") continue;
        const result = item as Record<string, unknown>;
        const topic = text(result.topic);
        if (!topic) continue;
        const aggregate = totals.get(topic) ?? { correct: 0, total: 0 };
        aggregate.correct += numeric(result.correct);
        aggregate.total += numeric(result.total);
        totals.set(topic, aggregate);
      }
      continue;
    }

    for (const topic of stringList(attempt.weak_topics)) {
      const aggregate = totals.get(topic) ?? { correct: 0, total: 0 };
      aggregate.total += 1;
      totals.set(topic, aggregate);
    }
    for (const topic of stringList(attempt.strong_topics)) {
      const aggregate = totals.get(topic) ?? { correct: 0, total: 0 };
      aggregate.correct += 1;
      aggregate.total += 1;
      totals.set(topic, aggregate);
    }
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
  const weakTopics = ranked.filter(([, result]) => result.correct / Math.max(result.total, 1) < 0.7).map(([topic]) => topic).slice(0, 10);
  const strongTopics = ranked.filter(([, result]) => result.correct / Math.max(result.total, 1) >= 0.7).map(([topic]) => topic).slice(0, 10);
  const latest = attempts[0];
  const total = numeric(latest.total_questions);
  const score = numeric(latest.score);

  return {
    attemptCount: attempts.length,
    strongTopics,
    weakTopics,
    lastQuizScore: {
      score,
      total,
      percentage: numeric(latest.percentage) || (total ? Math.round((score / total) * 10000) / 100 : 0),
      attemptedAt: text(latest.created_at),
    },
  };
}
