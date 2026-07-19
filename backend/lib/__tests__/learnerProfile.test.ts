import { describe, expect, it } from "vitest";
import {
  buildDashboardLearningMetrics,
  buildLearnerProfile,
  buildPersonalizedChatContext,
  buildPersonalizedQuizOptions,
  buildRevisionRecommendations,
  buildSummaryPersonalization,
  calculateStudyStreak,
  recommendWeakTopic,
} from "../learnerProfile";

const attempts = [
  {
    score: 4,
    total_questions: 10,
    percentage: 40,
    weak_topics: ["Subnetting"],
    strong_topics: ["DNS"],
    topic_results: [
      { topic: "Subnetting", correct: 1, total: 5 },
      { topic: "DNS", correct: 3, total: 3 },
    ],
    wrong_questions: [
      { question_id: "q1", question: "Find the subnet mask", topic: "Subnetting", user_answer: "255.0.0.0", correct_answer: "255.255.255.0" },
      { question_id: "q2", question: "Find the subnet mask", topic: "Subnetting", user_answer: "/8", correct_answer: "/24" },
    ],
    created_at: "2026-07-15T10:00:00.000Z",
  },
  {
    score: 7,
    total_questions: 10,
    percentage: 70,
    weak_topics: ["OSI Model"],
    strong_topics: ["DNS"],
    topic_results: [
      { topic: "Subnetting", correct: 2, total: 5 },
      { topic: "OSI Model", correct: 1, total: 3 },
      { topic: "DNS", correct: 2, total: 2 },
    ],
    wrong_questions: [
      { question_id: "q3", question: "Which layer handles routing?", topic: "OSI Model", user_answer: "Transport", correct_answer: "Network" },
    ],
    created_at: "2026-07-16T10:00:00.000Z",
  },
];

const analytics = {
  attemptCount: 2,
  weakTopics: ["Subnetting", "OSI Model"],
  strongTopics: ["DNS"],
  lastQuizScore: {
    score: 7,
    total: 10,
    percentage: 70,
    attemptedAt: "2026-07-16T10:00:00.000Z",
  },
};

describe("learner profile", () => {
  it("updates a learner profile from quiz analytics rows", () => {
    const profile = buildLearnerProfile(attempts);

    expect(profile.weakTopics[0]?.topic).toBe("Subnetting");
    expect(profile.weakTopics[0]?.misses).toBeGreaterThan(0);
    expect(profile.strongTopics.map((topic) => topic.topic)).toContain("DNS");
    expect(profile.recentMistakes[0]).toMatchObject({ topic: "Subnetting", misses: 2 });
    expect(profile.quizHistory.map((item) => item.percentage)).toEqual([40, 70]);
  });

  it("calculates dashboard metrics without hardcoded values", () => {
    const metrics = buildDashboardLearningMetrics({
      attempts,
      quizAnalytics: analytics,
      revisionPlans: [{ daily_plan: [{}, {}, {}], plan: { completed_tasks: 1, pending_tasks: 2 } }],
      activityRows: attempts,
      now: new Date("2026-07-17T10:00:00.000Z"),
    });

    expect(metrics.quizImprovement.previous).toBe(40);
    expect(metrics.quizImprovement.latest).toBe(70);
    expect(metrics.quizImprovement.delta).toBe(30);
    expect(metrics.revisionProgress).toEqual({ completed: 1, pending: 2, completionPercent: 33 });
    expect(metrics.recommendedNextStudy?.topic).toBe("Subnetting");
    expect(metrics.insights.some((insight) => insight.includes("Revise Subnetting next"))).toBe(true);
  });

  it("generates weak-topic recommendations and revision priority", () => {
    const profile = buildLearnerProfile(attempts);

    expect(recommendWeakTopic(profile)).toBe("Subnetting");
    expect(buildRevisionRecommendations(profile)[0]).toMatchObject({
      topic: "Subnetting",
      priority: 1,
    });
  });

  it("creates personalized chat context for repeated weak concepts", () => {
    const context = buildPersonalizedChatContext(buildLearnerProfile(attempts), "I keep getting subnetting wrong");

    expect(context).toContain("Prioritize weak concepts first");
    expect(context).toContain("Subnetting");
    expect(context).toContain("extra scaffolding");
  });

  it("creates personalized quiz and summary guidance", () => {
    const profile = buildLearnerProfile(attempts);

    expect(buildPersonalizedQuizOptions(profile)).toMatchObject({
      focusTopics: expect.arrayContaining(["Subnetting"]),
    });
    expect(buildSummaryPersonalization(profile)).toContain("Subnetting");
  });

  it("calculates study streak from persisted activity", () => {
    expect(
      calculateStudyStreak(
        [
          { created_at: "2026-07-17T01:00:00.000Z" },
          { created_at: "2026-07-16T01:00:00.000Z" },
          { created_at: "2026-07-15T01:00:00.000Z" },
        ],
        new Date("2026-07-17T10:00:00.000Z"),
      ),
    ).toBe(3);
  });

  it("handles empty users without fake statistics", () => {
    const profile = buildLearnerProfile([]);
    const metrics = buildDashboardLearningMetrics({
      attempts: [],
      quizAnalytics: { attemptCount: 0, weakTopics: [], strongTopics: [], lastQuizScore: null },
      activityRows: [],
      revisionPlans: [],
    });

    expect(profile.weakTopics).toEqual([]);
    expect(metrics.quizImprovement.latest).toBeNull();
    expect(metrics.timeStudiedMinutes).toBeNull();
    expect(metrics.studyStreakDays).toBe(0);
    expect(metrics.recommendedNextStudy).toBeNull();
  });
});
