import { describe, expect, it } from "vitest";
import { splitSpeechText } from "../voicePlayback";

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
