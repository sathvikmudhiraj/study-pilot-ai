import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { streamAIText } from "../aiStreaming";

function sse(lines: string[]) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const line of lines) controller.enqueue(new TextEncoder().encode(`data: ${line}\n\n`));
      controller.close();
    },
  }), { status: 200 });
}

describe("conversational provider streaming", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.AI_PROVIDER = "auto";
    process.env.GEMINI_API_KEY = "test-gemini";
    process.env.NVIDIA_API_KEY = "test-nvidia";
  });

  it("emits a real provider chunk before the stream completes", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"First sentence. "}]}}]}\n\n'));
        await gate;
        controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Second sentence."}]}}]}\n\n'));
        controller.close();
      },
    }), { status: 200 })));

    const iterator = streamAIText("Explain transactions.");
    expect((await iterator.next()).value).toMatchObject({ type: "provider", provider: "gemini" });
    expect((await iterator.next()).value).toEqual({ type: "delta", text: "First sentence. ", provider: "gemini" });
    finish();
    expect((await iterator.next()).value).toEqual({ type: "delta", text: "Second sentence.", provider: "gemini" });
    expect((await iterator.next()).value).toMatchObject({ type: "complete" });
  });

  it("falls back to NVIDIA without reset when Gemini emitted no content", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(sse(['{"choices":[{"delta":{"content":"Fallback answer."}}]}', "[DONE]"])));
    const events = [];
    for await (const event of streamAIText("Explain transactions.")) events.push(event);
    expect(events.some((event) => event.type === "reset")).toBe(false);
    expect(events).toContainEqual({ type: "delta", text: "Fallback answer.", provider: "nvidia" });
  });

  it("resets partial Gemini output before NVIDIA replaces it", async () => {
    let sentPartial = false;
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(new ReadableStream({
        pull(controller) {
          if (!sentPartial) {
            sentPartial = true;
            controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Partial."}]}}]}\n\n'));
            return;
          }
          controller.error(new Error("stream failed"));
        },
      }), { status: 200 }))
      .mockResolvedValueOnce(sse(['{"choices":[{"delta":{"content":"Clean replacement."}}]}', "[DONE]"])));
    const events = [];
    for await (const event of streamAIText("Explain transactions.")) events.push(event);
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining(["delta", "reset", "complete"]));
    expect(events).toContainEqual({ type: "reset", reason: "provider_fallback" });
  });

  it("propagates cancellation and never starts fallback", async () => {
    const calls = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", calls);
    const controller = new AbortController();
    const iterator = streamAIText("Explain transactions.", { signal: controller.signal });
    await iterator.next();
    const pending = iterator.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
