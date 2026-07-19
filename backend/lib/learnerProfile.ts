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

type TopicResult = {
  topic: string;
  correct: number;
  total: number;
};

type WrongQuestion = {
  question_id: string;
  question: string;
  topic: string;
  user_answer: string;
  correct_answer: string;
};

export type LearnerProfile = {
  weakTopics: Array<{ topic: string; accuracy: number; misses: number; attempts: number }>;
  strongTopics: Array<{ topic: string; accuracy: number; attempts: number }>;
  recentMistakes: Array<{ topic: string; question: string; misses: number }>;
  quizHistory: Array<{ percentage: number; score: number; total: number; attemptedAt: string }>;
  preferredDifficulty: "easy" | "medium" | "hard";
  learningPace: "new" | "steady" | "intensive";
  revisionFrequency: "none" | "occasional" | "regular";
  lastStudiedTopics: string[];
};

export type DashboardLearningMetrics = {
  quizImprovement: {
    previous: number | null;
    latest: number | null;
    delta: number | null;
    trend: "up" | "down" | "flat" | "none";
  };
  weakTopics: LearnerProfile["weakTopics"];
  strongTopics: LearnerProfile["strongTopics"];
  revisionProgress: {
    completed: number;
    pending: number;
    completionPercent: number;
  };
  studyStreakDays: number;
  timeStudiedMinutes: number | null;
  insights: string[];
  recommendedNextStudy: {
    topic: string;
    reason: string;
    href: string;
  } | null;
};

type AttemptRow = {
  score?: unknown;
  total_questions?: unknown;
  percentage?: unknown;
  weak_topics?: unknown;
  strong_topics?: unknown;
  topic_results?: unknown;
  wrong_questions?: unknown;
  created_at?: unknown;
};

type RevisionPlanRow = {
  daily_plan?: unknown;
  plan?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type ActivityRow = {
  created_at?: unknown;
  updated_at?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function numeric(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

function normalizeTopic(topic: string) {
  return topic.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function displayTopic(existing: string | undefined, next: string) {
  return existing && existing.length <= next.length ? existing : next;
}

function parseTopicResults(value: unknown): TopicResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const topic = text(record.topic);
      if (!topic) return null;
      return {
        topic,
        correct: numeric(record.correct),
        total: numeric(record.total),
      };
    })
    .filter((item): item is TopicResult => Boolean(item));
}

function parseWrongQuestions(value: unknown): WrongQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const topic = text(record.topic) || "General review";
      return {
        question_id: text(record.question_id ?? record.questionId),
        question: text(record.question),
        topic,
        user_answer: text(record.user_answer ?? record.userAnswer),
        correct_answer: text(record.correct_answer ?? record.correctAnswer),
      };
    })
    .filter((item): item is WrongQuestion => Boolean(item));
}

