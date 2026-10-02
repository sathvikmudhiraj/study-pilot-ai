import { describe, expect, it } from "vitest";
import { requestedStudyLanguage, resolveStudyIntent, suggestedWebTopic } from "../studyIntent";

describe("shared study intent", () => {
  it.each([
    ["web search C language", "C language"],
    ["search the web for C language", "C language"],
    ["search web topic C language", "C language"],
    ["search web for C language", "C language"],
    ["search online for C language", "C language"],
    ["look up C language online", "C language"],
    ["find C language on the web", "C language"],
    ["do a web search on what is C language", "what is C language"],
    ["search a web topic for C language", "C language"],
    ["search more about pointers", "pointers"],
    ["search web about C language", "C language"],
    ["search in the web for C language", "C language"],
    ["search in the web about C language", "C language"],
    ["search in a web about C language", "C language"],
    ["search online about C language", "C language"],
    ["look up C language on the web", "C language"],
    ["find information online about C language", "C language"],
    ["okay search the web for C language", "C language"],
    ["please search online for C language", "C language"],
    ["can you search the web about C language", "C language"],
    ["okay do a website of what is C language", "what is C language"],
    ["do a website on C language", "C language"],
    ["do a website about C language", "C language"],
  ])("routes %s to Web Search with the original topic", (text, query) => {
    expect(resolveStudyIntent(text)).toEqual({ kind: "web_search", query });
  });

  it.each([
    "Explain what is C language",
    "What is web search?",
    "Explain how web search works",
    "What does search the web mean?",
    "What is a website?",
    "Explain websites",
    "build a website about C language",
    "create a website about C language",
    "What is a quiz?",
  ])("keeps %s as a notes question", (text) => {
    expect(resolveStudyIntent(text)).toEqual({ kind: "notes_query", question: text });
  });

  it("strips conversational filler without changing a notes question into web search", () => {
    expect(resolveStudyIntent("okay what is C language")).toEqual({ kind: "notes_query", question: "what is C language" });
  });

  it("continues an immediate web follow-up but not an unrelated question", () => {
    expect(resolveStudyIntent("tell me more", { lastWebQuery: "C language" })).toEqual({
      kind: "web_search", query: "C language explained in more detail",
    });
    expect(resolveStudyIntent("Explain pointers", { lastWebQuery: "C language" }).kind).toBe("notes_query");
    expect(resolveStudyIntent("tell me more").kind).toBe("notes_query");
  });

  it("offers the actual missing study topic", () => {
    expect(suggestedWebTopic("Explain what is C language")).toBe("C language");
  });

  it("detects explicit language switches without changing unrelated topics", () => {
    expect(requestedStudyLanguage("Compiler ante enti Telugu lo cheppu")).toBe("te");
    expect(requestedStudyLanguage("English lo cheppu")).toBe("en");
    expect(requestedStudyLanguage("What is Telugu language?")).toBeNull();
  });
});
