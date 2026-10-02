import { describe, expect, it } from "vitest";
import {
  detectSpokenLanguage,
  detectVoiceScript,
  explicitVoiceLanguageCommand,
} from "../voiceLanguage";

describe("voice language intelligence", () => {
  it.each([
    ["Explain deadlocks", "latin"],
    ["हिंदी में बताओ", "devanagari"],
    ["తెలుగులో చెప్పు", "telugu"],
    ["தமிழில் சொல்லு", "tamil"],
    ["ಕನ್ನಡದಲ್ಲಿ ಹೇಳು", "kannada"],
    ["മലയാളത്തിൽ പറയൂ", "malayalam"],
    ["বাংলায় বলো", "bengali"],
  ] as const)("detects %s as %s", (text, script) => {
    expect(detectVoiceScript(text)).toBe(script);
  });

  it.each([
    ["Continue in English", "en"],
    ["Telugu lo explain chey", "te"],
    ["Telugu lo simple ga cheppu", "te"],
    ["Hindi mein samjhao", "hi"],
    ["தமிழில் விளக்கவும்", "ta"],
    ["ಕನ್ನಡದಲ್ಲಿ ವಿವರಿಸು", "kn"],
    ["മലയാളത്തിൽ വിശദീകരിക്കൂ", "ml"],
    ["मराठीत समजावून सांग", "mr"],
    ["বাংলায় বুঝিয়ে বলো", "bn"],
  ] as const)("resolves language command %s", (text, language) => {
    expect(explicitVoiceLanguageCommand(text)).toBe(language);
  });

  it.each([
    ["Telugu lo cheppu", "te"],
    ["Hindi mein batao", "hi"],
    ["Tamil la sollu", "ta"],
    ["Kannadadalli helu", "kn"],
    ["Malayalathil parayu", "ml"],
    ["Marathit sang", "mr"],
    ["Banglay bolo", "bn"],
  ] as const)("supports romanized switch %s", (text, language) => {
    expect(explicitVoiceLanguageCommand(text)).toBe(language);
  });

  it("does not randomly switch on ambiguous Latin text", () => {
    expect(detectSpokenLanguage("next", "te")).toMatchObject({
      language: "te",
      reason: "recent-language",
    });
  });

  it("preserves the recent language for ambiguous Devanagari", () => {
    expect(detectSpokenLanguage("अगला", "mr")).toMatchObject({
      language: "mr",
      reason: "recent-language",
    });
  });
});
