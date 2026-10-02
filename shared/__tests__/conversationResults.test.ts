import { describe, expect, it } from "vitest";
import { createConversationResult, readConversationResult, withConversationResult } from "../conversationResults";

describe("conversation result compatibility", () => {
  it("round-trips the versioned universal envelope", () => {
    const answer = withConversationResult(
      { short_answer: "A concise result" },
      createConversationResult("diagram", { title: "OSI" }, { artifact_id: "diagram-1", status: "completed" }),
    );
    expect(readConversationResult(answer)).toEqual({
      version: 1,
      kind: "diagram",
      payload: { title: "OSI" },
      artifact_id: "diagram-1",
      status: "completed",
    });
  });

  it("continues to read legacy Voice turns", () => {
    expect(readConversationResult({ voice_turn: { kind: "web_search", payload: { query: "cloud" } } })).toEqual({
      version: 1,
      kind: "web_search",
      payload: { query: "cloud" },
    });
  });

  it("rejects unknown tool kinds", () => {
    expect(readConversationResult({ conversation_result: { version: 1, kind: "unsafe_tool" } })).toBeNull();
  });
});
