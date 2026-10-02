import { stripConversationalPrefix } from "@/shared/studyIntent";

function normalizedWords(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ")} `;
}

export function focusedTopicMissingFromTexts(question: string, texts: string[]): boolean {
  const match = stripConversationalPrefix(question).match(/^(?:explain\s+what\s+is|what\s+is|define|describe)\s+(.+?)[?.!]*$/i);
  if (!match) return false;

  const topic = normalizedWords(match[1].replace(/^(?:a|an|the)\s+/i, ""));
  const words = topic.trim().split(" ");
  if (!words[0] || words.length > 4) return false;

  return !texts.some((text) => normalizedWords(text).includes(topic));
}
