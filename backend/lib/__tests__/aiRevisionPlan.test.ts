import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudyContext } from "../aiRevisionPlan";

vi.mock("server-only", () => ({}));

const aiMocks = vi.hoisted(() => ({
  generateAITextWithMetadata: vi.fn(),
  generateRevisionAITextWithMetadata: vi.fn(),
  getAIProviderRuntimeInfo: vi.fn(),
}));

vi.mock("../aiProvider", () => ({
  generateAITextWithMetadata: aiMocks.generateAITextWithMetadata,
  generateRevisionAITextWithMetadata: aiMocks.generateRevisionAITextWithMetadata,
  getAIProviderRuntimeInfo: aiMocks.getAIProviderRuntimeInfo,
}));

function setupRepairMocks(repairTitle = "Operating Systems Revision Plan") {
  // Repair path uses generateAITextWithMetadata (default profile)
  aiMocks.generateAITextWithMetadata.mockResolvedValue(providerResult(planJson({ title: repairTitle })));
}

import { generateRevisionPlan } from "../aiRevisionPlan";

const context: StudyContext = {
  files: [
    {
      file_name: "Operating Systems.txt",
      content_type: "text/plain",
      extracted_text: "Processes, scheduling, memory management, and deadlocks are important operating systems topics.",
    },
  ],
  notes: [],
  summaries: [],
  quizzes: [],
  quiz_analytics: {
    attempt_count: 0,
    strong_topics: [],
    weak_topics: [],
    last_quiz_score: null,
  },
};

function planObject() {
  return {
    title: "Operating Systems Revision Plan",
    important_topics: ["Processes", "Scheduling", "Memory management", "Deadlocks"],
    revise_first: ["Processes", "Scheduling"],
    pending_topics: ["Memory management", "Deadlocks"],
    daily_plan: Array.from({ length: 7 }, (_, index) => ({
      day: index + 1,
      date: `2026-09-${String(23 + index).padStart(2, "0")}`,
      focus_topics: ["Processes", "Scheduling"],
      tasks: ["Revise notes", "Write a short explanation", "Practice one question"],
      estimated_time: "1 hour",
    })),
    starts_on: "2026-09-23",
    ends_on: "2026-09-29",
    plan: {
      total_days: 7,
      next_steps: ["Take a quiz"],
      study_tips: ["Use active recall"],
    },
  };
}

function planJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ ...planObject(), ...overrides });
}

function providerResult(text: string, provider: "gemini" | "nvidia" = "gemini") {
  return {
    text,
    provider,
    model: provider === "gemini" ? "gemini-2.5-flash" : "nvidia/nemotron",
    fallbackUsed: provider === "nvidia",
    responseMode: "ai",
    totalLatencyMs: 100,
    offlineFallbackUsed: false,
    geminiSkippedDueToCooldown: false,
  };
}

