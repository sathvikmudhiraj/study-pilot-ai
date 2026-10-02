export type GeneratedImageResult = {
  id: string;
  title: string;
  prompt: string;
  explanation: string;
  provider: "nvidia";
  model: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  url: string;
  created_at: string;
};

export type GenerateImageRequest = {
  prompt: string;
  topic?: string;
  conversationId?: string;
  fileId?: string;
  language?: string;
};

const MAX_RESPONSE_BYTES = 100_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";
}

export function normalizeGeneratedImage(value: unknown): GeneratedImageResult | null {
  const root = record(value);
  const source = record(root?.image) ?? root;
  if (!source) return null;

  const id = text(source.id, 128);
  const title = text(source.title, 200);
  const prompt = text(source.prompt, 2_000);
  const explanation = text(source.explanation, 2_000);
  const provider = source.provider;
  const model = text(source.model, 200);
  const mimeType = source.mime_type;
  const url = text(source.url, 500);
  const createdAt = text(source.created_at, 80);
  const width = Number(source.width);
  const height = Number(source.height);

  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !title || !prompt || !explanation || provider !== "nvidia" || !model ||
    !["image/jpeg", "image/png", "image/webp"].includes(String(mimeType)) ||
    !url.startsWith(`/api/generated-images/${encodeURIComponent(id)}/content`) ||
    !Number.isInteger(width) || width < 256 || width > 4096 ||
    !Number.isInteger(height) || height < 256 || height > 4096 ||
    Number.isNaN(Date.parse(createdAt))
  ) return null;

  return {
    id,
    title,
    prompt,
    explanation,
    provider,
    model,
    mime_type: mimeType as GeneratedImageResult["mime_type"],
    width,
    height,
    url,
    created_at: new Date(createdAt).toISOString(),
  };
}

function cleanError(payload: unknown, status: number): string {
  const message = text(record(payload)?.error, 300);
  if (message) return message;
  if (status === 401) return "Please sign in again to generate an image.";
  if (status === 429) return "Image generation limit reached. Please try again later.";
  if (status === 504) return "Image generation timed out. Please retry.";
  return "Image generation failed. Please try again.";
}

export async function runImageGeneration(
  request: GenerateImageRequest,
  options: { signal?: AbortSignal } = {},
): Promise<{ image: GeneratedImageResult; messageId: string | null }> {
  const response = await fetch("/api/ai/image", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: options.signal,
  });
  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES) throw new Error("Image generation returned an invalid response.");

  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(response.ok ? "Image generation returned an unreadable response." : "Image generation failed. Please try again.");
  }
  if (!response.ok) throw new Error(cleanError(payload, response.status));

  const image = normalizeGeneratedImage(payload);
  if (!image) throw new Error("Image generation returned invalid image metadata.");
  const messageId = text(record(payload)?.messageId, 128) || null;
  return { image, messageId };
}