function uniqueTopics(values: string[], limit = 10) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const topic = text(value);
    const key = normalizeTopic(topic);
    if (!topic || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(topic);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildLearnerProfile(attemptRows: unknown[], activityRows: unknown[] = []): LearnerProfile {
  const attempts = attemptRows
    .filter((row): row is AttemptRow => Boolean(row) && typeof row === "object")
    .sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)));

  const topicTotals = new Map<string, { topic: string; correct: number; total: number; misses: number }>();
  const mistakeTotals = new Map<string, { topic: string; question: string; misses: number }>();

  for (const attempt of attempts) {
    const topicResults = parseTopicResults(attempt.topic_results);
    if (topicResults.length) {
      for (const result of topicResults) {
        const key = normalizeTopic(result.topic);
        if (!key) continue;
        const aggregate = topicTotals.get(key) ?? { topic: result.topic, correct: 0, total: 0, misses: 0 };
        aggregate.topic = displayTopic(aggregate.topic, result.topic);
        aggregate.correct += result.correct;
        aggregate.total += result.total;
        aggregate.misses += Math.max(0, result.total - result.correct);
        topicTotals.set(key, aggregate);
      }
    } else {
      for (const topic of list(attempt.weak_topics)) {
        const key = normalizeTopic(topic);
        if (!key) continue;
        const aggregate = topicTotals.get(key) ?? { topic, correct: 0, total: 0, misses: 0 };
        aggregate.total += 1;
        aggregate.misses += 1;
        topicTotals.set(key, aggregate);
      }
      for (const topic of list(attempt.strong_topics)) {
        const key = normalizeTopic(topic);
        if (!key) continue;
        const aggregate = topicTotals.get(key) ?? { topic, correct: 0, total: 0, misses: 0 };
        aggregate.correct += 1;
        aggregate.total += 1;
        topicTotals.set(key, aggregate);
      }
    }

    for (const wrong of parseWrongQuestions(attempt.wrong_questions)) {
      const key = `${normalizeTopic(wrong.topic)}::${normalizeTopic(wrong.question)}`;
      if (!key.trim()) continue;
      const current = mistakeTotals.get(key) ?? { topic: wrong.topic, question: wrong.question, misses: 0 };
      current.misses += 1;
      mistakeTotals.set(key, current);
    }
  }

  const rankedTopics = [...topicTotals.values()].filter((topic) => topic.total > 0);
  const weakTopics = rankedTopics
    .filter((topic) => topic.correct / Math.max(topic.total, 1) < 0.7)
    .sort((a, b) => b.misses - a.misses || a.correct / a.total - b.correct / b.total || a.topic.localeCompare(b.topic))
    .map((topic) => ({
      topic: topic.topic,
      accuracy: Math.round((topic.correct / Math.max(topic.total, 1)) * 100),
      misses: topic.misses,
      attempts: topic.total,
    }))
    .slice(0, 10);

  const strongTopics = rankedTopics
    .filter((topic) => topic.correct / Math.max(topic.total, 1) >= 0.7)
    .sort((a, b) => b.correct / b.total - a.correct / a.total || b.total - a.total || a.topic.localeCompare(b.topic))
    .map((topic) => ({
      topic: topic.topic,
      accuracy: Math.round((topic.correct / Math.max(topic.total, 1)) * 100),
      attempts: topic.total,
    }))
    .slice(0, 10);

  const quizHistory = attempts
    .map((attempt) => {
      const score = numeric(attempt.score);
      const total = numeric(attempt.total_questions);
      return {
        score,
        total,
        percentage: numeric(attempt.percentage) || (total ? Math.round((score / total) * 100) : 0),
        attemptedAt: text(attempt.created_at),
      };
    })
    .filter((attempt) => attempt.attemptedAt)
    .reverse();

  const avgRecent = quizHistory.slice(-3).reduce((sum, item) => sum + item.percentage, 0) / Math.max(quizHistory.slice(-3).length, 1);
  const activityCount = activityRows.filter(Boolean).length + attempts.length;

  return {
    weakTopics,
    strongTopics,
    recentMistakes: [...mistakeTotals.values()]
      .sort((a, b) => b.misses - a.misses || a.topic.localeCompare(b.topic))
      .slice(0, 8),
    quizHistory,
    preferredDifficulty: avgRecent >= 82 ? "hard" : avgRecent >= 55 ? "medium" : "easy",
    learningPace: activityCount >= 14 ? "intensive" : activityCount >= 4 ? "steady" : "new",
    revisionFrequency: attempts.length >= 5 ? "regular" : attempts.length >= 2 ? "occasional" : "none",
    lastStudiedTopics: uniqueTopics([
      ...attempts.flatMap((attempt) => [...list(attempt.weak_topics), ...list(attempt.strong_topics)]),
      ...weakTopics.map((topic) => topic.topic),
      ...strongTopics.map((topic) => topic.topic),
    ], 8),
  };
}

export function profileFromQuizAnalytics(analytics: QuizAnalytics): LearnerProfile {
  const rows = analytics.lastQuizScore
    ? [{
        score: analytics.lastQuizScore.score,
        total_questions: analytics.lastQuizScore.total,
        percentage: analytics.lastQuizScore.percentage,
        weak_topics: analytics.weakTopics,
        strong_topics: analytics.strongTopics,
        created_at: analytics.lastQuizScore.attemptedAt,
      }]
    : [];
  return buildLearnerProfile(rows);
}

export function buildRevisionRecommendations(profile: LearnerProfile) {
  return profile.weakTopics.slice(0, 5).map((topic, index) => ({
    topic: topic.topic,
    priority: index + 1,
    reason: `${topic.accuracy}% accuracy across ${topic.attempts} question${topic.attempts === 1 ? "" : "s"}`,
    action: `Revise ${topic.topic}, then take a targeted quiz.`,
  }));
}

export function recommendWeakTopic(profile: LearnerProfile): string | null {
  return profile.weakTopics[0]?.topic ?? null;
}

export function buildPersonalizedChatContext(profile: LearnerProfile, question: string) {
  const weak = profile.weakTopics.slice(0, 5).map((topic) => topic.topic);
  const mistakes = profile.recentMistakes.slice(0, 3);
  const lower = question.toLowerCase();
  const mentionedWeak = weak.find((topic) => lower.includes(topic.toLowerCase()));
  if (!weak.length && !mistakes.length) return "";
  return [
    "LEARNER PROFILE:",
    weak.length ? `Prioritize weak concepts first: ${weak.join(", ")}.` : "",
    profile.strongTopics.length ? `Use mastered topics as bridges: ${profile.strongTopics.slice(0, 3).map((topic) => topic.topic).join(", ")}.` : "",
    mistakes.length ? `Recent mistakes: ${mistakes.map((item) => `${item.topic}${item.misses > 1 ? ` (${item.misses} misses)` : ""}`).join(", ")}.` : "",
    mentionedWeak ? `The current question mentions a weak topic (${mentionedWeak}); give extra scaffolding and a quick practice check.` : "",
    "Do not mention private profile data unless it helps the student take the next study action.",
  ].filter(Boolean).join("\n");
}

