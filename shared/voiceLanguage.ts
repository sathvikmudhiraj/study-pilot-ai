import {
  languageDetails,
  type SupportedLanguageCode,
} from "./languages";

export type VoiceScript =
  | "latin"
  | "devanagari"
  | "telugu"
  | "tamil"
  | "kannada"
  | "malayalam"
  | "bengali"
  | "unknown";

export type VoiceLanguageDecision = {
  language: SupportedLanguageCode | null;
  confidence: number;
  reason: "explicit-command" | "script" | "romanized-evidence" | "recent-language" | "uncertain";
};

const SCRIPT_PATTERNS: Array<[Exclude<VoiceScript, "latin" | "unknown">, RegExp]> = [
  ["devanagari", /[\u0900-\u097f]/u],
  ["bengali", /[\u0980-\u09ff]/u],
  ["tamil", /[\u0b80-\u0bff]/u],
  ["telugu", /[\u0c00-\u0c7f]/u],
  ["kannada", /[\u0c80-\u0cff]/u],
  ["malayalam", /[\u0d00-\u0d7f]/u],
];

const SCRIPT_LANGUAGE: Partial<Record<VoiceScript, SupportedLanguageCode>> = {
  telugu: "te",
  tamil: "ta",
  kannada: "kn",
  malayalam: "ml",
  bengali: "bn",
};

const LANGUAGE_COMMANDS: Array<[SupportedLanguageCode, RegExp[]]> = [
  ["en", [
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+english\b/iu,
    /\benglish\s+(?:lo\s+cheppu|mein\s+batao|please)\b/iu,
  ]],
  ["te", [
    /\btelugu\s+lo\s+(?:(?:simple\s+ga\s+)?cheppu|explain\s+chey|matladu)\b/iu,
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+telugu\b/iu,
    /తెలుగులో\s+(?:చెప్పు|వివరించు)/u,
  ]],
  ["hi", [
    /\bhindi\s+(?:mein|me)\s+(?:batao|samjhao|bolo)\b/iu,
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+hindi\b/iu,
    /हिंदी\s+में\s+(?:बताओ|समझाओ|बोलो)/u,
  ]],
  ["ta", [
    /\btamil(?:il|\s+la)?\s+(?:sollu|vilakkavum|explain)\b/iu,
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+tamil\b/iu,
    /தமிழில்\s+(?:சொல்லு|விளக்கவும்)/u,
  ]],
  ["kn", [
    /\bkannada(?:dalli|\s+alli)?\s+(?:helu|vivarisu|explain)\b/iu,
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+kannada\b/iu,
    /ಕನ್ನಡದಲ್ಲಿ\s+(?:ಹೇಳು|ವಿವರಿಸು)/u,
  ]],
  ["ml", [
    /\b(?:malayalam(?:il|\s+il)?|malayalathil)\s+(?:parayu|visadikarikku|explain)\b/iu,
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+malayalam\b/iu,
    /മലയാളത്തിൽ\s+(?:പറയൂ|വിശദീകരിക്കൂ)/u,
  ]],
  ["mr", [
    /\bmarathi(?:t|\s+madhe)?\s+(?:sang|samjavun\s+sang|bola)\b/iu,
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+marathi\b/iu,
    /मराठीत\s+(?:सांग|समजावून\s+सांग)/u,
  ]],
  ["bn", [
    /\b(?:bangla|bengali)(?:y|\s+te)?\s+(?:bolo|bujhiye\s+bolo|explain)\b/iu,
    /\b(?:continue|explain|reply|answer|speak)\s+in\s+(?:bangla|bengali)\b/iu,
    /বাংলায়\s+(?:বলো|বুঝিয়ে\s+বলো)/u,
  ]],
];

const ROMANIZED_MARKERS: Partial<Record<SupportedLanguageCode, RegExp[]>> = {
  te: [/\b(?:cheppu|cheyyi|enti|ela|naku|lo)\b/giu],
  hi: [/\b(?:batao|samjhao|kya|kaise|mujhe|mein|hai)\b/giu],
  ta: [/\b(?:sollu|enna|eppadi|vilakku|tamilil)\b/giu],
  kn: [/\b(?:helu|hege|enu|vivarisu|kannadadalli)\b/giu],
  ml: [/\b(?:parayu|enthu|engane|visadikarikku|malayalathil)\b/giu],
  mr: [/\b(?:sang|kay|kase|samjavun|marathit)\b/giu],
  bn: [/\b(?:bolo|ki|kibhabe|bujhiye|banglay)\b/giu],
};

export function detectVoiceScript(text: string): VoiceScript {
  for (const [script, pattern] of SCRIPT_PATTERNS) {
    if (pattern.test(text)) return script;
  }
  if (/[a-z]/iu.test(text)) return "latin";
  return "unknown";
}

export function explicitVoiceLanguageCommand(text: string): SupportedLanguageCode | null {
  const normalized = text.normalize("NFKC").trim();
  for (const [language, patterns] of LANGUAGE_COMMANDS) {
    if (patterns.some((pattern) => pattern.test(normalized))) return language;
  }
  return null;
}

export function detectSpokenLanguage(
  text: string,
  recentLanguage: SupportedLanguageCode,
): VoiceLanguageDecision {
  const explicit = explicitVoiceLanguageCommand(text);
  if (explicit) return { language: explicit, confidence: 1, reason: "explicit-command" };

  const script = detectVoiceScript(text);
  const scriptLanguage = SCRIPT_LANGUAGE[script];
  if (scriptLanguage) return { language: scriptLanguage, confidence: 0.99, reason: "script" };

  if (script === "devanagari") {
    if (recentLanguage === "hi" || recentLanguage === "mr") {
      return { language: recentLanguage, confidence: 0.86, reason: "recent-language" };
    }
    return { language: null, confidence: 0.45, reason: "uncertain" };
  }

  if (script === "latin") {
    for (const [language, patterns] of Object.entries(ROMANIZED_MARKERS) as Array<[
      SupportedLanguageCode,
      RegExp[],
    ]>) {
      const evidence = patterns.reduce((count, pattern) => count + (text.match(pattern)?.length ?? 0), 0);
      if (evidence >= 2) return { language, confidence: 0.78, reason: "romanized-evidence" };
    }
  }

  return {
    language: recentLanguage,
    confidence: 0.55,
    reason: recentLanguage === "en" && script === "latin" ? "script" : "recent-language",
  };
}

export function voiceLocale(language: SupportedLanguageCode): string {
  return languageDetails(language).locale;
}
