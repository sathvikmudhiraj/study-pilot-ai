import { describe, expect, it } from "vitest";
import {
  SUPPORTED_LANGUAGE_CODES,
  canonicalTopicId,
  languageDetails,
  languageInstruction,
  normalizeLanguageCode,
  responseUsesExpectedScript,
} from "../languages";

describe("multilingual language contract", () => {
  it("supports the approved eight-language allowlist", () => {
    expect(SUPPORTED_LANGUAGE_CODES).toEqual(["en", "hi", "te", "ta", "kn", "ml", "mr", "bn"]);
    expect(normalizeLanguageCode("xx")).toBe("en");
    expect(languageDetails("te").locale).toBe("te-IN");
  });

  it("keeps machine-readable fields and identifiers untranslated", () => {
    const instruction = languageInstruction("hi");
    expect(instruction).toContain("JSON keys exactly as specified in English");
    expect(instruction).toContain("filenames, URLs, citation labels, citation IDs, database IDs");
  });

  it.each([
    ["te", "Telugu"],
    ["hi", "Hindi"],
    ["ta", "Tamil"],
    ["kn", "Kannada"],
    ["ml", "Malayalam"],
    ["mr", "Marathi"],
    ["bn", "Bengali"],
  ] as const)("builds a strict %s AI output instruction", (code, name) => {
    const instruction = languageInstruction(code);
    expect(instruction).toContain(`OUTPUT LANGUAGE: ${name} (${code})`);
    expect(instruction).toContain("JSON keys exactly as specified in English");
  });

  it("detects expected regional scripts and creates stable topic ids", () => {
    expect(responseUsesExpectedScript("यह हिंदी उत्तर है", "hi")).toBe(true);
    expect(responseUsesExpectedScript("English only", "hi")).toBe(false);
    expect(canonicalTopicId("OSI Security Architecture")).toBe("osi_security_architecture");
  });
});
