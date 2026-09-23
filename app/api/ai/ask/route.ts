import { after, NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { answerLearnStepByStep, answerStudyQuestion, type StructuredChatAnswer, type ChatAnswerWithMetadata } from "@/backend/lib/aiChat";
import { chunkDocument, selectRelevantChunks, type DocumentChunk } from "@/backend/lib/documentProcessing";
import { processStudyMaterial } from "@/backend/lib/studyMaterial";
import {
  formatCitationLocator,
  segmentTextWithCitations,
  uniqueSourceCitations,
  type CitationSourceType,
  type SourceCitation,
} from "@/backend/lib/sourceCitations";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";
import { getAiUserMessage, isAiBusyError, isAiQuotaError } from "@/backend/lib/aiProvider";
import { isGreeting, greetingResponse } from "@/backend/lib/greetingDetector";
import { buildLearnerProfile, buildPersonalizedChatContext, recommendWeakTopic } from "@/backend/lib/learnerProfile";
import { isSupportedLanguageCode, type SupportedLanguageCode } from "@/shared/languages";
import { enforceAiRateLimit } from "@/backend/lib/rateLimit";
import { applyGroundingValidation, unsupportedSelectedMaterialAnswer } from "@/backend/lib/ragGrounding";

export const runtime = "nodejs";

type AskBody = {
  question?: string;
  fileIds?: string[];
  noteIds?: string[];
  mode?: "study" | "learn_step_by_step";
  /** Optional. When supplied the exchange is stored inside this conversation. */
  conversationId?: string;
  /** Voice Tutor can speak from the response immediately while persistence runs after response. */
  deferPersistence?: boolean;
  language?: SupportedLanguageCode;
};

const CONVERSATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ContextItem = {
  id: string;
  label: string;
  type: "file" | "note" | "summary" | "previous_answer";
  text: string;
  source?: SourceChip["type"];
  sourceName?: string;
  citationSourceType?: CitationSourceType;
  citation?: SourceCitation;
};

type SourceChip = {
  id?: string;
  label: string;
  type: "Saved summary" | "Extracted text" | "Manual notes" | "Previous answer";
};

type ChatAnswerWithMode = StructuredChatAnswer & {
  response_mode?: "ai" | "cache" | "offline_fallback";
  fallback_notice?: string;
  source_chips?: SourceChip[];
  source_citations?: SourceCitation[];
};

const MAX_CONTEXT_CHARS = 12000;
const CHAT_CHUNK_CHARS = 2600;
const CHAT_CHUNK_OVERLAP_CHARS = 180;
const FULL_SELECTED_FILE_CONTEXT_CHARS = 5000;
const SELECTED_FILE_RELEVANCE_THRESHOLD = 1;
const DEFAULT_SELECTED_CHAT_CHUNKS = 4;
const BROAD_SELECTED_CHAT_CHUNKS = 8;
const OFFLINE_FALLBACK_MODE = "offline_fallback";
const OFFLINE_QUOTA_MESSAGE = "AI quota is temporarily reached, but I can still help from your saved notes and summaries.";

function isDev() {
  return process.env.NODE_ENV !== "production";
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (!isDev()) return;
  console.log(`[ask] ${message}`, details ?? "");
}

function logFileContextTrace(message: string, details: Record<string, unknown>) {
  console.log(`[ask:context] ${message}`, details);
}

function apiError(message: string, status = 500, debug?: Record<string, unknown>) {
  return NextResponse.json(
    {
      error: message,
      ...(isDev() && debug ? { debug } : {}),
    },
    { status },
  );
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : "AI request failed.";
  const lower = message.toLowerCase();
  const geminiMessage = getAiUserMessage(error);

  if (geminiMessage !== "AI request failed. Please try again.") {
    return geminiMessage;
  }

  if (lower.includes("ai service is not configured")) {
    return "AI service is not configured. Add GEMINI_API_KEY in .env.local.";
  }

  if (lower.includes("quota") || lower.includes("429") || lower.includes("free ai limit")) {
    return "Free AI limit reached. Please try again later.";
  }

  if (lower.includes("answer format") || lower.includes("json")) {
    return "AI returned an answer format StudyPilot could not read. Please try again.";
  }

  return message;
}

function isMissingColumnLike(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("column") || lower.includes("schema cache") || lower.includes("could not find");
}

function cleanIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))).slice(0, 8);
}

function tokens(question: string) {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2),
    ),
  );
}

function scoreText(queryTokens: string[], text: string) {
  const lower = text.toLowerCase();
  return queryTokens.reduce((score, token) => score + (lower.includes(token) ? 1 : 0), 0);
}

function idKey(ids: unknown) {
  return cleanIds(ids).sort().join("|");
}

function cleanSnippet(text: string, limit = 360) {
  return text.replace(/\s+/g, " ").trim().slice(0, limit).trim();
}

function splitSnippets(text: string) {
  const normalized = text.replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => cleanSnippet(item, 520))
    .filter((item) => item.length > 40);

  if (paragraphs.length >= 3) return paragraphs.slice(0, 80);

  return (normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [])
    .map((item) => cleanSnippet(item, 420))
    .filter((item) => item.length > 40)
    .slice(0, 80);
}

function sourceTypeForItem(item: ContextItem): SourceChip["type"] {
  if (item.source) return item.source;
  if (item.type === "summary") return "Saved summary";
  if (item.type === "note") return "Manual notes";
  if (item.type === "previous_answer") return "Previous answer";
  return "Extracted text";
}

