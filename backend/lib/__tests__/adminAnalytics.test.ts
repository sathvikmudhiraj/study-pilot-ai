import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock("../adminSupabase", () => ({ createAdminSupabaseClient: mocks.createAdminSupabaseClient }));

import { getAdminLearningAnalytics } from "../adminAnalytics";

describe("adminAnalytics - getAdminLearningAnalytics", () => {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAdminSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    });
    mockChain.select.mockReturnValue(mockChain);
    mockChain.limit.mockReturnValue(mockChain);
  });

  it("returns empty analytics when no attempts exist", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null }))) // quiz_attempts
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null }))) // revision_plans
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null }))); // quizzes

    const result = await getAdminLearningAnalytics();
    expect(result.totalAttempts).toBe(0);
    expect(result.averagePercentage).toBe(0);
    expect(result.completionRate).toBe(0);
    expect(result.topicPerformance).toEqual([]);
    expect(result.revisionPlans.total).toBe(0);
  });

  it("aggregates topic performance from topic_results", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) =>
        Promise.resolve(resolve({
          data: [
            {
              percentage: 80,
              total_questions: 10,
              score: 8,
              topic_results: [
                { topic: "Algebra", topic_id: "algebra", correct: 8, total: 10 },
              ],
              weak_topics: [],
              strong_topics: [],
              language_code: "en",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          error: null,
        }))
      )
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })))
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })));

    const result = await getAdminLearningAnalytics();
    expect(result.totalAttempts).toBe(1);
    expect(result.averagePercentage).toBe(80);
    expect(result.topicPerformance).toHaveLength(1);
    expect(result.topicPerformance[0]).toMatchObject({
      topicId: "algebra",
      label: "Algebra",
      correct: 8,
      total: 10,
      percentage: 80,
    });
  });

  it("aggregates topic performance from weak_topics and strong_topics when topic_results missing", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) =>
        Promise.resolve(resolve({
          data: [
            {
              percentage: 50,
              total_questions: 2,
              score: 1,
              topic_results: [],
              weak_topics: ["Geometry"],
              strong_topics: ["Algebra"],
              language_code: "en",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          error: null,
        }))
      )
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })))
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })));

    const result = await getAdminLearningAnalytics();
    expect(result.topicPerformance).toHaveLength(2);
    const algebra = result.topicPerformance.find((t) => t.topicId === "algebra");
    const geometry = result.topicPerformance.find((t) => t.topicId === "geometry");
    expect(algebra?.correct).toBe(1);
    expect(algebra?.total).toBe(1);
    expect(geometry?.correct).toBe(0);
    expect(geometry?.total).toBe(1);
  });

  it("merges multilingual topics by canonical ID", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) =>
        Promise.resolve(resolve({
          data: [
            {
              percentage: 80,
              total_questions: 10,
              score: 8,
              topic_results: [
                { topic: "Math", topic_id: "math", correct: 8, total: 10 },
                { topic: "Matemáticas", topic_id: "math", correct: 5, total: 5 },
              ],
              weak_topics: [],
              strong_topics: [],
              language_code: "en",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          error: null,
        }))
      )
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })))
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })));

    const result = await getAdminLearningAnalytics();
    const math = result.topicPerformance.find((t) => t.topicId === "math");
    expect(math).toBeDefined();
    expect(math?.correct).toBe(13);
    expect(math?.total).toBe(15);
  });

  it("counts language usage", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) =>
        Promise.resolve(resolve({
          data: [
            { percentage: 80, total_questions: 10, score: 8, topic_results: [], weak_topics: [], strong_topics: [], language_code: "en", created_at: "2024-01-01T00:00:00Z" },
            { percentage: 70, total_questions: 10, score: 7, topic_results: [], weak_topics: [], strong_topics: [], language_code: "hi", created_at: "2024-01-02T00:00:00Z" },
            { percentage: 60, total_questions: 10, score: 6, topic_results: [], weak_topics: [], strong_topics: [], language_code: "en", created_at: "2024-01-03T00:00:00Z" },
          ],
          error: null,
        }))
      )
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })))
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })));

    const result = await getAdminLearningAnalytics();
    expect(result.languageUsage).toEqual([
      { language: "en", count: 2 },
      { language: "hi", count: 1 },
    ]);
  });

  it("calculates revision plans total", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })))
      .mockImplementationOnce((resolve) =>
        Promise.resolve(resolve({
          data: [{ id: "plan-1" }, { id: "plan-2" }, { id: "plan-3" }],
          error: null,
        }))
      )
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })));

    const result = await getAdminLearningAnalytics();
    expect(result.revisionPlans.total).toBe(3);
  });

  it("handles database errors gracefully", async () => {
    mockChain.then.mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: null, error: { message: "DB error" } })));

    await expect(getAdminLearningAnalytics()).rejects.toThrow("Failed to fetch quiz attempts");
  });

  it("ignores malformed topic_results entries", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) =>
        Promise.resolve(resolve({
          data: [
            {
              percentage: 80,
              total_questions: 10,
              score: 8,
              topic_results: [
                { topic: "Valid", topic_id: "valid", correct: 5, total: 5 },
                null,
                { topic: "", topic_id: "empty", correct: 1, total: 1 },
                { not_a_topic: true },
                { topic: "Also Valid", topic_id: "also-valid", correct: 3, total: 5 },
              ],
              weak_topics: [],
              strong_topics: [],
              language_code: "en",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          error: null,
        }))
      )
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })))
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })));

    const result = await getAdminLearningAnalytics();
    expect(result.topicPerformance).toHaveLength(2);
  });

  it("clamps percentage 0-100", async () => {
    mockChain.then
      .mockImplementationOnce((resolve) =>
        Promise.resolve(resolve({
          data: [
            {
              percentage: 150,
              total_questions: 10,
              score: 15,
              topic_results: [{ topic: "Test", topic_id: "test", correct: 15, total: 10 }],
              weak_topics: [],
              strong_topics: [],
              language_code: "en",
              created_at: "2024-01-01T00:00:00Z",
            },
          ],
          error: null,
        }))
      )
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })))
      .mockImplementationOnce((resolve) => Promise.resolve(resolve({ data: [], error: null })));

    const result = await getAdminLearningAnalytics();
    expect(result.topicPerformance[0].percentage).toBeLessThanOrEqual(100);
  });
});