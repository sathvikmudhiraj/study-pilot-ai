import "server-only";

import type { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import {
  normalizedLearningTopic,
  statusFromQuizEvidence,
  type LearningEvidence,
  type LearningEvidenceType,
  type LearningState,
  type LearningStatus,
} from "@/shared/learningMemory";

type Supabase = NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>;

type TopicResult = { topic: string; topic_id: string; correct: number; total: number };
type WrongQuestion = { question_id: string; question: string; topic: string; topic_id: string };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function unique(values: string[], limit = 100): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function loadLearningMemory(
  supabase: Supabase,
  userId: string,
  options: { topic?: string; fileId?: string; statuses?: LearningStatus[]; limit?: number } = {},
): Promise<{ states: LearningState[]; evidence: LearningEvidence[] }> {
  let query = supabase
    .from("learning_states")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(options.limit ?? 30, 1), 100));
  if (options.topic) query = query.eq("topic_key", normalizedLearningTopic(options.topic));
  if (options.fileId) query = query.contains("source_file_ids", [options.fileId]);
  if (options.statuses?.length) query = query.in("status", options.statuses);
  const statesResult = await query;
  if (statesResult.error) throw statesResult.error;
  const states = (statesResult.data ?? []) as LearningState[];
  if (!states.length) return { states, evidence: [] };
  const evidenceResult = await supabase
    .from("learning_evidence")
    .select("id, learning_state_id, evidence_type, source_type, source_id, reason, payload, created_at")
    .eq("user_id", userId)
    .in("learning_state_id", states.map((state) => state.id))
    .order("created_at", { ascending: false })
    .limit(100);
  if (evidenceResult.error) throw evidenceResult.error;
  return { states, evidence: (evidenceResult.data ?? []) as LearningEvidence[] };
}

async function stateForTopic(supabase: Supabase, userId: string, topic: string) {
  const topicKey = normalizedLearningTopic(topic);
  if (!topicKey) throw new Error("A learning topic is required.");
  const result = await supabase
    .from("learning_states")
    .select("*")
    .eq("user_id", userId)
    .eq("topic_key", topicKey)
    .maybeSingle();
  if (result.error) throw result.error;
  return { topicKey, state: result.data as LearningState | null };
}

async function saveEvidence(
  supabase: Supabase,
  input: {
    userId: string;
    stateId: string;
    type: LearningEvidenceType;
    sourceType: string;
    sourceId?: string | null;
    reason: string;
    payload?: Record<string, unknown>;
  },
) {
  const saved = await supabase.from("learning_evidence").insert({
    user_id: input.userId,
    learning_state_id: input.stateId,
    evidence_type: input.type,
    source_type: input.sourceType,
    source_id: input.sourceId ?? null,
    reason: input.reason,
    payload: input.payload ?? {},
  });
  if (saved.error) throw saved.error;
}

