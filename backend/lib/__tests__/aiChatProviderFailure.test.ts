import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  generateAITextWithMetadata: vi.fn(),
}));

vi.mock("../aiProvider", () => ({
  generateAITextWithMetadata: providerMocks.generateAITextWithMetadata,
}));

import { answerLearnStepByStep, answerStudyQuestion } from "../aiChat";

describe("chat provider failures", () => {
  beforeEach(() => providerMocks.generateAITextWithMetadata.mockReset());

  it("reports a provider timeout before attempting to parse an empty answer", async () => {
    providerMocks.generateAITextWithMetadata.mockResolvedValue({
      text: "",
      provider: "nvidia",
      model: "test-model",
      fallbackUsed: true,
      responseMode: "offline_fallback",
      providerFailureCategory: "timeout",
      totalLatencyMs: 30000,
      offlineFallbackUsed: true,
      geminiSkippedDueToCooldown: false,
    });

    await expect(answerStudyQuestion({ question: "Give important notes", context: "Module 3 notes", grounded: true }))
      .rejects.toThrow("Chat answer timed out. Please retry.");
    await expect(answerLearnStepByStep({ question: "Next Step", context: "Module 3 notes" }))
      .rejects.toThrow("Chat answer timed out. Please retry.");
  });

  it("keeps the format error for completed, non-empty malformed answers", async () => {
    providerMocks.generateAITextWithMetadata.mockResolvedValue({
      text: "not valid JSON",
      provider: "nvidia",
      model: "test-model",
      fallbackUsed: false,
      responseMode: "ai",
      totalLatencyMs: 100,
      offlineFallbackUsed: false,
      geminiSkippedDueToCooldown: false,
    });

    await expect(answerStudyQuestion({ question: "Give important notes", context: "Module 3 notes", grounded: true }))
      .rejects.toThrow("AI returned an answer format StudyPilot could not read.");
  });
});
