// Browser-only Web Speech API helpers for the StudyPilot Voice Tutor.
//
// These APIs (SpeechRecognition / SpeechSynthesis) are not part of the
// TypeScript DOM lib used by this project, so we declare the minimal shapes we
// need here instead of relying on ambient typings. Everything is intentionally
// guarded so the app degrades gracefully on unsupported browsers.

// ---------------------------------------------------------------------------
// SpeechRecognition (speech-to-text)
// ---------------------------------------------------------------------------

export type SpeechRecognitionAlternativeLike = {
  transcript?: string;
  confidence?: number;
};

export type SpeechRecognitionResultLike = ArrayLike<SpeechRecognitionAlternativeLike> & {
  isFinal?: boolean;
  length: number;
};

export type SpeechRecognitionEventLike = {
  resultIndex?: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

export type SpeechRecognitionErrorEventLike = {
  error?: string;
  message?: string;
};

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onaudiostart?: (() => void) | null;
  onaudioend?: (() => void) | null;
  onsoundstart?: (() => void) | null;
  onsoundend?: (() => void) | null;
  onspeechstart?: (() => void) | null;
  onspeechend?: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

/** Returns the browser SpeechRecognition constructor, or null when unsupported. */
export function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as WindowWithSpeechRecognition;
  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition || null;
}

/** True when the current browser exposes a speech-to-text API. */
export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognition() !== null;
}

// ---------------------------------------------------------------------------
// SpeechSynthesis (text-to-speech / read aloud)
// ---------------------------------------------------------------------------

/** True when the current browser can speak text aloud. */
export function isSpeechSynthesisSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "speechSynthesis" in window && typeof window.speechSynthesis?.speak === "function";
}

// ---------------------------------------------------------------------------
// Language selector
// ---------------------------------------------------------------------------

export type VoiceLanguageCode = "auto" | "en-IN" | "te-IN" | "hi-IN" | "ta-IN" | "kn-IN" | "ml-IN" | "en-US";

export type VoiceLanguage = {
  code: VoiceLanguageCode;
  /** Display label in the language selector. */
  label: string;
  /**
   * BCP-47 recognition locale used for SpeechRecognition. Empty string means
   * "use the browser default" (the Auto option).
   */
  recognitionLocale: string;
  /**
   * BCP-47 speech locale preferred for SpeechSynthesis, used to pick a voice
   * whose name or lang matches the user's language. Empty string means
   * "use the browser default voice".
   */
  speechLocale: string;
  /** Short human-readable name of the language used in AI prompts. */
  languageName: string;
};

export const VOICE_LANGUAGES: VoiceLanguage[] = [
  { code: "auto", label: "Auto detect", recognitionLocale: "", speechLocale: "", languageName: "the same language you speak" },
  { code: "en-IN", label: "English (India)", recognitionLocale: "en-IN", speechLocale: "en-IN", languageName: "Indian English" },
  { code: "te-IN", label: "Telugu", recognitionLocale: "te-IN", speechLocale: "te-IN", languageName: "Telugu" },
  { code: "hi-IN", label: "Hindi", recognitionLocale: "hi-IN", speechLocale: "hi-IN", languageName: "Hindi" },
  { code: "ta-IN", label: "Tamil", recognitionLocale: "ta-IN", speechLocale: "ta-IN", languageName: "Tamil" },
  { code: "kn-IN", label: "Kannada", recognitionLocale: "kn-IN", speechLocale: "kn-IN", languageName: "Kannada" },
  { code: "ml-IN", label: "Malayalam", recognitionLocale: "ml-IN", speechLocale: "ml-IN", languageName: "Malayalam" },
  { code: "en-US", label: "English (US)", recognitionLocale: "en-US", speechLocale: "en-US", languageName: "American English" },
];

export function findVoiceLanguage(code: string | undefined | null): VoiceLanguage {
  return VOICE_LANGUAGES.find((language) => language.code === code) ?? VOICE_LANGUAGES[0];
}

// ---------------------------------------------------------------------------
// SpeechSynthesis voice picker
// ---------------------------------------------------------------------------

/** Picks the best available SpeechSynthesis voice for a locale, or null. */
export function pickVoiceForLocale(locale: string): SpeechSynthesisVoice | null {
  if (!isSpeechSynthesisSupported()) return null;
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length || !locale) return null;

  const langPrefix = locale.toLowerCase().split("-")[0];
  const exact = voices.find((voice) => voice.lang?.toLowerCase() === locale.toLowerCase());
  if (exact) return exact;

  const samePrefix = voices.find((voice) => voice.lang?.toLowerCase().startsWith(langPrefix));
  if (samePrefix) return samePrefix;

  return null;
}
