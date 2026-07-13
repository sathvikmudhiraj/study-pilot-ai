import "server-only";

import { generateAIText } from "./aiProvider";
import { STUDYPILOT_TUTOR_INSTRUCTION } from "./tutorPrompt";

export type StructuredChatAnswer = {
  short_answer: string;
  simple_explanation: string;
  step_by_step: string[];
  example: string;
  memory_line: string;
  common_mistake: string;
  exam_viva_answer: string;
  practice_question: string;
  related_files_notes: string[];
  next_step: string;
};

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[aiChat] ${message}`, details ?? "");
}

function stripJsonFence(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function extractFirstJsonObject(raw: string) {
  const start = raw.indexOf("{");
  if (start === -1) return "";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;

    if (depth === 0) return raw.slice(start, index + 1).trim();
  }

  return "";
}

function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 10);
}

function textValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function arrayValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = toStringArray(record[key]);
    if (value.length) return value;
  }
  return [];
}

function validateAnswer(value: unknown): StructuredChatAnswer | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const answer: StructuredChatAnswer = {
    short_answer: textValue(record, "short_answer", "shortAnswer", "short answer", "answer"),
    simple_explanation: textValue(record, "simple_explanation", "simpleExplanation", "simple explanation", "explanation"),
    step_by_step: arrayValue(record, "step_by_step", "stepByStep", "steps", "step by step"),
    example: textValue(record, "example"),
    memory_line: textValue(record, "memory_line", "memoryLine", "memory line", "mnemonic"),
    common_mistake: textValue(record, "common_mistake", "commonMistake", "common mistake"),
    exam_viva_answer: textValue(record, "exam_viva_answer", "examVivaAnswer", "exam_answer", "examAnswer", "viva_answer", "vivaAnswer"),
    practice_question: textValue(record, "practice_question", "practiceQuestion", "practice question"),
    related_files_notes: arrayValue(record, "related_files_notes", "relatedFilesNotes", "related", "sources"),
    next_step: textValue(record, "next_step", "nextStep", "next step"),
  };

  if (!answer.short_answer && !answer.simple_explanation) return null;
  return answer;
}

function parseCandidate(json: string) {
  try {
    return validateAnswer(JSON.parse(json));
  } catch {
    const repaired = json
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");

    try {
      return validateAnswer(JSON.parse(repaired));
    } catch {
      return null;
    }
  }
}

function parseChatJson(raw: string) {
  const trimmed = raw.trim();
  const withoutFence = stripJsonFence(trimmed);
  const extractedObject = extractFirstJsonObject(withoutFence) || extractFirstJsonObject(trimmed);
  const attempts = [
    { method: "direct", value: trimmed },
    { method: "fence-cleanup", value: withoutFence },
    { method: "object-extraction", value: extractedObject },
  ];

  for (const attempt of attempts) {
    if (!attempt.value) continue;
    const parsed = parseCandidate(attempt.value);
    if (parsed) {
      devLog("Gemini chat JSON parse succeeded", { method: attempt.method, rawLength: raw.length });
      return parsed;
    }
  }

  devLog("Gemini chat JSON parse failed", { rawLength: raw.length });
  return null;
}

function fallbackAnswerFromText(raw: string): StructuredChatAnswer | null {
  const text = stripJsonFence(raw)
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .trim();

  if (text.length < 20) return null;

  const firstParagraph = text.split(/\n{2,}/).find(Boolean)?.trim() ?? text.slice(0, 500).trim();

  return {
    short_answer: firstParagraph.slice(0, 700),
    simple_explanation: text,
    step_by_step: [],
    example: "",
    memory_line: "",
    common_mistake: "",
    exam_viva_answer: firstParagraph.slice(0, 700),
    practice_question: "",
    related_files_notes: [],
    next_step: "Ask a follow-up question or attach another file for more focused help.",
  };
}

export async function answerStudyQuestion({
  question,
  context,
}: {
  question: string;
  context: string;
}) {
  const prompt = `${STUDYPILOT_TUTOR_INSTRUCTION}

Answer the student's question like a tutor, not like a generic summary bot.

Context rules:
- Always prioritise the full EXTRACTED TEXT over any saved summary outline. The extracted text is the primary source of truth.
- Use extracted text, saved summaries, uploaded notes, and selected context if present.
- Do not say "please paste the text" when context exists.
- If context is weak, say: "I found limited content for this exact question, but based on your uploaded material, here is the best explanation."
- Do not hallucinate file content that is not in the context.
- If the question asks for important notes or a general explanation of the whole file/module, cover all major topics fairly instead of focusing on only one section. Use the full extracted text, not just a summary snippet.
- For CNS/cryptography material, check whether cryptography basics, CIA triad, OSI security architecture, attacks, services, mechanisms, symmetric cipher model, Caesar, monoalphabetic, Playfair, and Hill cipher are present. Include only topics present in the context.

Return strict JSON only. Do not include markdown. The JSON shape must be:
{
  "short_answer": "string",
  "simple_explanation": "string",
  "step_by_step": ["string"],
  "example": "string",
  "memory_line": "string",
  "common_mistake": "string",
  "exam_viva_answer": "string",
  "practice_question": "string",
  "related_files_notes": ["string"],
  "next_step": "string"
}

STUDY CONTEXT:
${context || "No readable user study context was found."}

QUESTION:
${question}`;

  const response = await generateAIText(prompt, {
    temperature: 0.2,
    maxOutputTokens: 2400,
    responseMimeType: "application/json",
  });
  devLog("Gemini chat response received", { rawLength: response.length });
  const parsed = parseChatJson(response);
  if (parsed) return parsed;

  const fallback = fallbackAnswerFromText(response);
  if (fallback) {
    devLog("Gemini chat response used text fallback", { rawLength: response.length });
    return fallback;
  }

  throw new Error("AI returned an answer format StudyPilot could not read. Please try again.");
}
