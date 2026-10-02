import { describe, expect, it } from "vitest";
import { decodeGeneratedImageResponse, ImageGenerationError } from "../imageGeneration";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

describe("decodeGeneratedImageResponse", () => {
  it("accepts NVIDIA artifact base64 output", () => {
    const result = decodeGeneratedImageResponse({ artifacts: [{ base64: PNG.toString("base64") }] });
    expect(result.mimeType).toBe("image/png");
    expect(result.extension).toBe("png");
    expect(result.bytes.equals(PNG)).toBe(true);
  });

  it("accepts an OpenAI-compatible b64_json response", () => {
    const result = decodeGeneratedImageResponse({ data: [{ b64_json: JPEG.toString("base64") }] });
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.extension).toBe("jpg");
  });

  it("rejects empty or non-image provider output", () => {
    expect(() => decodeGeneratedImageResponse({ artifacts: [] })).toThrow(ImageGenerationError);
    expect(() => decodeGeneratedImageResponse({ image: Buffer.from("not an image").toString("base64") })).toThrow("unsupported image format");
  });

  it("rejects a mismatched data URI content type", () => {
    expect(() => decodeGeneratedImageResponse({ image: `data:image/jpeg;base64,${PNG.toString("base64")}` })).toThrow("inconsistent image metadata");
  });
});
