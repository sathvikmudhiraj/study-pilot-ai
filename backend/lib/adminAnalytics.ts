import "server-only";

import { createAdminSupabaseClient } from "./adminSupabase";
import { canonicalTopicId } from "@/shared/languages";

export type AdminTopicPerformance = {
  topicId: string;
  label: string;
  correct: number;
  total: number;
  percentage: number;
};

export type AdminLanguageUsage = {
  language: string;
  count: number;
};

export type AdminQuizAnalytics = {
  totalAttempts: number;
  averagePercentage: number;
  completionRate: number;
  topicPerformance: AdminTopicPerformance[];
  languageUsage: AdminLanguageUsage[];
  revisionPlans: { total: number; active: number };
  repeatQuizUsage: number;
};

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : [];
}

async function getQuizAttemptsSummary(supabase: ReturnType<typeof createAdminSupabaseClient>) {
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("percentage, total_questions, score, topic_results, weak_topics, strong_topics, created_at, quiz_id, quizzes!inner(language_code)")
    .limit(5000);

  if (error) throw new Error(`Failed to fetch quiz attempts: ${error.message}`);
  return (data as Record<string, unknown>[]) ?? [];
}

async function getRevisionPlansSummary(supabase: ReturnType<typeof createAdminSupabaseClient>) {
  const { data, error } = await supabase
    .from("revision_plans")
    .select("id, created_at, language_code")
    .limit(2000);

  if (error) throw new Error(`Failed to fetch revision plans: ${error.message}`);
  return (data as Record<string, unknown>[]) ?? [];
}

async function getQuizzesSummary(supabase: ReturnType<typeof createAdminSupabaseClient>) {
  const { data, error } = await supabase
    .from("quizzes")
    .select("id, language_code")
    .limit(2000);

  if (error) throw new Error(`Failed to fetch quizzes: ${error.message}`);
  return (data as Record<string, unknown>[]) ?? [];
}

export async function getAdminLearningAnalytics(): Promise<AdminQuizAnalytics> {
  const supabase = createAdminSupabaseClient();

  const [attempts, revisionPlans, quizzes] = await Promise.all([
    getQuizAttemptsSummary(supabase),
    getRevisionPlansSummary(supabase),
    getQuizzesSummary(supabase),
  ]);

  if (!attempts.length) {
    return {
      totalAttempts: 0,
      averagePercentage: 0,
      completionRate: 0,
      topicPerformance: [],
      languageUsage: [],
      revisionPlans: { total: revisionPlans.length, active: 0 },
      repeatQuizUsage: 0,
    };
  }

  const totals = new Map<string, { label: string; correct: number; total: number }>();
  const languageCounts = new Map<string, number>();

  let totalPercentage = 0;
  let completedCount = 0;

  for (const attempt of attempts) {
    const percentage = numeric(attempt.percentage);
    totalPercentage += percentage;
    if (numeric(attempt.total_questions) > 0) completedCount += 1;

    const quizLang = (attempt.quizzes as Record<string, unknown> | null)?.language_code;
    const lang = text(quizLang) || "en";
    languageCounts.set(lang, (languageCounts.get(lang) ?? 0) + 1);

    const topicResults = Array.isArray(attempt.topic_results) ? attempt.topic_results : [];
    if (topicResults.length) {
      for (const item of topicResults) {
        if (!item || typeof item !== "object") continue;
        const result = item as Record<string, unknown>;
        const topicLabel = text(result.topic);
        const topicId = canonicalTopicId(result.topic_id ?? topicLabel);
        if (!topicLabel) continue;
        const aggregate = totals.get(topicId) ?? { label: topicLabel, correct: 0, total: 0 };
        aggregate.label = topicLabel || aggregate.label;
        aggregate.correct += numeric(result.correct);
        aggregate.total += numeric(result.total);
        totals.set(topicId, aggregate);
      }
      continue;
    }

    for (const topic of stringList(attempt.weak_topics)) {
      const topicId = canonicalTopicId(topic);
      const aggregate = totals.get(topicId) ?? { label: topic, correct: 0, total: 0 };
      aggregate.total += 1;
      totals.set(topicId, aggregate);
    }
    for (const topic of stringList(attempt.strong_topics)) {
      const topicId = canonicalTopicId(topic);
      const aggregate = totals.get(topicId) ?? { label: topic, correct: 0, total: 0 };
      aggregate.correct += 1;
      aggregate.total += 1;
      totals.set(topicId, aggregate);
    }
  }

  const topicPerformance = [...totals.entries()]
    .map(([topicId, result]) => ({
      topicId,
      label: result.label,
      correct: result.correct,
      total: result.total,
      percentage: result.total > 0 ? Math.min(100, Math.round((result.correct / result.total) * 10000) / 100) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.topicId.localeCompare(b.topicId))
    .slice(0, 50);

  const languageUsage = [...languageCounts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count);

  const quizByLang = new Map<string, number>();
  for (const quiz of quizzes) {
    const lang = text(quiz.language_code) || "en";
    quizByLang.set(lang, (quizByLang.get(lang) ?? 0) + 1);
  }

  const repeatQuizUsage = attempts.length - quizByLang.size > 0 ? attempts.length - quizByLang.size : 0;

  return {
    totalAttempts: attempts.length,
    averagePercentage: attempts.length ? Math.round((totalPercentage / attempts.length) * 100) / 100 : 0,
    completionRate: attempts.length ? Math.round((completedCount / attempts.length) * 10000) / 100 : 0,
    topicPerformance,
    languageUsage,
    revisionPlans: { total: revisionPlans.length, active: 0 },
    repeatQuizUsage: Math.max(0, repeatQuizUsage),
  };
}
