import { describe, expect, it } from "vitest";
import { resolveVoiceCommand } from "../voiceCommands";

describe("Voice Tutor command routing", () => {
  it.each([
    ["open dashboard", "navigate"], ["open files", "navigate"],
    ["open quiz", "navigate"], ["open revision", "navigate"],
    ["give important notes", "ask"], ["explain this file", "ask"],
    ["generate quiz", "study_workflow"], ["create revision plan", "study_workflow"],
    ["search the web for a topic", "web_search"],
    ["research a topic deeply", "deep_research"],
    ["generate a diagram for a topic", "diagram"],
    ["create notes from this answer", "notes"],
    ["create notes from this summary", "notes"],
    ["make exam notes", "notes"],
    ["create one-page revision notes", "notes"],
    ["save this as notes", "notes"],
    ["download notes as pdf", "notes"],
    ["download notes as docx", "notes"],
    ["download notes as markdown", "notes"],
    ["download notes as text", "notes"],
  ])("preserves %s", (spoken, kind) => {
    const result = resolveVoiceCommand(spoken);
    expect(result.kind).toBe("command");
    if (result.kind === "command") expect(result.outcome.kind).toBe(kind);
  });

  it("uses the shared Web Search resolver for spoken commands and follow-ups", () => {
    const result = resolveVoiceCommand("search the web for database normalization");
    expect(result).toMatchObject({ kind: "command", outcome: { kind: "web_search", query: "database normalization" } });
    expect(resolveVoiceCommand("tell me more", { lastWebQuery: "C language" })).toMatchObject({
      kind: "command", outcome: { kind: "web_search", query: "C language explained in more detail" },
    });
    expect(resolveVoiceCommand("What is web search?").kind).toBe("question");
  });

  it.each([
    ["take me to my files", "navigate"],
    ["make me a quiz from this file", "study_workflow"],
    ["plan my revision", "study_workflow"],
    ["show me the important points", "ask"],
    ["explain this in simple words", "ask"],
    ["search online about C language", "web_search"],
    ["do some deep research on neural networks", "deep_research"],
    ["research compiler optimization in detail", "deep_research"],
    ["draw a diagram for this topic", "diagram"],
    ["turn this answer into notes", "notes"],
    ["save these notes", "notes"],
    ["download this as a Word file", "notes"],
  ])("classifies natural command %s", (spoken, kind) => {
    const result = resolveVoiceCommand(spoken);
    expect(result.kind).toBe("command");
    if (result.kind === "command") expect(result.outcome.kind).toBe(kind);
  });

  it("does not reroute questions about websites or quizzes", () => {
    for (const question of ["What is a website?", "build a website about C language", "What is a quiz?"]) {
      expect(resolveVoiceCommand(question).kind).toBe("question");
    }
    expect(resolveVoiceCommand("okay do a website of what is C language")).toMatchObject({
      kind: "command", outcome: { kind: "web_search", query: "what is C language" },
    });
  });
});
