import "server-only";

import { generateAITextWithMetadata, type AIProviderResult } from "./aiProvider";
import {
  canonicalTopicId,
  DEFAULT_LANGUAGE,
  languageInstruction,
  normalizeLanguageCode,
  responseUsesExpectedScript,
  type SupportedLanguageCode,
} from "@/shared/languages";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QuizQuestionType = "mcq" | "short";

export type QuizQuestion = {
  id: string;
  type: QuizQuestionType;
  question: string;
  topic: string;
  topic_id: string;
  topic_en: string;
  options: string[];
  correct_index: number | null;
  acceptable_answers: string[];
  explanation: string;
};

export type QuizDifficulty = "easy" | "medium" | "hard";

export type GeneratedQuiz = {
  title: string;
  difficulty: QuizDifficulty;
  questions: QuizQuestion[];
  source_summary: string;
};

export type QuizOptions = {
  count?: number;
  difficulty?: QuizDifficulty;
  questionTypes?: QuizQuestionType[];
  focusTopics?: string[];
  personalizationNote?: string;
  language?: SupportedLanguageCode;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_QUESTION_COUNT = 8;
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 20;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;
const MAX_TEXT_CHARS = 14000;
const QUIZ_TIMEOUT_MESSAGE = "Quiz generation timed out. Please retry.";

const VALID_DIFFICULTIES: QuizDifficulty[] = ["easy", "medium", "hard"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[aiQuiz] ${message}`, details ?? "");
}

type QuizProviderRun = {
  text: string;
  result: AIProviderResult;
};

function quizProviderFailureMessage(result: AIProviderResult | null) {
  if (!result) return null;
  if (result.responseMode !== "offline_fallback" && result.text.trim()) return null;

  if (result.providerFailureCategory === "timeout") return QUIZ_TIMEOUT_MESSAGE;
  if (result.providerFailureCategory === "empty") return "AI returned an empty quiz response. Please retry.";
  if (result.providerFailureCategory === "quota") return "Free AI limit reached. Please try again later.";
  if (result.providerFailureCategory === "busy") return "StudyPilot AI is busy right now. Please try again in a few seconds.";
  if (result.providerFailureCategory === "auth") return "AI service authentication failed. Check your AI API key.";
  if (result.providerFailureCategory === "config") return "AI service is not configured.";
  if (result.providerFailureCategory === "cancelled") return "AI request was cancelled.";
  if (result.providerFailureCategory) return "AI request failed. Please try again.";
  if (!result.text.trim()) return "AI returned an empty quiz response. Please retry.";
  return null;
}

function assertUsableQuizProviderRun(run: QuizProviderRun, stage: "quiz" | "repair") {
  const failureMessage = quizProviderFailureMessage(run.result);
  if (failureMessage) {
    devLog(`AI ${stage} provider unavailable`, {
      provider: run.result.provider,
      model: run.result.model,
      responseMode: run.result.responseMode,
      providerFailureCategory: run.result.providerFailureCategory ?? null,
      responseChars: run.text.length,
      geminiLatencyMs: run.result.geminiLatencyMs ?? null,
      nvidiaLatencyMs: run.result.nvidiaLatencyMs ?? null,
      totalLatencyMs: run.result.totalLatencyMs,
    });
    throw new Error(failureMessage);
  }
}

function shouldAttemptQuizJsonRepair(run: QuizProviderRun) {
  return run.result.responseMode === "ai" && run.text.trim().length > 0;
}

async function generateLocalizedQuizProviderRun(
  prompt: string,
  language: SupportedLanguageCode,
  generate: (prompt: string) => Promise<AIProviderResult>,
): Promise<QuizProviderRun> {
  const normalizedLanguage = normalizeLanguageCode(language);
  const localizedPrompt = `${languageInstruction(normalizedLanguage)}\n\n${prompt}`;
  let result = await generate(localizedPrompt);
  let text = result.text;

  if (result.responseMode !== "ai" || !text.trim() || responseUsesExpectedScript(text, normalizedLanguage)) {
    return { text, result };
  }

  if (process.env.NODE_ENV !== "production") {
    console.info("[aiLanguage] retrying response with stricter language instruction", {
      language: normalizedLanguage,
    });
  }

  result = await generate(`${languageInstruction(normalizedLanguage)}

The previous response did not use the selected language. Rewrite the complete answer in the selected language. Preserve the exact JSON shape and English JSON keys.

${prompt}`);
  text = result.text;
  return { text, result };
}

function truncate(text: string, max: number) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\n…[truncated]";
}

function compactQuizContext(text: string, max: number) {
  const normalized = text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= max) return normalized;

  const sections = normalized
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter((section) => section.length > 40);

  if (sections.length < 4) return truncate(normalized, max);

  const budget = Math.max(1200, Math.floor(max / 3));
  const first = sections.slice(0, 8).join("\n\n");
  const middleStart = Math.max(0, Math.floor(sections.length / 2) - 4);
  const middle = sections.slice(middleStart, middleStart + 8).join("\n\n");
  const last = sections.slice(-8).join("\n\n");

  return [
    "BEGINNING EXCERPT:",
    truncate(first, budget),
    "MIDDLE EXCERPT:",
    truncate(middle, budget),
    "ENDING EXCERPT:",
    truncate(last, budget),
  ]
    .join("\n\n")
    .slice(0, max);
}

function uniqueStrings(values: string[], limit = 40) {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    items.push(trimmed);
    if (items.length >= limit) break;
  }
  return items;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeDifficulty(value: unknown): QuizDifficulty {
  const lower = String(value ?? "").toLowerCase().trim();
  if (VALID_DIFFICULTIES.includes(lower as QuizDifficulty)) return lower as QuizDifficulty;
  return "medium";
}

function clampCount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_QUESTION_COUNT;
  return Math.min(MAX_QUESTIONS, Math.max(MIN_QUESTIONS, Math.round(n)));
}

// ---------------------------------------------------------------------------
// JSON parsing (reuse the robust pattern from aiRevisionPlan)
// ---------------------------------------------------------------------------

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

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];

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
    if (depth === 0) return raw.slice(start, i + 1).trim();
  }

  return "";
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  const candidates = [
    stripJsonFence(raw),
    extractFirstJsonObject(stripJsonFence(raw)),
    extractFirstJsonObject(raw),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // try repair
      const repaired = candidate
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      try {
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        // continue to next candidate
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validate and normalize Gemini response into QuizQuestion[]
// ---------------------------------------------------------------------------

function textValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Normalise a raw question object from Gemini into a QuizQuestion, or return
 * null when it cannot be turned into a usable question (so the caller can drop
 * it instead of failing the whole quiz).
 */
function validateQuestion(raw: unknown, index: number, requestedTypes: QuizQuestionType[]): QuizQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  const question = textValue(record, "question", "prompt", "text", "stem");
  if (!question) return null;

  // Determine type: prefer the declared type, fall back to what the data
  // implies, then to the first requested type, then "mcq".
  const declared = String(record.type ?? record.question_type ?? record.kind ?? "").toLowerCase();
  const hasOptions = Array.isArray(record.options) || Array.isArray(record.choices);
  let type: QuizQuestionType;
  if (declared.includes("short") || declared.includes("sa")) type = "short";
  else if (declared.includes("mcq") || declared.includes("multiple") || declared.includes("choice")) type = "mcq";
  else type = hasOptions ? "mcq" : requestedTypes.includes("short") ? "short" : "mcq";

  const explanation = textValue(record, "explanation", "rationale", "explanation_text", "reason", "why");
  const topic = textValue(record, "topic", "subject", "concept") || "General review";
  const topicEn = textValue(record, "topic_en", "topicEnglish") || topic;
  const topicId = canonicalTopicId(textValue(record, "topic_id", "canonical_topic") || topicEn);

  if (type === "short") {
    // Accept several plausible key names for short-answer answer sets.
    const acceptable = uniqueStrings(
      stringList(record.acceptable_answers ?? record.acceptableAnswers ?? record.answers ?? record.answer ?? record.key),
      12,
    );
    if (!acceptable.length) return null;

    return {
      id: `q${index + 1}`,
      type: "short",
      question,
      topic,
      topic_id: topicId,
      topic_en: topicEn,
      options: [],
      correct_index: null,
      acceptable_answers: acceptable,
      explanation: explanation || `Acceptable answers: ${acceptable.slice(0, 3).join(", ")}.`,
    };
  }

  // MCQ
  const options = uniqueStrings(stringList(record.options ?? record.choices ?? record.answers), MAX_OPTIONS);
  if (options.length < MIN_OPTIONS) return null;

  // Resolve the correct option. Gemini may return an index, a letter, or the
  // option text itself — accept any of them.
  let correctIndex: number | null = null;
  const correctRaw = record.correct_index ?? record.correctIndex ?? record.correct ?? record.answer_index ?? record.answerIndex ?? record.answer;
  if (typeof correctRaw === "number") {
    correctIndex = correctRaw;
  } else if (typeof correctRaw === "string") {
    const trimmed = correctRaw.trim();
    const asNum = Number(trimmed);
    if (Number.isFinite(asNum)) {
      correctIndex = asNum;
    } else {
      const letterMatch = trimmed.match(/^[A-Da-d]\b/);
      if (letterMatch) {
        correctIndex = letterMatch[0].toUpperCase().charCodeAt(0) - 65;
      } else {
        const matchIndex = options.findIndex((opt) => opt.toLowerCase() === trimmed.toLowerCase());
        if (matchIndex >= 0) correctIndex = matchIndex;
      }
    }
  }

  if (typeof correctIndex !== "number" || correctIndex < 0 || correctIndex >= options.length) {
    // If we genuinely cannot resolve the correct option, drop the question.
    return null;
  }

  return {
    id: `q${index + 1}`,
    type: "mcq",
    question,
    topic,
    topic_id: topicId,
    topic_en: topicEn,
    options,
    correct_index: correctIndex,
    acceptable_answers: [],
    explanation: explanation || `Correct answer: ${options[correctIndex]}.`,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function buildTypeGuidance(questionTypes: QuizQuestionType[], count: number) {
  const wantsMcq = questionTypes.includes("mcq");
  const wantsShort = questionTypes.includes("short");

  if (wantsMcq && wantsShort) {
    return `Generate a mix of ${count} questions in total. Roughly two thirds multiple-choice (mcq) and one third short-answer (short).`;
  }
  if (wantsShort) {
    return `Generate exactly ${count} short-answer (short) questions. Do not include multiple-choice questions.`;
  }
  return `Generate exactly ${count} multiple-choice (mcq) questions. Do not include short-answer questions.`;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function generateQuiz(sourceText: string, options: QuizOptions = {}): Promise<GeneratedQuiz> {
  const requestedTypes = options.questionTypes && options.questionTypes.length ? options.questionTypes : (["mcq", "short"] as QuizQuestionType[]);
  const count = clampCount(options.count ?? DEFAULT_QUESTION_COUNT);
  const difficulty = normalizeDifficulty(options.difficulty);
  const text = compactQuizContext((sourceText || "").trim(), MAX_TEXT_CHARS);
  const focusTopics = uniqueStrings(options.focusTopics ?? [], 8);
  const language = options.language ?? DEFAULT_LANGUAGE;

  if (!text) {
    throw new Error("No readable text found to generate a quiz from. Try another file or add manual notes.");
  }

  devLog("generating quiz", {
    textLength: text.length,
    count,
    difficulty,
    types: requestedTypes,
  });

  const typeGuidance = buildTypeGuidance(requestedTypes, count);

  const prompt = `You are StudyPilot AI. Create a practice quiz for a college student from the study material below. Use ONLY the provided material. Do not invent topics, facts, or definitions that are not present.

Quiz requirements:
- ${typeGuidance}
- Difficulty: ${difficulty} (easy = recall; medium = apply/understand; hard = analyse/compare).
- Every question must be answerable from the material.
- Each multiple-choice question has 2 to 4 options with exactly ONE correct option.
- Each short-answer question has 1 to 5 acceptable answers.
- For every question, return topic_id as a stable English snake_case identifier, topic_en as the English topic name, and topic as the user-facing translated topic label.
- For short-answer questions in a non-English quiz, acceptable_answers must include valid answers in the selected language AND equivalent English answers.
- Write a clear, student-friendly explanation for every question explaining why the correct answer is correct (and, for MCQs, why the others are wrong when useful).
- Keep coverage balanced: about 70% of the quiz should test the overall chapter/module and about 30% may emphasize weak or focus topics.
- Do not generate only from weak topics unless the source material itself is narrowly about those topics.
${focusTopics.length ? `- Weak/focus topics for extra practice emphasis when present: ${focusTopics.join(", ")}.` : ""}
${options.personalizationNote ? `- Personalization note: ${options.personalizationNote}` : ""}

Return strict JSON only. Do not include markdown. The JSON shape must be:
{
  "title": "A short descriptive title for this quiz",
  "source_summary": "One or two sentences describing what material this quiz covers",
  "difficulty": "${difficulty}",
  "questions": [
    {
      "type": "mcq",
      "topic_id": "stable_english_topic_id",
      "topic_en": "English topic name",
      "topic": "The specific topic being tested",
      "question": "string",
      "options": ["string", "string", "string"],
      "correct_index": 0,
      "explanation": "string"
    },
    {
      "type": "short",
      "topic_id": "stable_english_topic_id",
      "topic_en": "English topic name",
      "topic": "The specific topic being tested",
      "question": "string",
      "acceptable_answers": ["string"],
      "explanation": "string"
    }
  ]
}

STUDY MATERIAL:
${text}`;

  const quizRun = await generateLocalizedQuizProviderRun(prompt, language, (localizedPrompt) =>
    generateAITextWithMetadata(localizedPrompt, {
      temperature: 0.4,
      maxOutputTokens: Math.min(1200 + count * 260, 5200),
      responseMimeType: "application/json",
    }),
  );
  assertUsableQuizProviderRun(quizRun, "quiz");
  const response = quizRun.text;

  devLog("AI quiz response received", {
    rawLength: response.length,
    provider: quizRun.result.provider,
    model: quizRun.result.model,
    responseMode: quizRun.result.responseMode,
    providerFailureCategory: quizRun.result.providerFailureCategory ?? null,
    geminiLatencyMs: quizRun.result.geminiLatencyMs ?? null,
    nvidiaLatencyMs: quizRun.result.nvidiaLatencyMs ?? null,
  });

  if (process.env.NODE_ENV !== "production") {
    console.log("[DEBUG] QUIZ raw AI response:", {
      rawLength: response.length,
      rawPreview: response.slice(0, 500),
      startsWithFence: response.trimStart().startsWith("```"),
      leadingProse: response.trimStart()[0] !== "{",
    });
  }

  let parsed = tryParseJson(response);
  if (!parsed) {
    if (!shouldAttemptQuizJsonRepair(quizRun)) {
      throw new Error(QUIZ_TIMEOUT_MESSAGE);
    }
    devLog("AI quiz JSON repair started", { rawLength: response.length });
    const repairRun = await generateAITextWithMetadata(
      `Repair the quiz payload below into one complete, valid JSON object.
Return JSON only, with no markdown or commentary. Preserve the original language and facts.
The object must contain title, source_summary, difficulty, and a questions array.
Each MCQ needs type, topic_id, topic_en, topic, question, options, correct_index, and explanation.
Each short-answer question needs type, topic_id, topic_en, topic, question, acceptable_answers, and explanation.
Discard an incomplete trailing question rather than inventing missing facts.

PAYLOAD TO REPAIR:
${response}`,
      {
        temperature: 0.1,
        maxOutputTokens: Math.min(1600 + count * 300, 5200),
        responseMimeType: "application/json",
      },
    );
    assertUsableQuizProviderRun({ text: repairRun.text, result: repairRun }, "repair");
    const repairedResponse = repairRun.text;
    parsed = tryParseJson(repairedResponse);
    devLog("AI quiz JSON repair completed", {
      repairedLength: repairedResponse.length,
      parsed: Boolean(parsed),
      provider: repairRun.provider,
      model: repairRun.model,
      responseMode: repairRun.responseMode,
      providerFailureCategory: repairRun.providerFailureCategory ?? null,
    });
  }
  if (!parsed) {
    throw new Error("AI returned a quiz format StudyPilot could not read. Please try again.");
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[DEBUG] QUIZ parsed JSON:", {
      parsedKeys: Object.keys(parsed),
      questionsCount: Array.isArray(parsed.questions) ? parsed.questions.length : 0,
    });
  }

  const title = String(parsed.title ?? parsed.quiz_title ?? "Practice quiz").trim() || "Practice quiz";
  const sourceSummary = String(parsed.source_summary ?? parsed.summary ?? "").trim() || "Generated from your study material.";
  const rawQuestions: unknown[] = Array.isArray(parsed.questions) ? parsed.questions : Array.isArray(parsed.quiz) ? parsed.quiz : [];
  const requestedTypesFinal = requestedTypes;

  const questions: QuizQuestion[] = (Array.isArray(rawQuestions) ? rawQuestions : [])
    .map((raw, index) => validateQuestion(raw, index, requestedTypesFinal))
    .filter((item): item is QuizQuestion => Boolean(item))
    // Renumber ids sequentially after dropping invalid questions.
    .map((item, index) => ({ ...item, id: `q${index + 1}` }))
    .slice(0, MAX_QUESTIONS);

  if (process.env.NODE_ENV !== "production") {
    console.log("[DEBUG] QUIZ validation:", {
      inputQuestions: rawQuestions.length,
      validQuestions: questions.length,
      minRequired: MIN_QUESTIONS,
    });
  }

  if (questions.length < MIN_QUESTIONS) {
    throw new Error("AI did not return enough valid questions. Please try again.");
  }

  devLog("quiz validated", {
    title,
    difficulty,
    questionCount: questions.length,
    mcqCount: questions.filter((q) => q.type === "mcq").length,
    shortCount: questions.filter((q) => q.type === "short").length,
  });

  return {
    title,
    difficulty,
    questions,
    source_summary: sourceSummary,
  };
}

// ---------------------------------------------------------------------------
// Answer-key extraction (kept consistent with the quizzes.answer_key column)
// ---------------------------------------------------------------------------

/**
 * Build the compact answer_key stored alongside questions. The client uses this
 * to grade attempts; storing it separately keeps the questions array clean.
 */
export function buildAnswerKey(questions: QuizQuestion[]) {
  return questions.map((q) => ({
    id: q.id,
    type: q.type,
    topic: q.topic,
    topic_id: q.topic_id,
    topic_en: q.topic_en,
    correct_index: q.correct_index,
    acceptable_answers: q.acceptable_answers,
    explanation: q.explanation,
  }));
}
