import { describe, expect, it, vi } from "vitest";
import { consumeAskResponse } from "../aiStream";

describe("ask stream client", () => {
  it("renders deltas and returns only the completed saved answer", async () => {
    const onDelta = vi.fn();
    const payloads = [
      { type: "delta", text: "First " },
      { type: "delta", text: "answer." },
      { type: "final", chat: { id: "saved-1", question: "q", answer: { short_answer: "First answer." }, created_at: "now" }, mode: "keyword-context" },
    ];
    const response = new Response(payloads.map((value) => JSON.stringify(value)).join("\n"), {
      headers: { "content-type": "application/x-ndjson" },
    });
    const result = await consumeAskResponse(response, { onDelta });
    expect(onDelta.mock.calls.flat()).toEqual(["First ", "answer."]);
    expect(result).toMatchObject({ type: "final", chat: { id: "saved-1" } });
  });

  it("does not accept an interrupted stream without a final event", async () => {
    const response = new Response(`${JSON.stringify({ type: "delta", text: "partial" })}\n`, {
      headers: { "content-type": "application/x-ndjson" },
    });
    await expect(consumeAskResponse(response)).rejects.toThrow("before a complete answer was saved");
  });
});
