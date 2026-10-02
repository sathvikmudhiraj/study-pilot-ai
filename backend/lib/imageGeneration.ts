import "server-only";

const DEFAULT_ENDPOINT = "https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b";
const DEFAULT_MODEL = "black-forest-labs/flux.2-klein-4b";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

export class ImageGenerationError extends Error {
  constructor(
    message: string,
    readonly code: "validation" | "config" | "auth" | "quota" | "busy" | "timeout" | "provider" | "cancelled",
    readonly status: number,
  ) {
    super(message);
    this.name = "ImageGenerationError";
  }
}

export type GeneratedImageBytes = {
  bytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  provider: "nvidia";
  model: string;
  width: number;
  height: number;
};

function configuredTimeout() {
  const parsed = Number(process.env.NVIDIA_IMAGE_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 10_000 && parsed <= 300_000 ? parsed : DEFAULT_TIMEOUT_MS;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstBase64(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const root = value as Record<string, unknown>;
  const artifacts = Array.isArray(root.artifacts) ? root.artifacts : [];
  const data = Array.isArray(root.data) ? root.data : [];
  const images = Array.isArray(root.images) ? root.images : [];
  const output = Array.isArray(root.output) ? root.output : [];
  const candidates = [
    (artifacts[0] as Record<string, unknown> | undefined)?.base64,
    (artifacts[0] as Record<string, unknown> | undefined)?.b64_json,
    (data[0] as Record<string, unknown> | undefined)?.b64_json,
    (data[0] as Record<string, unknown> | undefined)?.base64,
    (images[0] as Record<string, unknown> | undefined)?.base64,
    typeof images[0] === "string" ? images[0] : "",
    typeof output[0] === "string" ? output[0] : "",
    root.image,
    root.base64,
  ];
  return candidates.map(stringValue).find(Boolean) ?? "";
}

export function decodeGeneratedImageResponse(value: unknown): Pick<GeneratedImageBytes, "bytes" | "mimeType" | "extension"> {
  let encoded = firstBase64(value);
  if (!encoded) throw new ImageGenerationError("NVIDIA returned no image data.", "provider", 502);
  const dataUri = encoded.match(/^data:(image\/(?:png|jpeg|webp));base64,([\s\S]+)$/);
  const declaredMime = dataUri?.[1];
  if (dataUri) encoded = dataUri[2];
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
    throw new ImageGenerationError("NVIDIA returned malformed image data.", "provider", 502);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageGenerationError("NVIDIA returned an invalid image size.", "provider", 502);
  }

  const png = bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length > 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!png && !jpeg && !webp) throw new ImageGenerationError("NVIDIA returned an unsupported image format.", "provider", 502);

  const mimeType = png ? "image/png" : webp ? "image/webp" : "image/jpeg";
  if (declaredMime && declaredMime !== mimeType) {
    throw new ImageGenerationError("NVIDIA returned inconsistent image metadata.", "provider", 502);
  }
  return { bytes, mimeType, extension: png ? "png" : webp ? "webp" : "jpg" };
}

function providerPayload(endpoint: string, prompt: string) {
  if (endpoint.includes("flux.2-klein")) {
    return { prompt, width: 1024, height: 1024, cfg_scale: 1, samples: 1, seed: 0, steps: 4 };
  }
  if (endpoint.includes("flux.")) {
    return { prompt, width: 1024, height: 1024, cfg_scale: 5, mode: "base", samples: 1, seed: 0, steps: 30 };
  }
  return {
    prompt,
    negative_prompt: "blurry, illegible text, watermark, logo, distorted anatomy, unsafe content",
    aspect_ratio: "1:1",
    cfg_scale: 5,
    mode: "text-to-image",
    model: "sd3",
    output_format: "jpeg",
    seed: 0,
    steps: 30,
  };
}

export async function generateNvidiaImage(prompt: string, signal?: AbortSignal): Promise<GeneratedImageBytes> {
  const apiKey = process.env.NVIDIA_IMAGE_API_KEY?.trim() || process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) throw new ImageGenerationError("NVIDIA image generation is not configured.", "config", 503);
  const endpoint = process.env.NVIDIA_IMAGE_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
  const model = process.env.NVIDIA_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), configuredTimeout());

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(providerPayload(endpoint, prompt)),
      signal: controller.signal,
      cache: "no-store",
    });
    const raw = await response.text();
    let payload: unknown = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new ImageGenerationError("NVIDIA image authentication failed.", "auth", 503);
      if (response.status === 402 || response.status === 429) throw new ImageGenerationError("NVIDIA image quota is temporarily unavailable.", "quota", 429);
      if (response.status >= 500) throw new ImageGenerationError("NVIDIA image service is busy.", "busy", 503);
      throw new ImageGenerationError("NVIDIA rejected the image request.", "provider", 502);
    }
    return { ...decodeGeneratedImageResponse(payload), provider: "nvidia", model, width: 1024, height: 1024 };
  } catch (error) {
    if (error instanceof ImageGenerationError) throw error;
    if (signal?.aborted) throw new ImageGenerationError("Image generation was cancelled.", "cancelled", 499);
    if (controller.signal.aborted) throw new ImageGenerationError("Image generation timed out. Please retry.", "timeout", 504);
    throw new ImageGenerationError("NVIDIA image request failed.", "provider", 502);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}
