import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let gradeQuizAttempt: typeof import("../quizAnalytics").gradeQuizAttempt;
let buildQuizAnalytics: typeof import("../quizAnalytics").buildQuizAnalytics;

beforeAll(async () => {
  ({ gradeQuizAttempt, buildQuizAnalytics } = await import("../quizAnalytics"));
});

describe("multilingual quiz grading and analytics", () => {
  it("accepts selected-language and English short answers", () => {
    const questions = [{
      id: "q1",
      type: "short",
      topic: "गोपनीयता",
      topic_en: "Confidentiality",
      topic_id: "confidentiality",
      question: "CIA triad में C क्या है?",
      acceptable_answers: ["गोपनीयता", "confidentiality"],
    }];

    const hindi = gradeQuizAttempt({ questions, answerKey: questions, answers: { q1: "गोपनीयता" } });
    const english = gradeQuizAttempt({ questions, answerKey: questions, answers: { q1: "Confidentiality" } });

    expect(hindi.score).toBe(1);
    expect(english.score).toBe(1);
    expect(hindi.topic_results[0]).toMatchObject({ topic_id: "confidentiality", topic: "गोपनीयता" });
  });

  it("aggregates translated labels under one canonical topic", () => {
    const analytics = buildQuizAnalytics([
      { created_at: "2026-08-03", score: 0, total_questions: 1, topic_results: [{ topic_id: "confidentiality", topic: "गोपनीयता", correct: 0, total: 1 }] },
      { created_at: "2026-08-02", score: 1, total_questions: 2, topic_results: [{ topic_id: "confidentiality", topic: "Confidentiality", correct: 1, total: 2 }] },
    ]);

    expect(analytics.weakTopicIds).toEqual(["confidentiality"]);
    expect(analytics.weakTopics).toHaveLength(1);
  });
});
