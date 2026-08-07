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

  it("uses canonical topic ids while preserving translated display labels", () => {
    const profile = buildLearnerProfile([{
      score: 0,
      total_questions: 2,
      percentage: 0,
      topic_results: [
        { topic_id: "confidentiality", topic: "गोपनीयता", correct: 0, total: 1 },
        { topic_id: "confidentiality", topic: "Confidentiality", correct: 0, total: 1 },
      ],
      created_at: "2026-08-03T10:00:00.000Z",
    }]);

    expect(profile.weakTopics).toHaveLength(1);
    expect(profile.weakTopics[0]?.canonicalId).toBe("confidentiality");
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

  it("computes topic improvement history from chronological attempts", () => {
    const metrics = buildDashboardLearningMetrics({
      attempts,
      quizAnalytics: analytics,
      activityRows: [],
      revisionPlans: [],
    });

    expect(metrics.topicImprovementHistory).toHaveLength(2);
    expect(metrics.topicImprovementHistory[0].topicId).toBe("subnetting");
    expect(metrics.topicImprovementHistory[0].topic).toBe("Subnetting");
    expect(metrics.topicImprovementHistory[0].points).toHaveLength(2);
    expect(metrics.topicImprovementHistory[0].points[0].percentage).toBe(20);
    expect(metrics.topicImprovementHistory[0].points[1].percentage).toBe(40);
  });

  it("returns empty topic improvement history for users with no attempts", () => {
    const metrics = buildDashboardLearningMetrics({
      attempts: [],
      quizAnalytics: { attemptCount: 0, weakTopics: [], strongTopics: [], lastQuizScore: null },
      activityRows: [],
      revisionPlans: [],
    });

    expect(metrics.topicImprovementHistory).toEqual([]);
    expect(metrics.beforeVsLatest).toEqual([]);
    expect(metrics.masteryProgress).toEqual([]);
  });

  it("computes before-vs-latest improvement for topics with multiple attempts", () => {
    const metrics = buildDashboardLearningMetrics({
      attempts,
      quizAnalytics: analytics,
      activityRows: [],
      revisionPlans: [],
    });

    expect(metrics.beforeVsLatest.length).toBeGreaterThanOrEqual(1);
    const subnetting = metrics.beforeVsLatest.find((item) => item.topicId === "subnetting");
    expect(subnetting).toBeDefined();
    expect(subnetting!.first).toBe(20);
    expect(subnetting!.latest).toBe(40);
    expect(subnetting!.improvement).toBe(20);
  });

  it("mastery progress categorizes topics as weak, developing, or strong", () => {
    const metrics = buildDashboardLearningMetrics({
      attempts,
      quizAnalytics: analytics,
      activityRows: [],
      revisionPlans: [],
    });

    expect(metrics.masteryProgress.length).toBeGreaterThanOrEqual(1);
    metrics.masteryProgress.forEach((topic) => {
      expect(["weak", "developing", "strong"]).toContain(topic.mastery);
      expect(topic.accuracy).toBeGreaterThanOrEqual(0);
      expect(topic.accuracy).toBeLessThanOrEqual(100);
    });
  });

  it("limits topic improvement history to top 3 weak topics", () => {
    const manyAttempts = [
      { score: 1, total_questions: 4, percentage: 25, topic_results: [{ topic: "A", correct: 1, total: 4 }], created_at: "2026-07-10T00:00:00.000Z" },
      { score: 1, total_questions: 4, percentage: 25, topic_results: [{ topic: "B", correct: 1, total: 4 }], created_at: "2026-07-11T00:00:00.000Z" },
      { score: 1, total_questions: 4, percentage: 25, topic_results: [{ topic: "C", correct: 1, total: 4 }], created_at: "2026-07-12T00:00:00.000Z" },
      { score: 1, total_questions: 4, percentage: 25, topic_results: [{ topic: "D", correct: 1, total: 4 }], created_at: "2026-07-13T00:00:00.000Z" },
    ];

    const metrics = buildDashboardLearningMetrics({
      attempts: manyAttempts,
      quizAnalytics: { attemptCount: 4, weakTopics: ["a", "b", "c", "d"], strongTopics: [], lastQuizScore: { score: 1, total: 4, percentage: 25, attemptedAt: "2026-07-13T00:00:00.000Z" } },
      activityRows: [],
      revisionPlans: [],
    });

    expect(metrics.topicImprovementHistory.length).toBeGreaterThanOrEqual(1);
    expect(metrics.topicImprovementHistory.length).toBeLessThanOrEqual(3);
  });

  it("limits mastery progress to top 5 topics", () => {
    const manyTopics = [
      { score: 10, total_questions: 10, percentage: 100, topic_results: [
        { topic: "a", correct: 2, total: 2 }, { topic: "b", correct: 2, total: 2 }, { topic: "c", correct: 2, total: 2 },
        { topic: "d", correct: 1, total: 2 }, { topic: "e", correct: 1, total: 2 }, { topic: "f", correct: 1, total: 2 },
      ], created_at: "2026-07-14T00:00:00.000Z" },
    ];
    const metrics = buildDashboardLearningMetrics({
      attempts: manyTopics,
      quizAnalytics: { attemptCount: 1, weakTopics: ["d", "e", "f"], strongTopics: ["a", "b", "c"], lastQuizScore: { percentage: 100, score: 10, total: 10, attemptedAt: "2026-07-14T00:00:00.000Z" } },
      activityRows: [],
      revisionPlans: [],
    });

    expect(metrics.masteryProgress.length).toBeGreaterThanOrEqual(1);
    expect(metrics.masteryProgress.length).toBeGreaterThanOrEqual(1);
    expect(metrics.masteryProgress.length).toBeLessThanOrEqual(5);
  });

  it("excludes single-attempt topics from before-vs-latest", () => {
    const single = [{ score: 5, total_questions: 10, percentage: 50, topic_results: [{ topic: "OneHit", correct: 5, total: 10 }], created_at: "2026-07-14T00:00:00.000Z" }];
    const metrics = buildDashboardLearningMetrics({
      attempts: single,
      quizAnalytics: { attemptCount: 1, weakTopics: ["OneHit"], strongTopics: [], lastQuizScore: { percentage: 50, score: 5, total: 10, attemptedAt: "2026-07-14T00:00:00.000Z" } },
      activityRows: [],
      revisionPlans: [],
    });

    expect(metrics.beforeVsLatest).toEqual([]);
  });
});
