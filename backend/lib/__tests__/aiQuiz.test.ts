import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const provider = vi.hoisted(() => ({ generateQuizAITextWithMetadata: vi.fn() }));
vi.mock("../aiProvider", () => ({ generateQuizAITextWithMetadata: provider.generateQuizAITextWithMetadata }));
vi.mock("../observability", () => ({ logStructuredOutputDiagnostic: vi.fn() }));

import { generateQuiz } from "../aiQuiz";

const source = `Routing is the process of selecting paths between networks.
Router is a device that forwards packets between networks.
Subnetting is the process of dividing a network into smaller subnetworks.
Default gateway is the router used to reach another network.`;

function providerResult(text: string) {
  return {
    text,
    provider: "nvidia" as const,
    model: "nvidia/nemotron-3-super-120b-a12b",
    fallbackUsed: true,
    fallbackProvider: "nvidia" as const,
    responseMode: "ai" as const,
    totalLatencyMs: 20,
    offlineFallbackUsed: false,
    geminiSkippedDueToCooldown: false,
  };
}

describe("generateQuiz", () => {
  beforeEach(() => vi.clearAllMocks());

  it("works directly from extracted text without a summary and accepts fenced JSON", async () => {
    provider.generateQuizAITextWithMetadata.mockResolvedValue(providerResult(`Here is the quiz:\n\`\`\`json
{"title":"Networking Quiz","source_summary":"Routing and subnetting","difficulty":"medium","questions":[{"id":"q1","type":"short","topic_id":"routing","topic_en":"Routing","topic":"Routing","question":"What is routing?","acceptable_answers":["Selecting paths between networks"],"explanation":"Routing selects paths between networks."}]}
\`\`\``));

    const quiz = await generateQuiz(source, { count: 1, questionTypes: ["short"] });

    expect(quiz.questions).toHaveLength(1);
    expect(quiz.questions[0]?.topic).toBe("Routing");
    expect(provider.generateQuizAITextWithMetadata).toHaveBeenCalledWith(
      expect.stringContaining("Routing is the process"),
      expect.objectContaining({ timeoutMs: 30_000, primaryTimeoutMs: 18_000, fallbackTimeoutMs: 12_000 }),
    );
  });
});
