import { describe, expect, it } from "vitest";
import { normalizeGeneratedImage } from "../generatedImage";

const valid = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  title: "Study visual: Deadlocks",
  prompt: "Deadlocks",
  explanation: "A resource allocation study visual.",
  provider: "nvidia",
  model: "stabilityai/stable-diffusion-3-medium",
  mime_type: "image/jpeg",
  width: 1024,
  height: 1024,
  url: "/api/generated-images/123e4567-e89b-42d3-a456-426614174000/content",
  created_at: "2026-10-02T10:00:00.000Z",
};

describe("normalizeGeneratedImage", () => {
  it("normalizes a persisted generated image", () => {
    expect(normalizeGeneratedImage({ image: valid })).toEqual(valid);
  });

  it("rejects external URLs and unsupported providers", () => {
    expect(normalizeGeneratedImage({ ...valid, url: "https://example.com/image.jpg" })).toBeNull();
    expect(normalizeGeneratedImage({ ...valid, provider: "unknown" })).toBeNull();
  });

  it("rejects invalid dimensions and timestamps", () => {
    expect(normalizeGeneratedImage({ ...valid, width: 0 })).toBeNull();
    expect(normalizeGeneratedImage({ ...valid, created_at: "not-a-date" })).toBeNull();
  });
});
