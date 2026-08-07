import { afterEach, describe, expect, it, vi } from "vitest";
import { findVoiceLanguage, pickVoiceForLocale, VOICE_LANGUAGES } from "../speech/webSpeech";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voice language mapping", () => {
  it("maps every supported language to a regional recognition and speech locale", () => {
    expect(VOICE_LANGUAGES.filter((language) => language.code !== "auto")).toHaveLength(8);
    expect(findVoiceLanguage("mr")).toMatchObject({ recognitionLocale: "mr-IN", speechLocale: "mr-IN" });
    expect(findVoiceLanguage("bn")).toMatchObject({ recognitionLocale: "bn-IN", speechLocale: "bn-IN" });
  });

  it("falls back to auto for an unknown language code", () => {
    expect(findVoiceLanguage("unknown").code).toBe("auto");
  });

  it("falls back to an English voice when a regional voice is unavailable", () => {
    const englishVoice = { lang: "en-IN", name: "English India", default: true } as SpeechSynthesisVoice;
    vi.stubGlobal("window", {
      speechSynthesis: {
        speak: vi.fn(),
        getVoices: () => [englishVoice],
      },
    });

    expect(pickVoiceForLocale("te-IN")).toBe(englishVoice);
  });
});