export async function recordQuizLearningEvidence(
  supabase: Supabase,
  input: {
    userId: string;
    attemptId: string;
    quizId: string;
    fileId: string | null;
    topicResults: TopicResult[];
    wrongQuestions: WrongQuestion[];
  },
) {
  const updated: LearningState[] = [];
  for (const result of input.topicResults) {
    const topic = String(result.topic ?? "").trim() || "General review";
    const { topicKey, state } = await stateForTopic(supabase, input.userId, topic);
    const correct = number(state?.correct_count) + number(result.correct);
    const latestIncorrect = Math.max(0, number(result.total) - number(result.correct));
    const incorrect = number(state?.incorrect_count) + latestIncorrect;
    const quizAttempts = number(state?.quiz_attempts) + 1;
    const questionCount = correct + incorrect;
    const confidence = questionCount ? Math.round((correct / questionCount) * 10000) / 100 : null;
    const wrongForTopic = input.wrongQuestions.filter((wrong) =>
      normalizedLearningTopic(wrong.topic_id || wrong.topic) === normalizedLearningTopic(result.topic_id || topic),
    );
    const payload = {
      user_id: input.userId,
      topic,
      topic_key: topicKey,
      source_file_ids: unique([...(state?.source_file_ids ?? []), ...(input.fileId ? [input.fileId] : [])]),
      status: statusFromQuizEvidence({ correct, incorrect, questionCount, quizAttempts, latestIncorrect }),
      confidence,
      last_studied_at: new Date().toISOString(),
      quiz_attempts: quizAttempts,
      correct_count: correct,
      incorrect_count: incorrect,
      incorrect_question_ids: unique([
        ...strings(state?.incorrect_question_ids),
        ...wrongForTopic.map((wrong) => wrong.question_id),
      ]),
      weak_concepts: latestIncorrect ? unique([...strings(state?.weak_concepts), topic]) : strings(state?.weak_concepts),
      strong_concepts: latestIncorrect ? strings(state?.strong_concepts) : unique([...strings(state?.strong_concepts), topic]),
      revision_due_at: latestIncorrect ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : state?.revision_due_at ?? null,
      revision_status: latestIncorrect ? "due" : state?.revision_status ?? "not_scheduled",
      last_quiz_id: input.quizId,
    };
    const saved = await supabase
      .from("learning_states")
      .upsert(payload, { onConflict: "user_id,topic_key" })
      .select("*")
      .single();
    if (saved.error) throw saved.error;
    const savedState = saved.data as LearningState;
    await saveEvidence(supabase, {
      userId: input.userId,
      stateId: savedState.id,
      type: "quiz_result",
      sourceType: "quiz_attempt",
      sourceId: input.attemptId,
      reason: latestIncorrect
        ? `${latestIncorrect} of ${result.total} ${topic} question(s) were incorrect in this quiz.`
        : `${result.correct} of ${result.total} ${topic} question(s) were correct in this quiz.`,
      payload: { quiz_id: input.quizId, correct: result.correct, total: result.total, incorrect_question_ids: wrongForTopic.map((wrong) => wrong.question_id) },
    });
    updated.push(savedState);
  }
  return updated;
}

export async function recordExplicitLearningEvidence(
  supabase: Supabase,
  input: {
    userId: string;
    topic: string;
    fileIds?: string[];
    understood: boolean;
    conversationId?: string | null;
  },
) {
  const { topicKey, state } = await stateForTopic(supabase, input.userId, input.topic);
  const payload = {
    user_id: input.userId,
    topic: input.topic.trim(),
    topic_key: topicKey,
    source_file_ids: unique([...(state?.source_file_ids ?? []), ...(input.fileIds ?? [])]),
    status: input.understood ? "UNDERSTOOD" : "NEEDS_REVISION",
    last_studied_at: new Date().toISOString(),
    revision_status: input.understood ? state?.revision_status ?? "not_scheduled" : "due",
    revision_due_at: input.understood ? state?.revision_due_at ?? null : new Date().toISOString(),
  };
  const saved = await supabase.from("learning_states").upsert(payload, { onConflict: "user_id,topic_key" }).select("*").single();
  if (saved.error) throw saved.error;
  await saveEvidence(supabase, {
    userId: input.userId,
    stateId: saved.data.id,
    type: input.understood ? "explicit_understanding" : "explicit_confusion",
    sourceType: "conversation",
    sourceId: input.conversationId ?? null,
    reason: input.understood ? "User explicitly stated that they understand this topic." : "User explicitly stated that this topic is still unclear.",
  });
  return saved.data as LearningState;
}

export async function recordRevisionCompleted(
  supabase: Supabase,
  input: { userId: string; revisionPlanId: string; topics: string[]; fileIds?: string[] },
) {
  const states: LearningState[] = [];
  for (const topic of unique(input.topics, 30)) {
    const { topicKey, state } = await stateForTopic(supabase, input.userId, topic);
    const saved = await supabase.from("learning_states").upsert({
      user_id: input.userId,
      topic,
      topic_key: topicKey,
      source_file_ids: unique([...(state?.source_file_ids ?? []), ...(input.fileIds ?? [])]),
      status: state?.status === "NEW" || !state ? "LEARNING" : state.status,
      last_studied_at: new Date().toISOString(),
      last_reviewed_at: new Date().toISOString(),
      times_reviewed: number(state?.times_reviewed) + 1,
      revision_status: "completed",
      revision_due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      last_revision_plan_id: input.revisionPlanId,
    }, { onConflict: "user_id,topic_key" }).select("*").single();
    if (saved.error) throw saved.error;
    await saveEvidence(supabase, {
      userId: input.userId,
      stateId: saved.data.id,
      type: "revision_completed",
      sourceType: "revision_plan",
      sourceId: input.revisionPlanId,
      reason: "User explicitly marked a revision plan containing this topic complete.",
    });
    states.push(saved.data as LearningState);
  }
  return states;
}

