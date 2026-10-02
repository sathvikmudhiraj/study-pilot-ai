export type AskStreamEvent =
  | { type: "start"; requestId: string; language: string }
  | { type: "provider"; provider: "gemini" | "nvidia"; model: string; fallback: boolean }
  | { type: "delta"; text: string; provider: "gemini" | "nvidia" }
  | { type: "reset"; reason: string }
  | { type: "final"; chat: { id: string; question: string; answer: unknown; created_at: string }; mode: string; providerMeta?: Record<string, unknown> }
  | { type: "error"; error: string };

type StreamCallbacks = {
  onEvent?: (event: AskStreamEvent) => void;
  onDelta?: (text: string) => void;
  onReset?: () => void;
};

export async function consumeAskResponse(response: Response, callbacks: StreamCallbacks = {}) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-ndjson")) {
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || "AI request failed.");
    return data;
  }
  if (!response.ok || !response.body) throw new Error("AI stream could not be started.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalValue: Record<string, unknown> | null = null;

  const accept = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AskStreamEvent;
    callbacks.onEvent?.(event);
    if (event.type === "delta") callbacks.onDelta?.(event.text);
    if (event.type === "reset") callbacks.onReset?.();
    if (event.type === "error") throw new Error(event.error || "AI streaming failed.");
    if (event.type === "final") finalValue = event as unknown as Record<string, unknown>;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : lines.pop() ?? "";
      for (const line of lines) accept(line);
      if (done) break;
    }
    if (buffer.trim()) accept(buffer);
  } finally {
    reader.releaseLock();
  }

  if (!finalValue) throw new Error("AI stream ended before a complete answer was saved.");
  return finalValue;
}
