import { describe, expect, it } from "vitest";
import { localizedRuntimeCopy } from "../runtimeMessages";
import { responseUsesExpectedScript, SUPPORTED_LANGUAGE_CODES } from "../languages";

describe("localized runtime fallback copy", () => {
  it.each(SUPPORTED_LANGUAGE_CODES.filter((language) => language !== "en"))("keeps %s fallbacks in the active script", (language) => {
    const copy = localizedRuntimeCopy(language);
    expect(responseUsesExpectedScript(copy.topicNotFound, language)).toBe(true);
    expect(responseUsesExpectedScript(copy.providerFallbackNotice, language)).toBe(true);
    expect(responseUsesExpectedScript(copy.noMorePoints, language)).toBe(true);
  });
});