export function buildPersonalizedQuizOptions(profile: LearnerProfile) {
  const weakTopics = profile.weakTopics.slice(0, 5).map((topic) => topic.topic);
  return {
    difficulty: profile.preferredDifficulty,
    focusTopics: weakTopics,
    extraQuestionBias: weakTopics.length ? `Generate more questions for weak topics: ${weakTopics.join(", ")}.` : "",
  };
}

export function buildSummaryPersonalization(profile: LearnerProfile) {
  const weakTopics = profile.weakTopics.slice(0, 5).map((topic) => topic.topic);
  if (!weakTopics.length) return "";
  return `Learner weak concepts to highlight when present: ${weakTopics.join(", ")}. Add these to exam_focus_points or action_items only if they are supported by the source material.`;
}

export function calculateStudyStreak(activityRows: unknown[], now = new Date()) {
  const dates = new Set<string>();
  for (const row of activityRows) {
    if (!row || typeof row !== "object") continue;
    const record = row as ActivityRow;
    const raw = text(record.created_at ?? record.updated_at);
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) dates.add(date.toISOString().slice(0, 10));
  }
  if (!dates.size) return 0;

  let cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (!dates.has(cursor.toISOString().slice(0, 10))) {
    const yesterday = new Date(cursor);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    if (!dates.has(yesterday.toISOString().slice(0, 10))) return 0;
    cursor = yesterday;
  }

  let streak = 0;
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function estimateStudyMinutes(activityRows: unknown[]) {
  const count = activityRows.filter(Boolean).length;
  if (!count) return null;
  return count * 8;
}

function revisionProgress(revisionPlans: unknown[]) {
  const latest = revisionPlans.find((row) => row && typeof row === "object") as RevisionPlanRow | undefined;
  const plan = latest?.plan && typeof latest.plan === "object" ? latest.plan as Record<string, unknown> : null;
  const daily = Array.isArray(latest?.daily_plan) ? latest.daily_plan : [];
  const completed = numeric(plan?.completed_tasks ?? plan?.completedTasks);
  const pendingFromPlan = numeric(plan?.pending_tasks ?? plan?.pendingTasks);
  if (completed || pendingFromPlan) {
    const total = completed + pendingFromPlan;
    return { completed, pending: pendingFromPlan, completionPercent: total ? Math.round((completed / total) * 100) : 0 };
  }
  const pending = daily.length;
  return { completed: 0, pending, completionPercent: 0 };
}

export function buildDashboardLearningMetrics({
  attempts,
  quizAnalytics,
  revisionPlans = [],
  activityRows = [],
  now = new Date(),
}: {
  attempts: unknown[];
  quizAnalytics: QuizAnalytics;
  revisionPlans?: unknown[];
  activityRows?: unknown[];
  now?: Date;
}): DashboardLearningMetrics {
  const profile = buildLearnerProfile(attempts, activityRows);
  const history = profile.quizHistory;
  const latest = history.at(-1)?.percentage ?? quizAnalytics.lastQuizScore?.percentage ?? null;
  const previous = history.length >= 2 ? history.at(-2)!.percentage : null;
  const delta = latest !== null && previous !== null ? Math.round((latest - previous) * 10) / 10 : null;
  const weak = profile.weakTopics.slice(0, 3);
  const strong = profile.strongTopics.slice(0, 5);
  const progress = revisionProgress(revisionPlans);
  const studyStreakDays = calculateStudyStreak(activityRows, now);
  const timeStudiedMinutes = estimateStudyMinutes(activityRows);
  const recommendedTopic = recommendWeakTopic(profile);
  const insights: string[] = [];

  if (delta !== null && history.length >= 2) {
    const topic = profile.lastStudiedTopics[0] ?? "Quiz";
    insights.push(`${topic} accuracy ${delta >= 0 ? "improved" : "changed"} ${Math.abs(delta)}%`);
  }
  if (recommendedTopic) insights.push(`Revise ${recommendedTopic} next`);
  const repeatedMistake = profile.recentMistakes.find((mistake) => mistake.misses >= 2);
  if (repeatedMistake) insights.push(`You answered ${repeatedMistake.topic} questions incorrectly ${repeatedMistake.misses} times`);
  if (!insights.length && quizAnalytics.attemptCount > 0) insights.push("Take another targeted quiz to refine your weak-topic profile");
  if (!insights.length) insights.push("Upload material, generate a quiz, then StudyPilot will build learning insights here");

  return {
    quizImprovement: {
      previous,
      latest,
      delta,
      trend: delta === null ? "none" : delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    },
    weakTopics: weak,
    strongTopics: strong,
    revisionProgress: progress,
    studyStreakDays,
    timeStudiedMinutes,
    insights: insights.slice(0, 4),
    recommendedNextStudy: recommendedTopic
      ? {
          topic: recommendedTopic,
          reason: weak[0] ? `${weak[0].accuracy}% accuracy, ${weak[0].misses} missed` : "Highest-priority weak topic",
          href: `/chat?topic=${encodeURIComponent(recommendedTopic)}`,
        }
      : null,
  };
}
