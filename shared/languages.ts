export const SUPPORTED_LANGUAGE_CODES = ["en", "hi", "te", "ta", "kn", "ml", "mr", "bn"] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

export type SupportedLanguage = {
  code: SupportedLanguageCode;
  label: string;
  nativeLabel: string;
  locale: string;
  promptName: string;
};

export const DEFAULT_LANGUAGE: SupportedLanguageCode = "en";

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { code: "en", label: "English", nativeLabel: "English", locale: "en-IN", promptName: "English" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", locale: "hi-IN", promptName: "Hindi" },
  { code: "te", label: "Telugu", nativeLabel: "తెలుగు", locale: "te-IN", promptName: "Telugu" },
  { code: "ta", label: "Tamil", nativeLabel: "தமிழ்", locale: "ta-IN", promptName: "Tamil" },
  { code: "kn", label: "Kannada", nativeLabel: "ಕನ್ನಡ", locale: "kn-IN", promptName: "Kannada" },
  { code: "ml", label: "Malayalam", nativeLabel: "മലയാളം", locale: "ml-IN", promptName: "Malayalam" },
  { code: "mr", label: "Marathi", nativeLabel: "मराठी", locale: "mr-IN", promptName: "Marathi" },
  { code: "bn", label: "Bengali", nativeLabel: "বাংলা", locale: "bn-IN", promptName: "Bengali" },
] as const;

const LANGUAGE_BY_CODE = new Map(SUPPORTED_LANGUAGES.map((language) => [language.code, language]));

export function isSupportedLanguageCode(value: unknown): value is SupportedLanguageCode {
  return typeof value === "string" && SUPPORTED_LANGUAGE_CODES.includes(value.trim().toLowerCase() as SupportedLanguageCode);
}

export function normalizeLanguageCode(value: unknown, fallback: SupportedLanguageCode = DEFAULT_LANGUAGE): SupportedLanguageCode {
  if (!isSupportedLanguageCode(value)) return fallback;
  return value.trim().toLowerCase() as SupportedLanguageCode;
}

export function languageDetails(value: unknown): SupportedLanguage {
  return LANGUAGE_BY_CODE.get(normalizeLanguageCode(value)) ?? SUPPORTED_LANGUAGES[0];
}

export function languageInstruction(value: unknown) {
  const language = languageDetails(value);
  const selectedRule = language.code === "en"
    ? "Write all user-facing prose in clear Indian English."
    : `Write all user-facing prose in natural ${language.promptName}. Keep established technical terms in English when that is clearer, optionally followed by a ${language.promptName} explanation in parentheses.`;

  return [
    `OUTPUT LANGUAGE: ${language.promptName} (${language.code}).`,
    selectedRule,
    "Keep JSON keys exactly as specified in English.",
    "Do not translate or alter code, code blocks, commands, formulas, filenames, URLs, citation labels, citation IDs, database IDs, or other identifiers.",
  ].join("\n");
}

export function responseUsesExpectedScript(text: string, value: unknown) {
  const language = normalizeLanguageCode(value);
  if (language === "en") return true;
  const patterns: Record<Exclude<SupportedLanguageCode, "en">, RegExp> = {
    hi: /[\u0900-\u097f]/,
    te: /[\u0c00-\u0c7f]/,
    ta: /[\u0b80-\u0bff]/,
    kn: /[\u0c80-\u0cff]/,
    ml: /[\u0d00-\u0d7f]/,
    mr: /[\u0900-\u097f]/,
    bn: /[\u0980-\u09ff]/,
  };
  return patterns[language].test(text);
}

export function canonicalTopicId(value: unknown) {
  const normalized = String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return normalized || "general_review";
}

