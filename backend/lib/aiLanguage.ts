import "server-only";

import {
  languageInstruction,
  normalizeLanguageCode,
  responseUsesExpectedScript,
  type SupportedLanguageCode,
} from "@/shared/languages";

type GenerateText = (prompt: string) => Promise<string>;

export async function generateLocalizedText(
  prompt: string,
  language: SupportedLanguageCode,
  generate: GenerateText,
) {
  const normalizedLanguage = normalizeLanguageCode(language);
  const localizedPrompt = `${languageInstruction(normalizedLanguage)}\n\n${prompt}`;
  const response = await generate(localizedPrompt);

  if (responseUsesExpectedScript(response, normalizedLanguage)) return response;

  if (process.env.NODE_ENV !== "production") {
    console.info("[aiLanguage] retrying response with stricter language instruction", {
      language: normalizedLanguage,
    });
  }

  return generate(`${languageInstruction(normalizedLanguage)}

The previous response did not use the selected language. Rewrite the complete answer in the selected language. Preserve the exact JSON shape and English JSON keys.

${prompt}`);
}
