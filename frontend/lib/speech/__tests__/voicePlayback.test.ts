import { describe, expect, it } from "vitest";
import { SentenceStreamBuffer, splitSpeechText } from "../voicePlayback";

describe("splitSpeechText", () => {
  it("keeps sentences ordered and avoids splitting decimals and common abbreviations", () => {
    const chunks = splitSpeechText("Dr. Rao measured 3.14 volts. The result was stable. Next, compare it.", 38);
    expect(chunks.join(" ")).toBe("Dr. Rao measured 3.14 volts. The result was stable. Next, compare it.");
    expect(chunks.every((chunk) => chunk.length <= 38)).toBe(true);
  });

  it("splits long text into bounded non-empty chunks", () => {
    const chunks = splitSpeechText("A very long explanation without punctuation ".repeat(20), 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 80)).toBe(true);
  });
});

describe("SentenceStreamBuffer", () => {
  it("holds incomplete text until a safe sentence boundary", () => {
    const buffer = new SentenceStreamBuffer();
    expect(buffer.push("Distributed trans")).toEqual([]);
    expect(buffer.push("actions coordinate work. Next")).toEqual(["Distributed transactions coordinate work."]);
    expect(buffer.flush()).toEqual(["Next"]);
  });

  it("removes URLs and Markdown before speech", () => {
    const buffer = new SentenceStreamBuffer();
    expect(buffer.push("See **the source** at https://example.com/page. Done.")).toEqual(["See the source at Done."]);
  });

  it("never speaks JSON or an unfinished citation", () => {
    const buffer = new SentenceStreamBuffer();
    expect(buffer.push('{"answer":"No."}')).toEqual([]);
    buffer.reset();
    expect(buffer.push("Supported by source [1")).toEqual([]);
    expect(buffer.flush()).toEqual([]);
  });
});
