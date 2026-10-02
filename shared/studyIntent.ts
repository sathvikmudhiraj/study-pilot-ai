export type StudyIntent =
  | { kind: "web_search"; query: string }
  | { kind: "notes_query"; question: string };

type StudyIntentContext = { lastWebQuery?: string };

import type { SupportedLanguageCode } from "./languages";
import { explicitVoiceLanguageCommand } from "./voiceLanguage";

const WEB_COMMANDS = [
  /^(?:do\s+)?(?:a\s+)?web\s+search(?:\s+(?:for|on|about))?\s+(.+)$/iu,
  /^search\s+(?:the\s+)?web(?:\s+topic)?(?:\s+(?:for|on|about))?\s+(.+)$/iu,
  /^search\s+in\s+(?:the|a)\s+web\s+(?:for|about)\s+(.+)$/iu,
  /^search\s+a\s+web\s+topic(?:\s+for)?\s+(.+)$/iu,
  /^search\s+online\s+(?:for|about)\s+(.+)$/iu,
  /^search\s+more\s+about\s+(.+)$/iu,
  /^look\s+up\s+(.+?)\s+(?:online|on\s+the\s+web)$/iu,
  /^find\s+(.+?)\s+on\s+the\s+web$/iu,
  /^find\s+information\s+online\s+about\s+(.+)$/iu,
  /^find\s+current\s+information\s+about\s+(.+)$/iu,
  /^do\s+a\s+website\s+(?:of|on|about)\s+(.+)$/iu,
  /^web\s+lo\s+(.+?)\s+search\s+cheyyi$/iu,
];

const WEB_FOLLOW_UP = /^(?:tell me more|continue|explain further|go deeper)(?:\s+please)?[.!?]?$/iu;

export function stripConversationalPrefix(text: string): string {
  let remainder = text.normalize("NFKC").trim();
  for (let index = 0; index < 3; index += 1) {
    const next = remainder.replace(/^(?:(?:okay|ok|hey)[,\s]+|(?:please|can you|could you|would you|study\s*pilot)[,\s]+)/iu, "").trim();
    if (next === remainder || !next) break;
    remainder = next;
  }
  return remainder;
}

export function resolveStudyIntent(text: string, context: StudyIntentContext = {}): StudyIntent {
  const question = stripConversationalPrefix(text);
  for (const pattern of WEB_COMMANDS) {
    const match = question.match(pattern);
    const query = match?.[1]?.replace(/[\s.!?\u0964]+$/gu, "").trim();
    if (query) return { kind: "web_search", query };
  }

  const lastWebQuery = context.lastWebQuery?.trim();
  if (lastWebQuery && WEB_FOLLOW_UP.test(question)) {
    return { kind: "web_search", query: `${lastWebQuery} explained in more detail` };
  }

  return { kind: "notes_query", question };
}

export function suggestedWebTopic(question: string): string {
  return stripConversationalPrefix(question)
    .replace(/^(?:please\s+)?(?:explain(?:\s+what\s+is)?|tell\s+me\s+about|what\s+is|what\s+are|define|describe)\s+/iu, "")
    .replace(/[\s.!?\u0964]+$/gu, "")
    .trim() || question.trim();
}

export function requestedStudyLanguage(text: string): SupportedLanguageCode | null {
  return explicitVoiceLanguageCommand(stripConversationalPrefix(text));
}