function sourceChipsForItems(items: ContextItem[]) {
  const seen = new Set<string>();
  const chips: SourceChip[] = [];

  for (const item of items) {
    const chip = {
      id: item.id,
      label: item.label,
      type: sourceTypeForItem(item),
    };
    const key = `${chip.type}:${chip.id ?? chip.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push(chip);
    if (chips.length >= 10) break;
  }

  return chips;
}

function citationTypeForItem(item: ContextItem): CitationSourceType {
  if (item.citationSourceType) return item.citationSourceType;
  return item.type;
}

function citedSegmentsForItems(items: ContextItem[], maxChars = 5200) {
  return items.flatMap((item, itemIndex) =>
    segmentTextWithCitations({
      text: item.text,
      sourceId: item.id,
      sourceType: citationTypeForItem(item),
      sourceName: item.sourceName ?? item.label,
      maxChars,
      idPrefix: `chat-source-${itemIndex + 1}`,
    }),
  );
}

function isImportantNotesQuestion(question: string) {
  const lower = question.toLowerCase();
  return ["important notes", "imp notes", "key points", "important points", "summarize", "summary", "revise", "revision", "what should i revise"].some((phrase) =>
    lower.includes(phrase),
  );
}

function isRevisionQuestion(question: string) {
  const lower = question.toLowerCase();
  return lower.includes("revise") || lower.includes("revision") || lower.includes("what should i revise") || lower.includes("next topic");
}

export const CONTINUATION_PHRASES = [
  "next",
  "continue",
  "more",
  "next questions",
  "give me more",
  "continue this",
  "next one",
  "next batch",
  "more questions",
  "another",
  "keep going",
  "proceed",
] as const;

const CONTEXT_TRANSFORM_PHRASES = [
  "summarize it",
  "summarise it",
  "summary",
  "give me summary",
  "explain it",
  "explain this",
  "teach me this",
  "do it",
] as const;

export function requestedFollowUpCount(question: string): number | null {
  const lower = question.toLowerCase().trim();
  const match = lower.match(/^(?:next|another|give me)?\s*(\d{1,2})(?:\s+more)?(?:\s+questions?)?$/)
    ?? lower.match(/^(?:next|another|give me)\s+(\d{1,2})(?:\s+more)?(?:\s+questions?)?$/);
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isInteger(count) || count < 1 || count > 20) return null;
  return count;
}

export function isContinuationIntent(question: string): boolean {
  const lower = question.toLowerCase().trim();
  if (requestedFollowUpCount(lower) !== null) return true;
  // Use word boundary: phrase must be the first word (start of string), followed by space or end
  // But NOT followed by another word (e.g., "next topic" should not match)
  return CONTINUATION_PHRASES.some((phrase) => {
    if (lower === phrase) return true;
    if (lower.startsWith(`${phrase}?`) || lower.startsWith(`${phrase}.`)) return true;
    // Check if phrase is followed by space and then end of string, or just space (meaning it's the whole first word)
    // "next" -> "next " but not "next topic"
    // We need to check: phrase + space + (end of string OR another continuation word)
    const phraseWithSpace = `${phrase} `;
    if (lower.startsWith(phraseWithSpace)) {
      const rest = lower.slice(phraseWithSpace.length);
      // Allow if rest is empty, or rest is just continuation words like "questions", "batch", "one"
      // But NOT if rest is a topic like "topic", "file", "chapter", etc.
      if (!rest) return true;
      // Check if rest starts with a known continuation follow-up word
      const continuationFollowUps = ["questions", "question", "batch", "one", "step", "more", "please", "thanks", "thank you"];
      return continuationFollowUps.some(followUp => rest === followUp || rest.startsWith(`${followUp} `));
    }
    return false;
  });
}

export function isContextTransformFollowUp(question: string): boolean {
  const lower = question.toLowerCase().trim().replace(/[?.!]+$/g, "");
  return CONTEXT_TRANSFORM_PHRASES.some((phrase) => lower === phrase);
}

function contextTransformKind(question: string): "summarize" | "explain" | "teach" | null {
  const lower = question.toLowerCase().trim().replace(/[?.!]+$/g, "");
  if (lower === "summarize it" || lower === "summarise it" || lower === "summary" || lower === "give me summary") return "summarize";
  if (lower === "explain it" || lower === "explain this") return "explain";
  if (lower === "teach me this" || lower === "do it") return "teach";
  return null;
}

export type ActiveIntent =
  | "explain"
  | "summarize"
  | "exam_questions"
  | "viva_questions"
  | "learn_step"
  | "quiz"
  | "general_qa";

export function classifyIntent(question: string): ActiveIntent {
  const lower = question.toLowerCase();
  // Check viva questions first (more specific)
  if (lower.includes("viva question") || lower.includes("oral question") || lower.includes("viva voce") || lower.startsWith("oral exam")) {
    return "viva_questions";
  }
  if (lower.includes("exam question") || lower.includes("test question") || lower.includes("practice question") || /\b\d+\s+questions?\b/.test(lower)) {
    return "exam_questions";
  }
  if (lower.includes("learn step") || lower.includes("step by step") || lower.includes("teach me")) {
    return "learn_step";
  }
  if (lower.includes("quiz") || lower.includes("test me") || lower.includes("ask me question")) {
    return "quiz";
  }
  if (lower.includes("summarize") || lower.includes("summary") || lower.includes("summarise")) {
    return "summarize";
  }
  if (lower.includes("explain") || lower.includes("what is") || lower.includes("how does") || lower.includes("why does")) {
    return "explain";
  }
  return "general_qa";
}

function topicFromQuestion(question: string) {
  return question
    .replace(/\b(generate|give me|create|write|list|some|more|next|batch|questions?|exam|viva|oral|practice|test|quiz|teach me|learn|step by step|explain|summari[sz]e|summary|this|it)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function previousQuestionInstruction(previousQuestions: string[]) {
  const uniqueQuestions = Array.from(new Set(previousQuestions.map((item) => item.trim()).filter(Boolean))).slice(0, 12);
  if (!uniqueQuestions.length) return "";
  return ` Avoid repeating these previous questions: ${uniqueQuestions.map((item) => `"${item}"`).join("; ")}.`;
}

export function buildFollowUpQuestion(
  originalQuestion: string,
  intent: ActiveIntent,
  isNextBatch: boolean,
  options: {
    requestedCount?: number | null;
    transform?: "summarize" | "explain" | "teach" | null;
    previousQuestions?: string[];
  } = {},
): string {
  const base = originalQuestion.trim();
  if (!isNextBatch && !options.transform) return base;

  const topic = topicFromQuestion(base);
  const count = options.requestedCount ?? null;
  const examCountText = count ? `exactly ${count} additional` : "more";
  const duplicateInstruction = previousQuestionInstruction(options.previousQuestions ?? []);

  if (options.transform === "summarize") {
    const target = topic || base;
    return `Summarize the previous ${target} topic/answer using the same selected study material and citations.`;
  }
  if (options.transform === "explain") {
    const target = topic || base;
    return `Explain the previous ${target} topic/answer more clearly using the same selected study material and citations.`;
  }
  if (options.transform === "teach") {
    const target = topic || base;
    return `Teach the previous ${target} topic step by step using the same selected study material and citations.`;
  }

  switch (intent) {
    case "exam_questions":
      return `${base} - generate ${examCountText} exam questions that are different from the previous batch and avoid repeating previous ones.${duplicateInstruction}`;
    case "viva_questions":
      return `${base} - generate ${examCountText} viva questions that are different from the previous batch and avoid repeating previous ones.${duplicateInstruction}`;
    case "learn_step":
      return `Continue the previous step-by-step lesson: ${base}. Give the next step only.`;
    case "quiz":
      return `${base} - give ${examCountText} quiz questions that are different from the previous batch and avoid repeating previous ones.${duplicateInstruction}`;
    case "explain":
      return `${base} - continue explaining this topic with more depth, using the same selected study material and citations.`;
    case "summarize":
      return `${base} - continue the summary with more useful details from the same selected study material and citations.`;
    default:
      return `${base} - continue with more useful content from the same selected study material and citations.`;
  }
}

export async function getLastMeaningfulUserQuestion({
  supabase,
  userId,
  conversationId,
  language,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  conversationId: string | null;
  language: SupportedLanguageCode;
}): Promise<{ question: string; intent: ActiveIntent; previousQuestions: string[] } | null> {
  if (!supabase || !conversationId) return null;

  const { data, error } = await supabase
    .from("assistant_questions")
    .select("question, answer")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .eq("language_code", language)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error || !data?.length) return null;

  const previousQuestions: string[] = [];
  for (const row of data) {
    previousQuestions.push(...extractGeneratedQuestions(row.answer));
    const q = String(row.question ?? "").trim();
    if (!q) continue;
    if (isContinuationIntent(q)) continue;
    if (isContextTransformFollowUp(q)) continue;
    if (isGreeting(q)) continue;
    return { question: q, intent: classifyIntent(q), previousQuestions };
  }
  return null;
}

// General, file-wide questions that must read the full extracted text instead of a
// stale narrow cached answer or a previously-saved summary. These questions ask about
// the whole attachment ("explain this PDF", "give important notes"), so any previous
// answer tied to the same question+file is likely a stale, narrow snapshot.
function isBroadFileQuestion(question: string) {
  const lower = question.toLowerCase().trim();
  if (!lower) return false;

  const broadPhrases = [
    "important notes",
    "imp notes",
    "key points",
    "important points",
    "main points",
    "summary of",
    "summarize",
    "summarise",
    "short notes",
    "explain this",
    "explain the",
    "explain this pdf",
    "explain this document",
    "explain the pdf",
    "explain this file",
    "what is this",
    "what is in this",
    "overview of",
    "give me notes",
    "give notes",
    "all topics",
    "covered topics",
    "what are the topics",
    "list the topics",
  ];

  if (broadPhrases.some((phrase) => lower.includes(phrase))) return true;

  // Bare, file-level prompts with no specific subject: "notes", "explain", "summary"
  const stripped = lower.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const singleWordBroad = ["notes", "summary", "explain", "overview", "topics", "revise", "revision"];
  return stripped.split(" ").length <= 2 && singleWordBroad.some((word) => stripped === word || stripped.startsWith(`${word} `));
}

function pickRelevantSnippets(question: string, items: ContextItem[]) {
  const queryTokens = tokens(question);
  const segments = citedSegmentsForItems(items, 4200);
  const ranked = segments.flatMap((segment, segmentIndex) =>
    splitSnippets(segment.text).map((snippet, snippetIndex) => ({
      citation: segment.citation,
      snippet,
      score:
        scoreText(queryTokens, `${segment.citation.source_name}\n${snippet}`) * 12 +
        Math.max(0, 8 - segmentIndex) +
        Math.max(0, 4 - snippetIndex),
    })),
  );

  return ranked
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(({ citation, snippet }) => ({
      label: formatCitationLocator(citation),
      citation,
      text: cleanSnippet(snippet, 420),
    }));
}

function answerToContextText(answer: unknown) {
  if (!answer) return "";
  if (typeof answer === "string") return answer.trim();
  if (typeof answer !== "object") return "";

  const record = answer as Record<string, unknown>;
  return [
    record.short_answer,
    record.simple_explanation,
    ...(asStringList(record.step_by_step) ?? []),
    record.example,
    record.memory_line,
    record.common_mistake,
    record.exam_viva_answer,
    record.practice_question,
    ...(asStringList(record.related_files_notes) ?? []),
    record.next_step,
  ]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function normalizeGeneratedQuestion(text: string) {
  return text
    .toLowerCase()
    .replace(/^\s*(?:\d+[\).:-]|[-*])\s*/, "")
    .replace(/[^a-z0-9?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGeneratedQuestions(answer: unknown) {
  const text = answerToContextText(answer);
  if (!text) return [];

  const seen = new Set<string>();
  const questions: string[] = [];
  for (const rawLine of text.split(/\r?\n|(?<=\?)\s+(?=\d+[\).:-]\s*)/g)) {
    const line = rawLine.replace(/^\s*(?:\d+[\).:-]|[-*])\s*/, "").trim();
    if (!line || !line.includes("?")) continue;
    const question = line.split("?")[0]?.trim();
    if (!question) continue;
    const normalized = normalizeGeneratedQuestion(`${question}?`);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    questions.push(`${question}?`);
  }
  return questions;
}

function buildOfflineFallbackAnswer({
  question,
  contextItems,
}: {
  question: string;
  contextItems: ContextItem[];
}): ChatAnswerWithMode {
  // Greetings are handled upstream and never reach the fallback builder.
  // Guard here as a safety net.
  if (isGreeting(question)) {
    const msg = greetingResponse(question);
    return {
      response_mode: OFFLINE_FALLBACK_MODE,
      fallback_notice: undefined,
      source_chips: [],
      source_citations: [],
      short_answer: msg,
      simple_explanation: msg,
      step_by_step: [],
      example: "",
      memory_line: "",
      common_mistake: "",
      exam_viva_answer: "",
      practice_question: "",
      related_files_notes: [],
      next_step: "",
    };
  }

  // Deduplicate context items by text content.
  const seenTexts = new Set<string>();
  const uniqueItems = contextItems.filter((item) => {
    if (!item.text) return false;
    if (item.text.toLowerCase().includes("no readable extracted text")) return false;
    // Use first 120 chars as dedup key to catch near-identical chunks.
    const key = item.text.slice(0, 120).trim();
    if (seenTexts.has(key)) return false;
    seenTexts.add(key);
    return true;
  });

  const sources = sourceChipsForItems(uniqueItems);
  const snippets = pickRelevantSnippets(question, uniqueItems);
  const citations = uniqueSourceCitations(snippets.map((snippet) => snippet.citation), 8);
  const importantMode = isImportantNotesQuestion(question);
  const revisionMode = isRevisionQuestion(question);
  const related = sources.map((source) => `${source.type}: ${source.label}`);

  if (!snippets.length) {
    return {
      response_mode: OFFLINE_FALLBACK_MODE,
      fallback_notice: OFFLINE_QUOTA_MESSAGE,
      source_chips: sources,
      source_citations: citations,
      short_answer: "I couldn't find this in your saved study material. Try asking a specific question or use Web Search.",
      simple_explanation:
        "AI quota is temporarily reached. StudyPilot checked your saved files, notes, and summaries but did not find enough content for this question. Try attaching a specific file or asking a narrower question.",
      step_by_step: [
        "Attach the relevant file or note and retry.",
        "Add manual notes for the topic you want to revise.",
        "Use Web Search for general knowledge questions.",
      ],
      example: "",
      memory_line: "",
      common_mistake: "",
      exam_viva_answer: "",
      practice_question: "",
      related_files_notes: related,
      next_step: "Retry AI in a few seconds, or attach a specific file for focused help.",
    };
  }

  const bullets = snippets.map((snippet) => `${snippet.text} (${snippet.label})`).slice(0, importantMode ? 7 : 5);
  const first = snippets[0];

  return {
    response_mode: OFFLINE_FALLBACK_MODE,
    fallback_notice: OFFLINE_QUOTA_MESSAGE,
    source_chips: sources,
    source_citations: citations,
    short_answer: first.text,
    simple_explanation: [
      "Based on your saved study material, here are the most relevant parts found:",
      ...bullets.map((bullet) => `- ${bullet}`),
    ].join("\n\n"),
    step_by_step: revisionMode
      ? bullets.map((bullet, index) => `${index + 1}. Revise: ${bullet}`)
      : importantMode
        ? bullets.map((bullet) => `Focus on: ${bullet}`)
        : bullets,
    example: importantMode ? "Use these points as quick revision notes." : first.text,
    memory_line: "",
    common_mistake: "",
    exam_viva_answer: bullets.slice(0, 4).join(" "),
    practice_question: revisionMode ? "Explain the first revision topic in your own words." : "What is the main idea behind the most important point above?",
    related_files_notes: related,
    next_step: revisionMode
      ? "Revise the listed topics, then retry AI for a deeper explanation or quiz."
      : "Retry AI in a few seconds for a richer answer, or attach the specific file.",
  };
}

function asStringList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
}

function parseSummaryContent(content: unknown) {
  if (typeof content !== "string" || !content.trim()) return null;
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function summaryToContextText(summary: Record<string, unknown>) {
  const content = parseSummaryContent(summary.content);
  const merged = { ...(content ?? {}), ...summary };
  const topicWise = Array.isArray(merged.topic_wise_summary)
    ? merged.topic_wise_summary
        .map((item) => {
          if (!item || typeof item !== "object") return "";
          const record = item as Record<string, unknown>;
          return [
            `Topic: ${String(record.topic ?? "").trim()}`,
            String(record.explanation ?? "").trim(),
            ...asStringList(record.important_points),
          ]
            .filter(Boolean)
            .join("\n");
        })
        .filter(Boolean)
    : [];

  return [
    merged.suggested_title ? `Title: ${String(merged.suggested_title)}` : "",
    merged.short_summary ? `Short summary: ${String(merged.short_summary)}` : "",
    merged.module_overview ? `Module overview: ${String(merged.module_overview)}` : "",
    asStringList(merged.covered_topics).length ? `Covered topics:\n${asStringList(merged.covered_topics).join("\n")}` : "",
    asStringList(merged.key_points).length ? `Key points:\n${asStringList(merged.key_points).join("\n")}` : "",
    topicWise.length ? `Topic-wise summary:\n${topicWise.join("\n\n")}` : "",
    asStringList(merged.exam_focus_points).length ? `Exam focus:\n${asStringList(merged.exam_focus_points).join("\n")}` : "",
    asStringList(merged.important_concepts).length ? `Important concepts:\n${asStringList(merged.important_concepts).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function getLatestSummaryTextByFileId({
  supabase,
  userId,
  fileIds,
  language,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  fileIds: string[];
  language: SupportedLanguageCode;
}) {
  const summaries = new Map<string, string>();
  if (!supabase || !fileIds.length) return summaries;

  const uniqueFileIds = Array.from(new Set(fileIds));
  const fullColumns =
    "id, suggested_title, short_summary, key_points, important_concepts, file_id, created_at, content, module_overview, covered_topics, topic_wise_summary, exam_focus_points";
  const baseColumns = "id, suggested_title, short_summary, key_points, important_concepts, file_id, created_at";

  const fullResult = await supabase
    .from("ai_outputs")
    .select(fullColumns)
    .eq("user_id", userId)
    .eq("language_code", language)
    .in("file_id", uniqueFileIds)
    .order("created_at", { ascending: false });

  let rows = (fullResult.data ?? []) as Record<string, unknown>[];

  if (fullResult.error) {
    const baseResult = await supabase
      .from("ai_outputs")
      .select(baseColumns)
      .eq("user_id", userId)
      .eq("language_code", language)
      .in("file_id", uniqueFileIds)
      .order("created_at", { ascending: false });

    if (baseResult.error) return summaries;
    rows = (baseResult.data ?? []) as Record<string, unknown>[];
  }

  for (const row of rows) {
    const fileId = typeof row.file_id === "string" ? row.file_id : "";
    if (!fileId || summaries.has(fileId)) continue;

    const text = summaryToContextText(row);
    if (text) summaries.set(fileId, text);
    if (summaries.size === uniqueFileIds.length) break;
  }

  return summaries;
}

function prepareCitedContext(items: ContextItem[], question: string) {
  let remaining = MAX_CONTEXT_CHARS;
  const sections: string[] = [];
  const queryTokens = tokens(question);
  const preserveDocumentOrder = isBroadFileQuestion(question);
  const directSegments = items
    .filter((item) => item.citation)
    .map((item, index) => ({
      text: item.text,
      citation: item.citation!,
      index,
      score: scoreText(queryTokens, `${item.citation!.source_name}\n${item.text}`),
    }));
  const segmented = citedSegmentsForItems(items.filter((item) => !item.citation))
    .map((segment, index) => ({
      ...segment,
      index: directSegments.length + index,
      score: scoreText(queryTokens, `${segment.citation.source_name}\n${segment.text}`),
    }));
  const segments = [...directSegments, ...segmented]
    .sort((a, b) => (preserveDocumentOrder ? a.index - b.index : b.score - a.score || a.index - b.index));
  const citations: SourceCitation[] = [];

  for (const segment of segments) {
    if (remaining <= 0) break;
    const sourceLabel = formatCitationLocator(segment.citation);
    const sourceId = segment.citation.id;
    const body = segment.text.trim().slice(0, Math.max(0, remaining - sourceLabel.length - 20));
    if (!body) continue;
    const section = `[SOURCE id="${sourceId}"] ${sourceLabel}\n${body}`;
    sections.push(section);
    citations.push(segment.citation);
    remaining -= section.length;
  }

  return {
    text: sections.join("\n\n---\n\n"),
    citations: uniqueSourceCitations(citations, 8),
  };
}

function slideRangeForChunk(text: string) {
  const slides = [...text.matchAll(/(?:^|\n)Slide\s+(\d+):/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  if (!slides.length) return null;
  return { start: Math.min(...slides), end: Math.max(...slides) };
}

function citationForChunk(file: { id: string; file_name: string }, chunk: DocumentChunk): SourceCitation {
  const slideRange = slideRangeForChunk(chunk.text);
  if (slideRange) {
    return {
      id: chunk.id,
      source_id: file.id,
      source_type: "file",
      source_name: file.file_name,
      locator_type: "slide",
      locator_start: slideRange.start,
      locator_end: slideRange.end,
    };
  }

  if (chunk.startPage) {
    return {
      id: chunk.id,
      source_id: file.id,
      source_type: "file",
      source_name: file.file_name,
      locator_type: "page",
      locator_start: chunk.startPage,
      locator_end: chunk.endPage ?? chunk.startPage,
    };
  }

  return {
    id: chunk.id,
    source_id: file.id,
    source_type: "file",
    source_name: file.file_name,
    locator_type: "chunk",
    locator_start: chunk.index + 1,
    locator_end: chunk.index + 1,
  };
}

async function updateFileAfterExtraction({
  supabase,
  fileId,
  userId,
  values,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  fileId: string;
  userId: string;
  values: Record<string, unknown>;
}) {
  if (!supabase) return;
  const result = await supabase.from("files").update(values).eq("id", fileId).eq("user_id", userId);
  if (!result.error) return;

  if (!isMissingColumnLike(result.error.message)) return;

  const legacyValues = Object.fromEntries(
    Object.entries(values).filter(([key]) => !["content_type", "processing_notes", "extracted_metadata"].includes(key)),
  );
  await supabase.from("files").update(legacyValues).eq("id", fileId).eq("user_id", userId);
}

async function getSelectedFileContext({
  supabase,
  userId,
  fileIds,
  question,
  broadQuestion,
  language,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  fileIds: string[];
  question: string;
  broadQuestion: boolean;
  language: SupportedLanguageCode;
}) {
  if (!supabase || !fileIds.length) return [];

  const { data, error } = await supabase
    .from("files")
    .select("id, user_id, file_name, mime_type, storage_path, extracted_text")
    .eq("user_id", userId)
    .in("id", fileIds);

  if (error) throw error;

  const items: ContextItem[] = [];
  const summaryTextByFileId = await getLatestSummaryTextByFileId({
    supabase,
    userId,
    fileIds: (data ?? []).map((file) => file.id),
    language,
  });

  for (const file of data ?? []) {
    let text = String(file.extracted_text ?? "").trim();
    const summaryText = summaryTextByFileId.get(file.id) ?? "";

    if (!text && file.storage_path) {
      devLog("selected file needs extraction", { fileId: file.id, fileName: file.file_name });
      await updateFileAfterExtraction({
        supabase,
        fileId: file.id,
        userId,
        values: { processing_status: "extracting", status: "extracting" },
      });

      const download = await supabase.storage.from("study-files").download(file.storage_path);
      if (!download.error) {
        const buffer = Buffer.from(await download.data.arrayBuffer());
        try {
          const processed = await processStudyMaterial({
            buffer,
            fileName: file.file_name,
            mimeType: file.mime_type || download.data.type || "",
            userId,
          });

          text = processed.extractedText.trim();
          await updateFileAfterExtraction({
            supabase,
            fileId: file.id,
            userId,
            values: {
              extracted_text: text || null,
              processing_status: text ? "extracted" : "failed",
              status: text ? "extracted" : "failed",
              chunks_count: processed.chunksCount,
              content_type: processed.contentType,
              processing_notes: processed.processingNotes,
              extracted_metadata: processed.documentMetadata,
            },
          });
        } catch (error) {
          if (!isAiQuotaError(error) && !isAiBusyError(error)) throw error;
          devLog("selected file extraction skipped because AI is limited", {
            fileId: file.id,
            error: getAiUserMessage(error),
          });
        }
      } else {
        devLog("selected file storage download failed", { fileId: file.id, error: download.error.message });
      }
    }

    if (text) {
      const chunks = chunkDocument(text, {
        sourceId: file.id,
        dedupe: true,
        maxChars: CHAT_CHUNK_CHARS,
        overlapChars: CHAT_CHUNK_OVERLAP_CHARS,
      });
      const selectedChunks = text.length <= FULL_SELECTED_FILE_CONTEXT_CHARS && !broadQuestion
        ? chunks
        : selectRelevantChunks({
            chunks,
            query: question,
            maxChunks: broadQuestion ? BROAD_SELECTED_CHAT_CHUNKS : DEFAULT_SELECTED_CHAT_CHUNKS,
            preserveOrder: broadQuestion,
            minScore: broadQuestion ? 0 : SELECTED_FILE_RELEVANCE_THRESHOLD,
          });
      const selectedScores = selectedChunks.map((chunk) => ({
        chunkId: chunk.id,
        index: chunk.index,
        score: scoreText(tokens(question), chunk.text),
        startPage: chunk.startPage,
        endPage: chunk.endPage,
      }));
      devLog("selected file retrieval", {
        selectedFileId: file.id,
        selectedFileName: file.file_name,
        extractedTextLength: text.length,
        availableChunks: chunks.length,
        selectedChunkCount: selectedChunks.length,
        selectedChunkIds: selectedChunks.map((chunk) => chunk.id),
        selectedScores,
        promptBudgetChars: MAX_CONTEXT_CHARS,
        chunkChars: CHAT_CHUNK_CHARS,
        fullTextUsed: text.length <= FULL_SELECTED_FILE_CONTEXT_CHARS && !broadQuestion,
      });

      for (const chunk of selectedChunks) {
        const citation = citationForChunk(file, chunk);
        items.push({
          id: file.id,
          type: "file",
          label: file.file_name,
          sourceName: file.file_name,
          text: chunk.text,
          source: "Extracted text",
          citation,
        });
      }
      continue;
    }

    if (summaryText) {
      items.push({
        id: `${file.id}:summary`,
        type: "summary",
        label: `${file.file_name} summary`,
        sourceName: file.file_name,
        text: summaryText,
        source: "Saved summary",
        citationSourceType: "summary",
      });
    } else {
      devLog("selected file has no readable context", {
        selectedFileId: file.id,
        selectedFileName: file.file_name,
      });
    }
  }

  return items;
}

async function getSelectedNoteContext({
  supabase,
  userId,
  noteIds,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  noteIds: string[];
}) {
  if (!supabase || !noteIds.length) return [];

  const { data, error } = await supabase
    .from("notes")
    .select("id, title, topic, raw_notes, content")
    .eq("user_id", userId)
    .in("id", noteIds);

  if (error) throw error;

  return (data ?? []).map((note) => ({
    id: note.id,
    type: "note" as const,
    label: note.title ?? note.topic ?? "Manual note",
    sourceName: note.title ?? note.topic ?? "Manual note",
    text: String(note.raw_notes ?? note.content ?? "").trim(),
    source: "Manual notes" as const,
  }));
}

async function getKeywordContext({
  supabase,
  userId,
  question,
  language,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  question: string;
  language: SupportedLanguageCode;
}) {
  if (!supabase) return [];
  const queryTokens = tokens(question);

  const [filesResult, notesResult] = await Promise.all([
    supabase
      .from("files")
      .select("id, file_name, extracted_text, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("notes")
      .select("id, title, topic, raw_notes, content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const summariesResult = await supabase
    .from("ai_outputs")
    .select("id, suggested_title, short_summary, key_points, important_concepts, content, file_id, note_id, created_at")
    .eq("user_id", userId)
    .eq("language_code", language)
    .order("created_at", { ascending: false })
    .limit(20);
  let summaryRows = (summariesResult.data ?? []) as Record<string, unknown>[];
  let summaryError = summariesResult.error;

  if (summariesResult.error && isMissingColumnLike(summariesResult.error.message)) {
    const fallbackSummaries = await supabase
      .from("ai_outputs")
      .select("id, suggested_title, short_summary, key_points, important_concepts, file_id, note_id, created_at")
      .eq("user_id", userId)
      .eq("language_code", language)
      .order("created_at", { ascending: false })
      .limit(20);
    summaryRows = (fallbackSummaries.data ?? []) as Record<string, unknown>[];
    summaryError = fallbackSummaries.error;
  }

  if (filesResult.error) throw filesResult.error;
  if (notesResult.error) throw notesResult.error;
  if (summaryError) throw summaryError;

  const candidates: ContextItem[] = [
    ...(filesResult.data ?? []).map((file) => ({
      id: file.id,
      type: "file" as const,
      label: file.file_name,
      sourceName: file.file_name,
      text: String(file.extracted_text ?? "").trim(),
      source: "Extracted text" as const,
    })),
    ...(notesResult.data ?? []).map((note) => ({
      id: note.id,
      type: "note" as const,
      label: note.title ?? note.topic ?? "Manual note",
      sourceName: note.title ?? note.topic ?? "Manual note",
      text: String(note.raw_notes ?? note.content ?? "").trim(),
      source: "Manual notes" as const,
    })),
    ...summaryRows.map((summary) => ({
      id: String(summary.id),
      type: "summary" as const,
      label: String(summary.suggested_title ?? "Saved summary"),
      sourceName:
        (summary.file_id
          ? (filesResult.data ?? []).find((file) => file.id === summary.file_id)?.file_name
          : summary.note_id
            ? (notesResult.data ?? []).find((note) => note.id === summary.note_id)?.title
            : null) ?? String(summary.suggested_title ?? "Saved summary"),
      text: summaryToContextText(summary),
      source: "Saved summary" as const,
    })),
  ].filter((item) => item.text);

  return candidates
    .map((item, index) => ({
      item,
      score: scoreText(queryTokens, `${item.label}\n${item.text}`) * 10 + Math.max(0, 8 - index),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ item }) => item);
}

async function getGlobalFallbackContext({
  supabase,
  userId,
  question,
  language,
  excludeFileIds = [],
  excludeNoteIds = [],
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  question: string;
  language: SupportedLanguageCode;
  excludeFileIds?: string[];
  excludeNoteIds?: string[];
}) {
  if (!supabase) return [];
  const queryTokens = tokens(question);

  const [filesResult, notesResult] = await Promise.all([
    supabase
      .from("files")
      .select("id, file_name, extracted_text, created_at")
      .eq("user_id", userId)
      .not("id", "in", `(${excludeFileIds.map(() => "?").join(",")})`)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("notes")
      .select("id, title, topic, raw_notes, content, created_at")
      .eq("user_id", userId)
      .not("id", "in", `(${excludeNoteIds.map(() => "?").join(",")})`)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const summariesResult = await supabase
    .from("ai_outputs")
    .select("id, suggested_title, short_summary, key_points, important_concepts, content, file_id, note_id, created_at")
    .eq("user_id", userId)
    .eq("language_code", language)
    .order("created_at", { ascending: false })
    .limit(20);
  let summaryRows = (summariesResult.data ?? []) as Record<string, unknown>[];
  let summaryError = summariesResult.error;

  if (summariesResult.error && isMissingColumnLike(summariesResult.error.message)) {
    const fallbackSummaries = await supabase
      .from("ai_outputs")
      .select("id, suggested_title, short_summary, key_points, important_concepts, file_id, note_id, created_at")
      .eq("user_id", userId)
      .eq("language_code", language)
      .order("created_at", { ascending: false })
      .limit(20);
    summaryRows = (fallbackSummaries.data ?? []) as Record<string, unknown>[];
    summaryError = fallbackSummaries.error;
  }

  if (filesResult.error) throw filesResult.error;
  if (notesResult.error) throw notesResult.error;
  if (summaryError) throw summaryError;

  const candidates: ContextItem[] = [
    ...(filesResult.data ?? []).map((file) => ({
      id: file.id,
      type: "file" as const,
      label: file.file_name,
      sourceName: file.file_name,
      text: String(file.extracted_text ?? "").trim(),
      source: "Extracted text" as const,
    })),
    ...(notesResult.data ?? []).map((note) => ({
      id: note.id,
      type: "note" as const,
      label: note.title ?? note.topic ?? "Manual note",
      sourceName: note.title ?? note.topic ?? "Manual note",
      text: String(note.raw_notes ?? note.content ?? "").trim(),
      source: "Manual notes" as const,
    })),
    ...summaryRows.map((summary) => ({
      id: String(summary.id),
      type: "summary" as const,
      label: String(summary.suggested_title ?? "Saved summary"),
      sourceName:
        (summary.file_id
          ? (filesResult.data ?? []).find((file) => file.id === summary.file_id)?.file_name
          : summary.note_id
            ? (notesResult.data ?? []).find((note) => note.id === summary.note_id)?.title
            : null) ?? String(summary.suggested_title ?? "Saved summary"),
      text: summaryToContextText(summary),
      source: "Saved summary" as const,
    })),
  ].filter((item) => item.text);

  return candidates
    .map((item, index) => ({
      item,
      score: scoreText(queryTokens, `${item.label}\n${item.text}`) * 10 + Math.max(0, 8 - index),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ item }) => item);
}

async function getPreviousAnswerContext({
  supabase,
  userId,
  question,
  conversationId,
  language,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  question: string;
  /** When set, previous-answer context is scoped to this conversation only. */
  conversationId: string | null;
  language: SupportedLanguageCode;
}) {
  if (!supabase) return [];

  // Build query — always filter by user_id for RLS belt-and-suspenders.
  let query = supabase
    .from("assistant_questions")
    .select("id, question, answer, created_at")
    .eq("user_id", userId)
    .eq("language_code", language)
    .order("created_at", { ascending: false })
    .limit(12);

  if (conversationId) {
    // Scoped mode: only messages from this conversation form the context.
    // This prevents cross-conversation context contamination.
    query = query.eq("conversation_id", conversationId);
  } else {
    // Legacy mode (no conversationId): use messages that have no conversation
    // assigned, preserving backward compatibility for old Q&A rows.
    query = query.is("conversation_id", null);
  }

  const { data, error } = await query;

  if (error) {
    devLog("previous answer context skipped", { error: error.message });
    return [];
  }

  return (data ?? [])
    .filter((row) => String(row.question ?? "").trim().toLowerCase() !== question.trim().toLowerCase())
    .map((row) => ({
      id: row.id,
      type: "previous_answer" as const,
      label: `Previous answer: ${String(row.question ?? "Study question").slice(0, 80)}`,
      sourceName: `Previous answer: ${String(row.question ?? "Study question").slice(0, 80)}`,
      text: answerToContextText(row.answer),
      source: "Previous answer" as const,
    }))
    .filter((item) => item.text)
    .slice(0, 5);
}

async function getLearnerProfileForChat({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
}) {
  if (!supabase) return buildLearnerProfile([]);
  const { data, error } = await supabase
    .from("quiz_attempts")
    .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, wrong_questions, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    devLog("learner profile skipped for chat", { error: error.message });
    return buildLearnerProfile([]);
  }

  return buildLearnerProfile(data ?? []);
}

async function getCachedAnswer({
  supabase,
  userId,
  question,
  fileIds,
  noteIds,
  conversationId,
  language,
}: {
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>;
  userId: string;
  question: string;
  fileIds: string[];
  noteIds: string[];
  /** Scope cache lookup to this conversation to avoid cross-conversation hits. */
  conversationId: string | null;
  language: SupportedLanguageCode;
}) {
  if (!supabase) return null;
  if (!fileIds.length && !noteIds.length) return null;

  const expectedFileKey = idKey(fileIds);
  const expectedNoteKey = idKey(noteIds);

  let query = supabase
    .from("assistant_questions")
    .select("id, question, answer, related_file_ids, related_note_ids, created_at")
    .eq("user_id", userId)
    .eq("question", question)
    .eq("language_code", language)
    .order("created_at", { ascending: false })
    .limit(12);

  // Scope cache to the current conversation so an answer from another
  // conversation (or from the legacy pool) is never surfaced as a cache hit.
  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  } else {
    query = query.is("conversation_id", null);
  }

  const { data, error } = await query;

  if (error) throw error;

  const cached = (data ?? []).find((row) => idKey(row.related_file_ids) === expectedFileKey && idKey(row.related_note_ids) === expectedNoteKey);
  if (!cached?.answer) return null;

  const answer =
    cached.answer && typeof cached.answer === "object"
      ? ({ ...(cached.answer as Record<string, unknown>), response_mode: "cache" } as ChatAnswerWithMode)
      : cached.answer;

  devLog("answer cache hit", {
    questionLength: question.length,
    fileCount: fileIds.length,
    noteCount: noteIds.length,
    cachedId: cached.id,
  });

  return {
    ...cached,
    answer,
  };
}

async function handlePost(request: Request) {
  const requestStartedAt = Date.now();
  const timings: Record<string, number> = {};
  const measure = async <T,>(name: string, task: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await task();
    } finally {
      timings[name] = (timings[name] ?? 0) + Date.now() - startedAt;
    }
  };
  const timingDebug = () => ({ ...timings, total: Date.now() - requestStartedAt });

  const user = await measure("authentication", () => requireUser());
  if (!user) return apiError("Please log in first.", 401);
  const rateLimited = enforceAiRateLimit(user.id);
  if (rateLimited) return rateLimited;

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  let body: AskBody;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const question = body.question?.trim();
  if (body.language !== undefined && !isSupportedLanguageCode(body.language)) {
    return apiError("Choose a supported language.", 400);
  }
  let language = body.language ?? user.preferredLanguage;
  const requestMode = body.mode === "learn_step_by_step" ? "learn_step_by_step" : "study";
  let fileIds = cleanIds(body.fileIds);
  let noteIds = cleanIds(body.noteIds);
  const debug: Record<string, unknown> = { fileCount: fileIds.length, noteCount: noteIds.length, requestMode };

  if (!question) return apiError("Ask a question first.", 400);

  // ── Conversation ownership validation ──────────────────────────────────
  // If the client supplies a conversationId we verify it belongs to this user
  // before using it. An invalid or foreign ID is rejected — it is never
  // silently ignored, which would cause messages to float into the legacy pool.
  const rawConversationId = body.conversationId?.trim() ?? null;
  let conversationId: string | null = null;
  let conversationContextMode: string | null = null;

  if (rawConversationId) {
    if (!CONVERSATION_ID_RE.test(rawConversationId)) {
      return apiError("conversationId is not a valid UUID.", 400);
    }
    // Double-check ownership (RLS also enforces this, but we want a clean 404).
    const { data: convo, error: convoError } = await measure("conversation_loading", async () =>
      await supabase
        .from("conversations")
        .select("id, context_mode, active_file_ids, active_note_ids, language_code")
        .eq("id", rawConversationId)
        .eq("user_id", user.id)
        .maybeSingle(),
    );

    if (convoError) {
      return apiError("Could not verify conversation ownership.", 500);
    }
    if (!convo) {
      return apiError("Conversation not found.", 404);
    }
    conversationId = rawConversationId;
    conversationContextMode = typeof convo.context_mode === "string" ? convo.context_mode : "general";
    if (body.language === undefined && isSupportedLanguageCode(convo.language_code)) {
      language = convo.language_code;
    }

    if (conversationContextMode === "file" || conversationContextMode === "image") {
      fileIds = cleanIds(convo.active_file_ids);
      noteIds = cleanIds(convo.active_note_ids);
    } else {
      fileIds = [];
      noteIds = [];
    }
    debug.fileCount = fileIds.length;
    debug.noteCount = noteIds.length;
    debug.contextMode = conversationContextMode;
  }
  // ──────────────────────────────────────────────────────────────────────

  // ── Continuation intent resolution ──────────────────────────────────────
  // If the user says "next", "continue", "more", etc., resolve it against the
  // last meaningful question in this conversation to inherit the active task.
  let resolvedQuestion = question;
  let resolvedIntent: ActiveIntent | null = null;
  const requestedCount = requestedFollowUpCount(question);
  const transform = contextTransformKind(question);
  const isFollowUpRequest = isContinuationIntent(question) || transform !== null;

  if (conversationId && isFollowUpRequest) {
    const lastMeaningful = await measure("continuation_resolution", () =>
      getLastMeaningfulUserQuestion({ supabase, userId: user.id, conversationId, language }),
    );
    if (lastMeaningful) {
      resolvedIntent = transform === "summarize" ? "summarize" : transform === "explain" ? "explain" : transform === "teach" ? "learn_step" : lastMeaningful.intent;
      resolvedQuestion = buildFollowUpQuestion(lastMeaningful.question, resolvedIntent, true, {
        requestedCount,
        transform,
        previousQuestions: lastMeaningful.previousQuestions,
      });
      debug.continuationResolved = true;
      debug.originalQuestion = question;
      debug.resolvedQuestion = resolvedQuestion;
      debug.resolvedIntent = resolvedIntent;
      debug.requestedFollowUpCount = requestedCount;
      debug.contextTransform = transform;
      debug.previousGeneratedQuestionCount = lastMeaningful.previousQuestions.length;
    } else {
      debug.continuationResolved = false;
      debug.continuationReason = "no_previous_meaningful_question";
    }
  }
  // ────────────────────────────────────────────────────────────────────────

  // ── Greeting / conversational-intent fast path ──────────────────────────
  // Intercept casual greetings BEFORE any file-context lookup or DB access.
  // This prevents PDF text or offline-fallback content from appearing in
  // response to "hello", "thanks", "bye", etc.
  if (language === "en" && isGreeting(question)) {
    const msg = greetingResponse(question);
    const greetingAnswer: ChatAnswerWithMode = {
      response_mode: "ai",
      short_answer: msg,
      simple_explanation: msg,
      step_by_step: [],
      example: "",
      memory_line: "",
      common_mistake: "",
      exam_viva_answer: "",
      practice_question: "",
      related_files_notes: [],
      next_step: "",
    };

    // Persist the exchange so conversation history stays consistent.
    const saved = await measure("database_persistence", async () =>
      await supabase
        .from("assistant_questions")
        .insert({
          user_id: user.id,
          question,
          answer: greetingAnswer,
          related_file_ids: [],
          related_note_ids: [],
          mode: "ai",
          status: "answered",
          language_code: language,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        })
        .select("id, question, answer, related_file_ids, related_note_ids, created_at")
        .single(),
    );

    if (saved.error) {
      // Non-critical — return the answer anyway without DB persistence.
      devLog("greeting save failed (non-fatal)", { error: saved.error.message });
      return NextResponse.json({ chat: { id: null, question, answer: greetingAnswer }, related: [], mode: "ai", ...(isDev() ? { debug: { ...debug, timings: timingDebug() } } : {}) });
    }

    return NextResponse.json({ chat: saved.data, related: [], mode: "ai", ...(isDev() ? { debug: { ...debug, timings: timingDebug() } } : {}) });
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (isFollowUpRequest && resolvedQuestion === question) {
    const clarification = "What should I continue? Ask a full question first, or continue from an existing conversation topic.";
    const clarificationAnswer: ChatAnswerWithMode = {
      response_mode: "ai",
      short_answer: clarification,
      simple_explanation: clarification,
      step_by_step: [],
      example: "",
      memory_line: "",
      common_mistake: "",
      exam_viva_answer: "",
      practice_question: "",
      related_files_notes: [],
      next_step: "Ask a complete question, then use next, more, or summarize it in the same conversation.",
    };

    const saved = await measure("database_persistence", async () =>
      await supabase
        .from("assistant_questions")
        .insert({
          user_id: user.id,
          question,
          answer: clarificationAnswer,
          related_file_ids: [],
          related_note_ids: [],
          mode: "ai",
          status: "answered",
          language_code: language,
          ...(conversationId ? { conversation_id: conversationId } : {}),
        })
        .select("id, question, answer, related_file_ids, related_note_ids, created_at")
        .single(),
    );

    if (saved.error) {
      devLog("follow-up clarification save failed (non-fatal)", { error: saved.error.message });
      return NextResponse.json({ chat: { id: null, question, answer: clarificationAnswer }, related: [], mode: "ai", ...(isDev() ? { debug: { ...debug, timings: timingDebug() } } : {}) });
    }

    return NextResponse.json({ chat: saved.data, related: [], mode: "ai", ...(isDev() ? { debug: { ...debug, timings: timingDebug() } } : {}) });
  }
  try {
    const broadAttachedFileQuestion = fileIds.length > 0 && isBroadFileQuestion(resolvedQuestion);
    debug.broadAttachedFileQuestion = broadAttachedFileQuestion;

    logFileContextTrace("context_build_start", {
      requestedFileIds: fileIds,
      resolvedFileIds: fileIds,
      requestedNoteIds: noteIds,
      conversationId: conversationId ?? null,
      requestMode,
      broadAttachedFileQuestion,
    });

    const selectedFileContext = await measure("file_context_loading", async () =>
      getSelectedFileContext({
        supabase,
        userId: user.id,
        fileIds,
        question: resolvedQuestion,
        broadQuestion: broadAttachedFileQuestion,
        language,
      })
    );
    const selectedNoteContext = await getSelectedNoteContext({ supabase, userId: user.id, noteIds });
    const selectedContext = [...selectedFileContext, ...selectedNoteContext];

    logFileContextTrace("context_build_selected", {
      requestedFileIds: fileIds,
      selectedFileCount: selectedFileContext.length,
      selectedNoteCount: selectedNoteContext.length,
      selectedFileIds: selectedFileContext.map((c) => c.id),
      selectedFileNames: selectedFileContext.map((c) => c.label),
      selectedNoteIds: selectedNoteContext.map((c) => c.id),
      selectedNoteNames: selectedNoteContext.map((c) => c.label),
    });
    const keywordContext = selectedContext.length
      ? []
      : conversationId
        ? []
        : await measure("file_context_loading", () => getKeywordContext({ supabase, userId: user.id, question: resolvedQuestion, language }));
    let contextItems = selectedContext.length ? selectedContext : keywordContext;
    const selectedMaterialMode = fileIds.length > 0 || noteIds.length > 0;
    let usedGlobalFallback = false;

    // Global fallback search: if selected material mode but no relevant citations found,
    // search user's other uploaded files and notes automatically.
    if (selectedMaterialMode && contextItems.length > 0) {
      const preparedSelected = await measure("prompt_building", async () =>
        prepareCitedContext(contextItems, resolvedQuestion),
      );
      if (!preparedSelected.citations.length) {
        devLog("selected material has no relevant citations, searching global fallback", { fileIds, noteIds });
        logFileContextTrace("global_fallback_triggered", {
          requestedFileIds: fileIds,
          selectedFileIds: selectedFileContext.map((c) => c.id),
          selectedFileNames: selectedFileContext.map((c) => c.label),
        });
        const globalContext = await measure("global_fallback_search", () =>
          getGlobalFallbackContext({
            supabase,
            userId: user.id,
            question: resolvedQuestion,
            language,
            excludeFileIds: fileIds,
            excludeNoteIds: noteIds,
          }),
        );
        if (globalContext.length > 0) {
          const preparedGlobal = await measure("prompt_building", async () =>
            prepareCitedContext(globalContext, resolvedQuestion),
          );
          if (preparedGlobal.citations.length > 0) {
            contextItems = globalContext;
            usedGlobalFallback = true;
            logFileContextTrace("global_fallback_used", {
              requestedFileIds: fileIds,
              fallbackFileIds: globalContext.filter((c) => c.type === "file").map((c) => c.id),
              fallbackFileNames: globalContext.filter((c) => c.type === "file").map((c) => c.label),
              fallbackNoteIds: globalContext.filter((c) => c.type === "note").map((c) => c.id),
              citationCount: preparedGlobal.citations.length,
              citationSourceIds: preparedGlobal.citations.map((c) => c.id),
              citationSourceNames: preparedGlobal.citations.map((c) => c.source_name),
            });
            devLog("global fallback found relevant citations", { citationCount: preparedGlobal.citations.length });
          }
        }
      }
    }

    const cached = requestMode === "learn_step_by_step" || broadAttachedFileQuestion || selectedMaterialMode
      ? null
      : await measure("message_loading", () =>
          getCachedAnswer({
            supabase,
            userId: user.id,
            question: resolvedQuestion,
            fileIds,
            noteIds,
            conversationId,
            language,
          }),
        );

    if (cached) {
      return NextResponse.json({
        chat: { ...cached, question },
        related: contextItems.map((item) => ({ id: item.id, label: item.label, type: item.type })),
        mode: "cache",
        cached: true,
        ...(isDev() ? { debug: { ...debug, cacheHit: true, timings: timingDebug() } } : {}),
      });
    }

    const previousContext = selectedMaterialMode
      ? []
      : await measure("message_loading", () =>
          getPreviousAnswerContext({
            supabase,
            userId: user.id,
            question: resolvedQuestion,
            conversationId,
            language,
          }),
        );
    const learnerProfile = await measure("learner_profile_loading", () => getLearnerProfileForChat({ supabase, userId: user.id }));
    const personalizedContext = selectedMaterialMode ? "" : buildPersonalizedChatContext(learnerProfile, resolvedQuestion);
    const recommendedWeakTopic = recommendWeakTopic(learnerProfile);
    const personalizedQuestion =
      requestMode === "learn_step_by_step" && recommendedWeakTopic && /^(start|begin|recommend|suggest|lesson|learn|teach|next|weak)/i.test(resolvedQuestion)
        ? `${resolvedQuestion}\nRecommended weak-topic lesson: ${recommendedWeakTopic}`
        : resolvedQuestion;
    const preparedContext = await measure("prompt_building", async () =>
      prepareCitedContext([...contextItems, ...previousContext], resolvedQuestion),
    );

    logFileContextTrace("final_context_prepared", {
      requestedFileIds: fileIds,
      totalContextItems: contextItems.length + previousContext.length,
      contextItemTypes: [...contextItems, ...previousContext].map((c) => c.type),
      contextItemSourceIds: [...contextItems, ...previousContext].map((c) => c.id),
      contextItemLabels: [...contextItems, ...previousContext].map((c) => c.label),
      citationCount: preparedContext.citations.length,
      citationFileIds: preparedContext.citations.map((c) => c.source_id),
      citationSourceNames: preparedContext.citations.map((c) => c.source_name),
      usedGlobalFallback,
    });

    const promptContext = [personalizedContext, preparedContext.text].filter(Boolean).join("\n\n");

    // If no supporting context found after all search strategies, return not-found without calling AI.
    if (selectedMaterialMode && !preparedContext.citations.length) {
      const answer = unsupportedSelectedMaterialAnswer();
      return NextResponse.json({
        chat: { id: null, question, answer, related_file_ids: [], related_note_ids: [], created_at: new Date().toISOString() },
        related: [],
        mode: "selected-context",
        usedGlobalFallback: false,
        ...(isDev() ? { debug: { ...debug, noSelectedEvidence: true, timings: timingDebug() } } : {}),
      });
    }

    // If not in selected material mode and no context at all, don't call AI.
    if (!selectedMaterialMode && !contextItems.length && !previousContext.length) {
      const answer = unsupportedSelectedMaterialAnswer();
      answer.short_answer = "This topic was not found in your uploaded study material.";
      answer.simple_explanation = "No relevant content was found in your files, notes, or summaries. Try uploading relevant material or use Web Search for general knowledge questions.";
      return NextResponse.json({
        chat: { id: null, question, answer, related_file_ids: [], related_note_ids: [], created_at: new Date().toISOString() },
        related: [],
        mode: "keyword-context",
        usedGlobalFallback: false,
        ...(isDev() ? { debug: { ...debug, noContextFound: true, timings: timingDebug() } } : {}),
      });
    }

    debug.contextItemCount = contextItems.length;
    debug.previousAnswerContextCount = previousContext.length;
    debug.learnerWeakTopicCount = learnerProfile.weakTopics.length;
    debug.contextLength = promptContext.length;
    debug.citationCount = preparedContext.citations.length;
    devLog("question context prepared", debug);

    let answer: ChatAnswerWithMode;
    let mode: "selected-context" | "keyword-context" | "offline_fallback" = selectedContext.length ? "selected-context" : "keyword-context";
    let providerMetaForResponse: Record<string, unknown> | null = null;
    const usedGlobalFallbackResponse = usedGlobalFallback;

    try {
      answer = {
        ...(requestMode === "learn_step_by_step"
          ? await measure("ai_provider_request", () => answerLearnStepByStep({ question: personalizedQuestion, context: promptContext, language }))
          : await measure("ai_provider_request", () =>
              answerStudyQuestion({
                question: resolvedQuestion,
                context: promptContext,
                language,
                grounded: selectedMaterialMode,
                allowedSourceIds: preparedContext.citations.map((citation) => citation.id),
              }),
            )),
        response_mode: "ai",
        source_citations: preparedContext.citations,
      };
      if (selectedMaterialMode && requestMode !== "learn_step_by_step") {
        answer = applyGroundingValidation(answer, preparedContext.citations);
      }
      const providerMeta = (answer as ChatAnswerWithMode & ChatAnswerWithMetadata)._providerMeta;
      delete (answer as ChatAnswerWithMode & ChatAnswerWithMetadata)._providerMeta;
      providerMetaForResponse = providerMeta
        ? {
            provider: providerMeta.provider,
            fallbackProvider: providerMeta.fallbackProvider ?? null,
            responseMode: providerMeta.responseMode,
            providerFailureCategory: providerMeta.providerFailureCategory ?? null,
            geminiLatencyMs: providerMeta.geminiLatencyMs ?? null,
            nvidiaLatencyMs: providerMeta.nvidiaLatencyMs ?? null,
            totalLatencyMs: providerMeta.totalLatencyMs ?? null,
            offlineFallbackUsed: providerMeta.offlineFallbackUsed ?? false,
            geminiSkippedDueToCooldown: providerMeta.geminiSkippedDueToCooldown ?? false,
          }
        : null;
      if (providerMeta) {
        debug.provider = providerMeta.provider;
        debug.fallbackProvider = providerMeta.fallbackProvider ?? null;
        debug.providerResponseMode = providerMeta.responseMode;
        debug.geminiLatencyMs = providerMeta.geminiLatencyMs ?? null;
        debug.nvidiaLatencyMs = providerMeta.nvidiaLatencyMs ?? null;
        debug.providerTotalLatencyMs = providerMeta.totalLatencyMs ?? null;
        debug.geminiSkippedDueToCooldown = providerMeta.geminiSkippedDueToCooldown ?? false;
      }
    } catch (error) {
      if (!isAiQuotaError(error) && !isAiBusyError(error)) throw error;

      const fallbackContext = [...contextItems, ...previousContext];
      answer = buildOfflineFallbackAnswer({ question: resolvedQuestion, contextItems: fallbackContext });
      mode = OFFLINE_FALLBACK_MODE;
      debug.offlineFallback = true;
      debug.fallbackReason = isAiQuotaError(error) ? "quota" : "busy";
      devLog("offline fallback answer generated", {
        reason: debug.fallbackReason,
        contextItemCount: contextItems.length,
        previousAnswerContextCount: previousContext.length,
      });
    }

    const relatedFileIds = contextItems.filter((item) => item.type === "file").map((item) => item.id);
    const relatedNoteIds = contextItems.filter((item) => item.type === "note").map((item) => item.id);
    const persistencePayload = {
      user_id: user.id,
      question,
      answer,
      related_file_ids: relatedFileIds,
      related_note_ids: relatedNoteIds,
      mode,
      status: "answered",
      language_code: language,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    };

    if (body.deferPersistence === true) {
      const createdAt = new Date().toISOString();
      after(async () => {
        const result = await supabase.from("assistant_questions").insert(persistencePayload);
        if (result.error) {
          devLog("deferred voice persistence failed", { error: result.error.message, conversationId });
        }
      });

return NextResponse.json({
        chat: {
          id: null,
          question,
          answer,
          related_file_ids: relatedFileIds,
          related_note_ids: relatedNoteIds,
          created_at: createdAt,
        },
        related: contextItems.map((item) => ({ id: item.id, label: item.label, type: item.type })),
        mode,
        providerMeta: providerMetaForResponse,
        usedGlobalFallback: usedGlobalFallbackResponse,
        deferredPersistence: true,
        ...(isDev() ? { debug: { ...debug, timings: timingDebug() } } : {}),
      });
    }

    const saved = await measure("database_persistence", async () =>
      await supabase
        .from("assistant_questions")
        .insert(persistencePayload)
        .select("id, question, answer, related_file_ids, related_note_ids, created_at")
        .single(),
    );

    if (saved.error) throw saved.error;

return NextResponse.json({
      chat: saved.data,
      related: contextItems.map((item) => ({ id: item.id, label: item.label, type: item.type })),
      mode,
      providerMeta: providerMetaForResponse,
      usedGlobalFallback: usedGlobalFallbackResponse,
      ...(isDev() ? { debug: { ...debug, timings: timingDebug() } } : {}),
    });
  } catch (error) {
    const normalized = normalizeError(error);
    devLog("question failed", { ...debug, error: normalized, busy: isAiBusyError(error), quota: isAiQuotaError(error) });
    return apiError(normalized, isAiBusyError(error) ? 503 : isAiQuotaError(error) ? 429 : 500, {
      ...debug,
      timings: timingDebug(),
      error: normalized,
    });
  }
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/ai/ask", async () => handlePost(request));
}
