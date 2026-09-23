import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  generateAITextWithMetadata: vi.fn(),
  getLastMeaningfulUserQuestion: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/backend/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/backend/lib/aiProvider", () => ({ generateAITextWithMetadata: mocks.generateAITextWithMetadata }));
vi.mock("../route", async () => {
  const actual = await vi.importActual("../route");
  return {
    ...actual,
    getLastMeaningfulUserQuestion: mocks.getLastMeaningfulUserQuestion,
  };
});

import { isContinuationIntent, classifyIntent, buildFollowUpQuestion, isContextTransformFollowUp, requestedFollowUpCount } from "../route";

describe("Follow-up intent resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1", preferredLanguage: "en" });
  });

  describe("isContinuationIntent", () => {
    it("detects 'next' as continuation", () => {
      expect(isContinuationIntent("next")).toBe(true);
      expect(isContinuationIntent("next ")).toBe(true);
      expect(isContinuationIntent("next questions")).toBe(true);
    });

    it("detects 'continue' as continuation", () => {
      expect(isContinuationIntent("continue")).toBe(true);
      expect(isContinuationIntent("continue this")).toBe(true);
    });

    it("detects 'more' as continuation", () => {
      expect(isContinuationIntent("more")).toBe(true);
      expect(isContinuationIntent("more questions")).toBe(true);
      expect(isContinuationIntent("give me more")).toBe(true);
    });

    it("detects 'next one' and 'next batch' as continuation", () => {
      expect(isContinuationIntent("next one")).toBe(true);
      expect(isContinuationIntent("next batch")).toBe(true);
      expect(isContinuationIntent("another")).toBe(true);
      expect(isContinuationIntent("keep going")).toBe(true);
      expect(isContinuationIntent("proceed")).toBe(true);
    });

    it("detects count-aware continuations", () => {
      expect(isContinuationIntent("next 5")).toBe(true);
      expect(isContinuationIntent("next 10")).toBe(true);
      expect(isContinuationIntent("give me 5 more")).toBe(true);
      expect(isContinuationIntent("another 5")).toBe(true);
      expect(isContinuationIntent("5 more")).toBe(true);
    });

    it("does not detect unrelated phrases", () => {
      expect(isContinuationIntent("what is next")).toBe(false);
      expect(isContinuationIntent("next topic")).toBe(false);
      expect(isContinuationIntent("explain next")).toBe(false);
      expect(isContinuationIntent("hello")).toBe(false);
    });
  });

  describe("context transform follow-ups", () => {
    it("detects supported transform phrases", () => {
      expect(isContextTransformFollowUp("summarize it")).toBe(true);
      expect(isContextTransformFollowUp("summarise it")).toBe(true);
      expect(isContextTransformFollowUp("summary")).toBe(true);
      expect(isContextTransformFollowUp("give me summary")).toBe(true);
      expect(isContextTransformFollowUp("explain it")).toBe(true);
      expect(isContextTransformFollowUp("explain this")).toBe(true);
      expect(isContextTransformFollowUp("teach me this")).toBe(true);
      expect(isContextTransformFollowUp("do it")).toBe(true);
    });

    it("does not treat full questions as transform-only follow-ups", () => {
      expect(isContextTransformFollowUp("summarize SLR parsing")).toBe(false);
      expect(isContextTransformFollowUp("explain relational algebra")).toBe(false);
    });
  });

  describe("requestedFollowUpCount", () => {
    it("parses requested follow-up counts", () => {
      expect(requestedFollowUpCount("next 5")).toBe(5);
      expect(requestedFollowUpCount("next 10")).toBe(10);
      expect(requestedFollowUpCount("give me 5 more")).toBe(5);
      expect(requestedFollowUpCount("another 5")).toBe(5);
      expect(requestedFollowUpCount("5 more")).toBe(5);
    });

    it("rejects unsupported counts", () => {
      expect(requestedFollowUpCount("next 0")).toBeNull();
      expect(requestedFollowUpCount("next 25")).toBeNull();
      expect(requestedFollowUpCount("give me many more")).toBeNull();
    });
  });

  describe("classifyIntent", () => {
    it("classifies exam question requests", () => {
      expect(classifyIntent("Generate exam questions")).toBe("exam_questions");
      expect(classifyIntent("Give me test questions")).toBe("exam_questions");
      expect(classifyIntent("Practice questions for this topic")).toBe("exam_questions");
      expect(classifyIntent("Generate 5 questions")).toBe("exam_questions");
    });

    it("classifies viva question requests", () => {
      expect(classifyIntent("Give viva questions")).toBe("viva_questions");
      expect(classifyIntent("Oral exam questions")).toBe("viva_questions");
      expect(classifyIntent("Viva voce questions")).toBe("viva_questions");
    });

    it("classifies learn step requests", () => {
      expect(classifyIntent("Learn step by step")).toBe("learn_step");
      expect(classifyIntent("Teach me this topic")).toBe("learn_step");
    });

    it("classifies quiz requests", () => {
      expect(classifyIntent("Quiz me")).toBe("quiz");
      expect(classifyIntent("Test me on this")).toBe("quiz");
      expect(classifyIntent("Ask me questions")).toBe("quiz");
    });

    it("classifies summarize requests", () => {
      expect(classifyIntent("Summarize this")).toBe("summarize");
      expect(classifyIntent("Give me a summary")).toBe("summarize");
    });

    it("classifies explain requests", () => {
      expect(classifyIntent("Explain SLR parsing")).toBe("explain");
      expect(classifyIntent("What is relational algebra")).toBe("explain");
      expect(classifyIntent("How does this work")).toBe("explain");
    });

    it("defaults to general_qa", () => {
      expect(classifyIntent("Random question")).toBe("general_qa");
    });
  });

  describe("buildFollowUpQuestion", () => {
    it("builds exam question continuation", () => {
      const result = buildFollowUpQuestion("Generate exam questions", "exam_questions", true);
      expect(result).toContain("Generate exam questions");
      expect(result).toContain("more exam questions");
      expect(result).toContain("avoid repeating");
    });

    it("builds count-aware exam question continuation", () => {
      const result = buildFollowUpQuestion("Generate 5 exam questions", "exam_questions", true, {
        requestedCount: 5,
        previousQuestions: ["What is SLR parsing?"],
      });
      expect(result).toContain("exactly 5 additional exam questions");
      expect(result).toContain("What is SLR parsing?");
    });

    it("builds viva question continuation", () => {
      const result = buildFollowUpQuestion("Give viva questions", "viva_questions", true);
      expect(result).toContain("Give viva questions");
      expect(result).toContain("more viva questions");
      expect(result).toContain("different from the previous batch");
    });

    it("builds learn step continuation", () => {
      const result = buildFollowUpQuestion("Teach me step by step", "learn_step", true);
      expect(result).toContain("Continue the previous step-by-step lesson");
      expect(result).toContain("Give the next step only");
    });

    it("builds quiz continuation", () => {
      const result = buildFollowUpQuestion("Quiz me", "quiz", true);
      expect(result).toContain("Quiz me");
      expect(result).toContain("more quiz questions");
    });

    it("builds explain continuation", () => {
      const result = buildFollowUpQuestion("Explain SLR parsing", "explain", true);
      expect(result).toContain("Explain SLR parsing");
      expect(result).toContain("continue explaining");
    });

    it("builds summarize transform from previous topic", () => {
      const result = buildFollowUpQuestion("Explain SLR parsing", "summarize", true, { transform: "summarize" });
      expect(result).toBe("Summarize the previous SLR parsing topic/answer using the same selected study material and citations.");
    });

    it("builds summarize continuation", () => {
      const result = buildFollowUpQuestion("Summarize this", "summarize", true);
      expect(result).toContain("Summarize this");
      expect(result).toContain("continue the summary");
    });

    it("handles non-continuation (first request)", () => {
      const result = buildFollowUpQuestion("Generate exam questions", "exam_questions", false);
      expect(result).toBe("Generate exam questions");
    });
  });

  // Integration tests are skipped due to complex mock setup
  // describe("API endpoint integration", () => {
  //   it("resolves 'next' to previous exam question intent", async () => {
  //     ...
  //   });
  // });
});
