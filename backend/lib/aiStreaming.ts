import "server-only";

import { getAIProviderRuntimeInfo } from "./aiProvider";

export type StreamingProvider = "gemini" | "nvidia";

export type AITextStreamEvent =
  | { type: "provider"; provider: StreamingProvider; model: string; fallback: boolean }
  | { type: "delta"; text: string; provider: StreamingProvider }
  | { type: "reset"; reason: "provider_fallback" }
  | { type: "complete"; metadata: AITextStreamMetadata };

export type AITextStreamMetadata = {
  provider: StreamingProvider;
  model: string;
  fallbackUsed: boolean;
  geminiLatencyMs: number | null;
  nvidiaLatencyMs: number | null;
  timeToFirstTokenMs: number | null;
  totalLatencyMs: number;
};

type StreamOptions = {
  signal?: AbortSignal;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  primaryTimeoutMs?: number;
  fallbackTimeoutMs?: number;
};

class StreamProviderError extends Error {
  constructor(message: string, readonly provider: StreamingProvider, readonly category: string, readonly status?: number) {
    super(message);
    this.name = "StreamProviderError";
  }
}

function linkedTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function classifyStatus(status: number) {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status === 503) return "busy";
  return "request";
}

async function* parseSse(response: Response, extract: (payload: unknown) => string): AsyncGenerator<string> {
  if (!response.body) throw new Error("Provider returned no response stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const text = extract(JSON.parse(data));
          if (text) yield text;
        } catch {
          // A malformed provider event is ignored; subsequent events remain usable.
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

async function* streamGemini(prompt: string, model: string, options: StreamOptions): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new StreamProviderError("Gemini is not configured.", "gemini", "config");
  const timeout = linkedTimeout(options.signal, options.timeoutMs ?? 6_000);
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: options.temperature ?? 0.25,
            maxOutputTokens: options.maxOutputTokens ?? 900,
            responseMimeType: "text/plain",
          },
        }),
        signal: timeout.signal,
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new StreamProviderError(detail || "Gemini stream failed.", "gemini", classifyStatus(response.status), response.status);
    }
    yield* parseSse(response, (payload) => {
      const record = payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      return record.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (options.signal?.aborted) throw error;
      throw new StreamProviderError("Gemini streaming timed out.", "gemini", timeout.timedOut() ? "timeout" : "request");
    }
    throw error;
  } finally {
    timeout.dispose();
  }
}

async function* streamNvidia(prompt: string, model: string, options: StreamOptions): AsyncGenerator<string> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new StreamProviderError("NVIDIA is not configured.", "nvidia", "config");
  const timeout = linkedTimeout(options.signal, options.timeoutMs ?? 9_000);
  try {
    const baseUrl = (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature ?? 0.25,
        max_tokens: options.maxOutputTokens ?? 900,
        stream: true,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: timeout.signal,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new StreamProviderError(detail || "NVIDIA stream failed.", "nvidia", classifyStatus(response.status), response.status);
    }
    yield* parseSse(response, (payload) => {
      const record = payload as { choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }> };
      const content = record.choices?.[0]?.delta?.content;
      if (typeof content === "string") return content;
      return Array.isArray(content) ? content.map((part) => part.text ?? "").join("") : "";
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      if (options.signal?.aborted) throw error;
      throw new StreamProviderError("NVIDIA streaming timed out.", "nvidia", timeout.timedOut() ? "timeout" : "request");
    }
    throw error;
  } finally {
    timeout.dispose();
  }
}

export async function* streamAIText(prompt: string, options: StreamOptions = {}): AsyncGenerator<AITextStreamEvent> {
  const startedAt = Date.now();
  const runtime = getAIProviderRuntimeInfo("default");
  const totalBudgetMs = options.timeoutMs ?? runtime.timeoutMs;
  const providers: Array<{ provider: StreamingProvider; model: string; timeoutMs: number }> = [];
  if (runtime.configuredProvider !== "nvidia") {
    providers.push({ provider: "gemini", model: process.env.GEMINI_MODEL || "gemini-2.5-flash", timeoutMs: options.primaryTimeoutMs ?? runtime.fastFallbackTimeoutMs });
  }
  if (runtime.configuredProvider !== "gemini") {
    providers.push({ provider: "nvidia", model: runtime.fallbackModel || runtime.primaryModel, timeoutMs: options.fallbackTimeoutMs ?? Math.max(3_000, totalBudgetMs - (options.primaryTimeoutMs ?? runtime.fastFallbackTimeoutMs)) });
  }

  let emittedText = false;
  let fallbackUsed = false;
  let firstTokenAt: number | null = null;
  let geminiLatencyMs: number | null = null;
  let nvidiaLatencyMs: number | null = null;
  let lastError: unknown;

  for (let index = 0; index < providers.length; index += 1) {
    const current = providers[index];
    const elapsed = Date.now() - startedAt;
    const remaining = totalBudgetMs - elapsed;
    if (remaining < 1_000) break;
    const providerStartedAt = Date.now();
    yield { type: "provider", provider: current.provider, model: current.model, fallback: index > 0 };
    try {
      const iterator = current.provider === "gemini"
        ? streamGemini(prompt, current.model, { ...options, timeoutMs: Math.min(current.timeoutMs, remaining) })
        : streamNvidia(prompt, current.model, { ...options, timeoutMs: Math.min(current.timeoutMs, remaining) });
      let providerText = false;
      for await (const text of iterator) {
        providerText = true;
        emittedText = true;
        firstTokenAt ??= Date.now();
        yield { type: "delta", text, provider: current.provider };
      }
      if (!providerText) throw new StreamProviderError(`${current.provider} returned an empty stream.`, current.provider, "empty");
      const latency = Date.now() - providerStartedAt;
      if (current.provider === "gemini") geminiLatencyMs = latency;
      else nvidiaLatencyMs = latency;
      yield {
        type: "complete",
        metadata: {
          provider: current.provider,
          model: current.model,
          fallbackUsed,
          geminiLatencyMs,
          nvidiaLatencyMs,
          timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
          totalLatencyMs: Date.now() - startedAt,
        },
      };
      return;
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
      lastError = error;
      const latency = Date.now() - providerStartedAt;
      if (current.provider === "gemini") geminiLatencyMs = latency;
      else nvidiaLatencyMs = latency;
      if (index < providers.length - 1) {
        fallbackUsed = true;
        if (emittedText) {
          emittedText = false;
          firstTokenAt = null;
          yield { type: "reset", reason: "provider_fallback" };
        }
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI streaming providers were unavailable.");
}
