import { describe, expect, it } from "vitest";
import { focusedTopicMissingFromTexts } from "../focusedTopicEvidence";

describe("focusedTopicMissingFromTexts", () => {
  it("rejects an absent C language topic without treating incidental letters as evidence", () => {
    expect(focusedTopicMissingFromTexts("Explain what is C language", ["A database language uses SQL. The C column stores a value."])).toBe(true);
    expect(focusedTopicMissingFromTexts("okay what is C language", ["A database language uses SQL."])).toBe(true);
  });

  it("keeps exact topic evidence", () => {
    expect(focusedTopicMissingFromTexts("Explain what is C language", ["C language is used for systems programming."])).toBe(false);
    expect(focusedTopicMissingFromTexts("What is a primary key?", ["A primary key uniquely identifies a row."])).toBe(false);
  });

  it("leaves broad and follow-up study prompts on existing grounding flow", () => {
    expect(focusedTopicMissingFromTexts("Give important notes", ["Other content"])).toBe(false);
    expect(focusedTopicMissingFromTexts("Explain this file simply", ["Other content"])).toBe(false);
    expect(focusedTopicMissingFromTexts("Tell me more", ["Other content"])).toBe(false);
  });
});
