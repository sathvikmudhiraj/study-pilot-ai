export const LEARNING_STATUSES = ["NEW", "LEARNING", "NEEDS_REVISION", "UNDERSTOOD", "MASTERED"] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export type LearningEvidenceType =
  | "quiz_result"
  | "explicit_understanding"
  | "explicit_confusion"
  | "revision_completed"
  | "note_created"
  | "summary_viewed"
  | "task_progress";

export type LearningState = {
  id: string;
  user_id: string;
  subject: string | null;
  topic: string;
  topic_key: string;
  subtopic: string | null;
  source_file_ids: string[];
  status: LearningStatus;
  confidence: number | null;
  last_studied_at: string | null;
  last_reviewed_at: string | null;
  times_reviewed: number;
  quiz_attempts: number;
  correct_count: number;
  incorrect_count: number;
  incorrect_question_ids: string[];
  weak_concepts: string[];
  strong_concepts: string[];
  revision_due_at: string | null;
  revision_status: "not_scheduled" | "due" | "scheduled" | "completed";
  notes_created: number;
  summary_viewed: boolean;
  last_explanation_id: string | null;
  last_artifact_id: string | null;
  last_quiz_id: string | null;
  last_revision_plan_id: string | null;
  unfinished_task: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type LearningEvidence = {
  id: string;
  learning_state_id: string;
  evidence_type: LearningEvidenceType;
  source_type: string;
  source_id: string | null;
  reason: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export function normalizedLearningTopic(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

export function statusFromQuizEvidence(input: {
  correct: number;
  incorrect: number;
  questionCount: number;
  quizAttempts: number;
  latestIncorrect?: number;
}): LearningStatus {
  if ((input.latestIncorrect ?? input.incorrect) > 0) return "NEEDS_REVISION";
  const accuracy = input.questionCount ? input.correct / input.questionCount : 0;
  if (input.quizAttempts >= 3 && input.questionCount >= 12 && accuracy >= 0.9) return "MASTERED";
  if (input.quizAttempts >= 2 && input.questionCount >= 6 && accuracy >= 0.8) return "UNDERSTOOD";
  return input.questionCount > 0 ? "LEARNING" : "NEW";
}

export function learningMemoryIntent(text: string):
  | "weak_topics"
  | "study_next"
  | "mistakes"
  | "revision_topics"
  | "unstudied"
  | "continue_study"
  | "explicit_understanding"
  | "explicit_confusion"
  | null {
  const value = text.normalize("NFKC").toLocaleLowerCase().replace(/[?.!]+$/u, "").trim();
  if (/\b(?:i understand(?: this| it)?(?: now)?|mark (?:this|it) (?:complete|understood))\b/u.test(value)) return "explicit_understanding";
  if (/\b(?:i (?:still )?do not understand|i (?:still )?don't understand|this is confusing|i am confused)\b/u.test(value)) return "explicit_confusion";
  if (/\b(?:what am i weak in|show (?:my )?weak topics|my weak areas)\b/u.test(value)) return "weak_topics";
  if (/\b(?:what did i keep getting wrong|recent mistakes|questions i got wrong)\b/u.test(value)) return "mistakes";
  if (/\b(?:what should i revise|topics?.*need revision|review weak topics)\b/u.test(value)) return "revision_topics";
  if (/\b(?:what should i study(?: now)?|recommend.*study|study next)\b/u.test(value)) return "study_next";
  if (/\b(?:what (?:have i not|haven't i) studied|unstudied topics)\b/u.test(value)) return "unstudied";
  if (/\b(?:continue (?:from )?where i stopped|continue.*yesterday|resume.*study)\b/u.test(value)) return "continue_study";
  return null;
}