describe("generateRevisionPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiMocks.getAIProviderRuntimeInfo.mockReturnValue({
      profile: "revision",
      configuredProvider: "auto",
      primaryProvider: "gemini",
      primaryModel: "gemini-2.5-flash",
      fallbackProvider: "nvidia",
      fallbackModel: "meta/llama-3.2-11b-vision-instruct",
      timeoutMs: 25_000,
      fastFallbackTimeoutMs: 25_000,
    });
    aiMocks.generateRevisionAITextWithMetadata.mockResolvedValue(providerResult(planJson()));
  });

  it("passes the revision runtime timeout so revision generation cannot fall into the long NVIDIA default", async () => {
    await generateRevisionPlan(context, "en");

    expect(aiMocks.generateRevisionAITextWithMetadata).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        responseMimeType: "application/json",
        timeoutMs: 25_000,
      }),
    );
  });

  it("parses valid JSON", async () => {
    aiMocks.generateRevisionAITextWithMetadata.mockResolvedValueOnce(providerResult(planJson()));

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.title).toBe("Operating Systems Revision Plan");
    expect(plan.daily_plan).toHaveLength(7);
  });

  it("parses JSON inside markdown fences", async () => {
    aiMocks.generateRevisionAITextWithMetadata.mockResolvedValueOnce(providerResult(`\`\`\`json\n${planJson()}\n\`\`\``));

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.important_topics).toContain("Processes");
  });

  it("extracts JSON surrounded by prose", async () => {
    aiMocks.generateRevisionAITextWithMetadata.mockResolvedValueOnce(providerResult(`Here is the plan:\n\n${planJson()}\n\nHope this helps.`));

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.revise_first).toEqual(["Processes", "Scheduling"]);
  });

  it("normalizes camelCase and known field variants", async () => {
    aiMocks.generateRevisionAITextWithMetadata.mockResolvedValueOnce(providerResult(JSON.stringify({
      planTitle: "Camel Plan",
      importantTopics: ["Processes"],
      priorityTopics: ["Scheduling"],
      remainingTopics: ["Deadlocks"],
      dailyPlan: [
        {
          dayNumber: 1,
          date: "2026-09-23",
          focusTopics: ["Processes"],
          studyTasks: ["Review process states"],
          duration: "45 minutes",
        },
      ],
      startsOn: "2026-09-23",
      endsOn: "2026-09-23",
      planMeta: {
        totalDays: 1,
        nextSteps: ["Take a quiz"],
        studyTips: ["Use active recall"],
      },
    })));

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.title).toBe("Camel Plan");
    expect(plan.daily_plan[0]?.focus_topics).toEqual(["Processes"]);
    expect(plan.plan.total_days).toBe(1);
  });

  it("repairs invalid JSON successfully exactly once", async () => {
    aiMocks.generateRevisionAITextWithMetadata
      .mockResolvedValueOnce(providerResult(`{"title":"Broken", "important_topics":["Processes"],`));
    setupRepairMocks("Repaired Plan");

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.title).toBe("Repaired Plan");
    expect(aiMocks.generateRevisionAITextWithMetadata).toHaveBeenCalledTimes(1);
    expect(aiMocks.generateAITextWithMetadata).toHaveBeenCalledTimes(1);
  });

  it("repairs schema variants when required fields are missing from the first normalized shape", async () => {
    aiMocks.generateRevisionAITextWithMetadata
      .mockResolvedValueOnce(providerResult(JSON.stringify({ title: "Incomplete", important_topics: ["Processes"] })));
    setupRepairMocks("Schema Repaired Plan");

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.title).toBe("Schema Repaired Plan");
    expect(aiMocks.generateRevisionAITextWithMetadata).toHaveBeenCalledTimes(1);
    expect(aiMocks.generateAITextWithMetadata).toHaveBeenCalledTimes(1);
  });

  it("fails cleanly when required fields are still missing after repair", async () => {
    aiMocks.generateRevisionAITextWithMetadata
      .mockResolvedValueOnce(providerResult(JSON.stringify({ title: "Incomplete" })));
    aiMocks.generateAITextWithMetadata
      .mockResolvedValueOnce(providerResult(JSON.stringify({ title: "Still Incomplete" })));

    await expect(generateRevisionPlan(context, "en")).rejects.toThrow("AI returned a plan format StudyPilot could not read");
    expect(aiMocks.generateRevisionAITextWithMetadata).toHaveBeenCalledTimes(1);
    expect(aiMocks.generateAITextWithMetadata).toHaveBeenCalledTimes(1);
  });

  it("supports Gemini-shaped telemetry responses", async () => {
    aiMocks.generateRevisionAITextWithMetadata.mockImplementationOnce(async (_prompt: string, options: { telemetry?: (event: unknown) => void }) => {
      options.telemetry?.({ event: "final_provider", provider: "gemini", model: "gemini-2.5-flash" });
      return providerResult(planJson({ title: "Gemini Plan" }), "gemini");
    });

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.title).toBe("Gemini Plan");
  });

  it("supports NVIDIA-shaped telemetry responses", async () => {
    aiMocks.generateRevisionAITextWithMetadata.mockImplementationOnce(async (_prompt: string, options: { telemetry?: (event: unknown) => void }) => {
      options.telemetry?.({ event: "final_provider", provider: "nvidia", model: "nvidia/nemotron" });
      return providerResult(planJson({ title: "NVIDIA Plan" }), "nvidia");
    });

    const plan = await generateRevisionPlan(context, "en");

    expect(plan.title).toBe("NVIDIA Plan");
  });

  it("classifies empty offline fallback as provider unavailable without repair", async () => {
    aiMocks.generateRevisionAITextWithMetadata.mockResolvedValueOnce({
      ...providerResult("", "nvidia"),
      responseMode: "offline_fallback",
      providerFailureCategory: "timeout",
      offlineFallbackUsed: true,
    });

    await expect(generateRevisionPlan(context, "en")).rejects.toThrow("timed out");
    expect(aiMocks.generateRevisionAITextWithMetadata).toHaveBeenCalledTimes(1);
  });
});