export async function recordNoteLearningEvidence(
  supabase: Supabase,
  input: { userId: string; noteId: string; topic: string; fileId?: string | null },
) {
  const topic = input.topic.trim();
  if (!topic) return null;
  const { topicKey, state } = await stateForTopic(supabase, input.userId, topic);
  const saved = await supabase.from("learning_states").upsert({
    user_id: input.userId,
    topic,
    topic_key: topicKey,
    source_file_ids: unique([...(state?.source_file_ids ?? []), ...(input.fileId ? [input.fileId] : [])]),
    status: state?.status === "NEEDS_REVISION" ? state.status : state?.status === "UNDERSTOOD" || state?.status === "MASTERED" ? state.status : "LEARNING",
    last_studied_at: new Date().toISOString(),
    notes_created: number(state?.notes_created) + 1,
  }, { onConflict: "user_id,topic_key" }).select("*").single();
  if (saved.error) throw saved.error;
  await saveEvidence(supabase, {
    userId: input.userId,
    stateId: saved.data.id,
    type: "note_created",
    sourceType: "note",
    sourceId: input.noteId,
    reason: `User saved a note for ${topic}.`,
  });
  return saved.data as LearningState;
}

export function learningRecommendation(memory: { states: LearningState[]; evidence: LearningEvidence[] }, intent: string) {
  const states = memory.states;
  if (!states.length) return { text: "I do not have learning evidence yet. Complete a quiz or explicitly mark a topic as understood or unclear first.", states: [] };
  const weak = states.filter((state) => state.status === "NEEDS_REVISION").sort((a, b) => b.incorrect_count - a.incorrect_count);
  if (intent === "mistakes") {
    const rows = weak.filter((state) => state.incorrect_question_ids.length).slice(0, 5);
    return { text: rows.length ? rows.map((state) => `${state.topic}: ${state.incorrect_count} incorrect answer${state.incorrect_count === 1 ? "" : "s"} across recorded quizzes.`).join("\n") : "No incorrect quiz answers are recorded yet.", states: rows };
  }
  if (intent === "continue_study") {
    const resumable = states.find((state) => state.unfinished_task) ?? states[0];
    return { text: `Continue ${resumable.topic}. Its saved status is ${resumable.status.toLowerCase().replaceAll("_", " ")}${resumable.unfinished_task ? ", with an unfinished task saved" : ""}.`, states: [resumable] };
  }
  if (intent === "unstudied") {
    const unstudied = states.filter((state) => state.status === "NEW").slice(0, 5);
    return {
      text: unstudied.length
        ? unstudied.map((state) => `${state.topic}: no completed study evidence is recorded yet.`).join("\n")
        : "I do not have any curriculum topics explicitly recorded as unstudied. I will not infer missing topics without source evidence.",
      states: unstudied,
    };
  }
  const recommended = intent === "weak_topics" || intent === "revision_topics"
    ? weak.slice(0, 5)
    : (weak.length ? weak : states.filter((state) => state.status === "LEARNING" || state.status === "NEW")).slice(0, 5);
  if (!recommended.length) return { text: "Your recorded topics currently have no due revision evidence.", states: [] };
  return {
    text: recommended.map((state) => {
      const evidence = state.incorrect_count
        ? `${state.incorrect_count} incorrect answer${state.incorrect_count === 1 ? "" : "s"} across ${state.quiz_attempts} topic quiz attempt${state.quiz_attempts === 1 ? "" : "s"}`
        : `saved status ${state.status.toLowerCase().replaceAll("_", " ")}`;
      return `${state.topic}: revise because of ${evidence}.`;
    }).join("\n"),
    states: recommended,
  };
}
