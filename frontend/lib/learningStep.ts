export const LEARN_STEP_BY_STEP_MODE = "learn_step_by_step" as const;

export const LEARNING_PATH_STEPS = [
  "Topic introduction",
  "Core concept",
  "Simple example",
  "Worked example",
  "Practice question",
  "Mini quiz",
  "Summary",
] as const;

export type LearnStepByStepMode = typeof LEARN_STEP_BY_STEP_MODE;

export type LearningStepStatus = "active" | "ended";
export type LearningFeedback = "correct" | "incorrect" | null;

export type LearningStepMeta = {
  current_step: number;
  total_steps: number;
  step_title: string;
  session_status: LearningStepStatus;
  expects_answer?: boolean;
  feedback?: LearningFeedback;
};

export type LearningControl =
  | "next"
  | "previous"
  | "simpler"
  | "another_example"
  | "quiz"
  | "skip"
  | "end";

const CONTROL_PROMPTS: Record<LearningControl, string> = {
  next: "Next Step",
  previous: "Previous Step",
  simpler: "Explain Simpler",
  another_example: "Give Another Example",
  quiz: "Quiz Me",
  skip: "Skip Step",
  end: "End Session",
};

export function normalizeLearningStepMeta(value: unknown): LearningStepMeta | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const total = Number(record.total_step_count ?? record.total_steps ?? LEARNING_PATH_STEPS.length);
  const current = Number(record.current_step ?? record.step ?? 1);
  const boundedTotal = Number.isFinite(total) ? Math.max(1, Math.min(12, Math.trunc(total))) : LEARNING_PATH_STEPS.length;
  const boundedCurrent = Number.isFinite(current) ? Math.max(1, Math.min(boundedTotal, Math.trunc(current))) : 1;
  const title = typeof record.step_title === "string" && record.step_title.trim()
    ? record.step_title.trim()
    : LEARNING_PATH_STEPS[boundedCurrent - 1] ?? `Step ${boundedCurrent}`;
  const status = record.session_status === "ended" ? "ended" : "active";
  const feedback = record.feedback === "correct" || record.feedback === "incorrect" ? record.feedback : null;

  return {
    current_step: boundedCurrent,
    total_steps: boundedTotal,
    step_title: title,
    session_status: status,
    expects_answer: Boolean(record.expects_answer),
    feedback,
  };
}

export function learningProgressPercent(meta: LearningStepMeta): number {
  if (meta.total_steps <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((meta.current_step / meta.total_steps) * 100)));
}

export function learningControlPrompt(control: LearningControl): string {
  return CONTROL_PROMPTS[control];
}

export function buildLearningControlQuestion(control: LearningControl): string {
  return learningControlPrompt(control);
}

export function shouldAdvanceAfterFeedback(meta: LearningStepMeta): boolean {
  return meta.feedback === "correct" && meta.session_status === "active";
}
