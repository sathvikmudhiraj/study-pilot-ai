import { describe, expect, it } from "vitest";
import {
  LEARN_STEP_BY_STEP_MODE,
  LEARNING_PATH_STEPS,
  buildLearningControlQuestion,
  learningProgressPercent,
  normalizeLearningStepMeta,
  shouldAdvanceAfterFeedback,
} from "../learningStep";

describe("learningStep helpers", () => {
  it("starts a step-by-step session with bounded progress metadata", () => {
    const meta = normalizeLearningStepMeta({
      current_step: 1,
      total_steps: 7,
      step_title: "Topic introduction",
      session_status: "active",
    });

    expect(LEARN_STEP_BY_STEP_MODE).toBe("learn_step_by_step");
    expect(LEARNING_PATH_STEPS).toHaveLength(7);
    expect(meta).toMatchObject({
      current_step: 1,
      total_steps: 7,
      step_title: "Topic introduction",
      session_status: "active",
    });
    expect(meta ? learningProgressPercent(meta) : 0).toBe(14);
  });

  it("moves between steps through explicit controls", () => {
    const meta = normalizeLearningStepMeta({
      current_step: 3,
      total_steps: 7,
      step_title: "Simple example",
    });

    expect(meta?.current_step).toBe(3);
    expect(buildLearningControlQuestion("next")).toContain("Next Step");
    expect(buildLearningControlQuestion("previous")).toContain("Previous Step");
    expect(buildLearningControlQuestion("skip")).toBe("Skip Step");
  });

  it("keeps incorrect answers on a retry path", () => {
    const meta = normalizeLearningStepMeta({
      current_step: 5,
      total_steps: 7,
      step_title: "Practice question",
      feedback: "incorrect",
      expects_answer: true,
    });

    expect(meta?.feedback).toBe("incorrect");
    expect(shouldAdvanceAfterFeedback(meta!)).toBe(false);
  });

  it("allows correct answers to progress", () => {
    const meta = normalizeLearningStepMeta({
      current_step: 5,
      total_steps: 7,
      step_title: "Practice question",
      feedback: "correct",
    });

    expect(shouldAdvanceAfterFeedback(meta!)).toBe(true);
  });

  it("restores a session after refresh from persisted answer JSON", () => {
    const persisted = JSON.parse(JSON.stringify({
      current_step: 6,
      total_steps: 7,
      step_title: "Mini quiz",
      session_status: "active",
    }));

    expect(normalizeLearningStepMeta(persisted)).toMatchObject({
      current_step: 6,
      total_steps: 7,
      step_title: "Mini quiz",
    });
  });

  it("keeps normal chat and step-by-step mode distinct", () => {
    expect(buildLearningControlQuestion("quiz")).toBe("Quiz Me");
    expect(LEARN_STEP_BY_STEP_MODE).not.toBe("study");
  });
});
