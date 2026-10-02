import { describe, expect, it } from "vitest";
import { learningMemoryIntent, normalizedLearningTopic, statusFromQuizEvidence } from "../learningMemory";

describe("evidence-based learning memory", () => {
  it("normalizes multilingual topic keys without discarding letters", () => {
    expect(normalizedLearningTopic("  Deadlock--Prevention! ")).toBe("deadlock prevention");
    expect(normalizedLearningTopic("తెలుగు పాఠం")).toBe("తెలుగు పాఠం");
  });

  it("marks any newly incorrect quiz topic for revision", () => {
    expect(statusFromQuizEvidence({ correct: 19, incorrect: 1, questionCount: 20, quizAttempts: 4, latestIncorrect: 1 }))
      .toBe("NEEDS_REVISION");
  });

  it("requires repeated strong evidence before mastery", () => {
    expect(statusFromQuizEvidence({ correct: 5, incorrect: 0, questionCount: 5, quizAttempts: 1, latestIncorrect: 0 }))
      .toBe("LEARNING");
    expect(statusFromQuizEvidence({ correct: 10, incorrect: 0, questionCount: 10, quizAttempts: 2, latestIncorrect: 0 }))
      .toBe("UNDERSTOOD");
    expect(statusFromQuizEvidence({ correct: 12, incorrect: 0, questionCount: 12, quizAttempts: 3, latestIncorrect: 0 }))
      .toBe("MASTERED");
  });

  it.each([
    ["What am I weak in?", "weak_topics"],
    ["What should I study now?", "study_next"],
    ["What did I keep getting wrong?", "mistakes"],
    ["Continue from where I stopped", "continue_study"],
    ["I understand this now", "explicit_understanding"],
    ["I still don't understand", "explicit_confusion"],
  ] as const)("routes %s to %s", (message, intent) => {
    expect(learningMemoryIntent(message)).toBe(intent);
  });
});
