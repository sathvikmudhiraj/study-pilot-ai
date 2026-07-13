import "server-only";

import { generateSummaryAIText } from "./aiProvider";
import {
  formatCitationLocator,
  segmentTextWithCitations,
  uniqueSourceCitations,
  type CitationSourceType,
  type SourceCitation,
} from "./sourceCitations";
import { STUDYPILOT_TUTOR_INSTRUCTION } from "./tutorPrompt";

export type TopicSummary = {
  topic: string;
  explanation: string;
  important_points: string[];
};

export type StructuredSummary = {
  suggested_title: string;
  short_summary: string;
  module_overview: string;
  covered_topics: string[];
  key_points: string[];
  topic_wise_summary: TopicSummary[];
  exam_focus_points: string[];
  memory_lines: string[];
  common_mistakes: string[];
  important_concepts: string[];
  action_items: string[];
  suggested_tags: string[];
  suggested_next_step: string;
  source_citations: SourceCitation[];
};

type ChunkMap = {
  chunk_number: number;
  chunk_total: number;
  heading: string;
  topics: string[];
  important_points: string[];
  exam_focus_points: string[];
  important_concepts: string[];
  memory_lines: string[];
  common_mistakes: string[];
  citation: SourceCitation;
};

export type SummarySourceContext = {
  sourceId?: string;
  sourceType: Extract<CitationSourceType, "file" | "note">;
  sourceName: string;
};

const MAX_CHUNK_CHARS = 12000;

// Synthesis token budget scales with module size so large multi-section
// modules (e.g. CNS Module 1) are not squeezed into a tiny output and forced
// to drop later topics like the classical ciphers.
const SYNTHESIS_TOKEN_BASE = 4200;
const SYNTHESIS_TOKEN_PER_CHUNK = 500;
const SYNTHESIS_TOKEN_MAX = 7000;

// When this many detected source topics are missing from Gemini's first
// synthesis pass, run one targeted retry that explicitly names the gaps.
const COVERAGE_RETRY_THRESHOLD = 3;

// Keywords used to gauge whether extracted text covers the full CNS Module 1
// scope (crypto + security concepts + classical ciphers) rather than just one
// section like "threats". Each entry maps to a friendly topic label so the
// detected set can be surfaced in dev logs and used for coverage scoring.
const CNS_COVERAGE_KEYWORDS: { keyword: string; label: string }[] = [
  { keyword: "cryptography", label: "Cryptography basics" },
  { keyword: "computer security", label: "Computer security concepts" },
  { keyword: "security concepts", label: "Computer security concepts" },
  { keyword: "plaintext", label: "Plaintext" },
  { keyword: "ciphertext", label: "Ciphertext" },
  { keyword: "encryption", label: "Encryption" },
  { keyword: "decryption", label: "Decryption" },
  { keyword: "key", label: "Key" },
  { keyword: "cia", label: "CIA triad" },
  { keyword: "confidentiality", label: "CIA triad" },
  { keyword: "osi", label: "OSI security architecture" },
  { keyword: "attack", label: "Security attacks" },
  { keyword: "active attack", label: "Active attacks" },
  { keyword: "passive attack", label: "Passive attacks" },
  { keyword: "service", label: "Security services" },
  { keyword: "mechanism", label: "Security mechanisms" },
  { keyword: "symmetric", label: "Symmetric cipher model" },
  { keyword: "classical encryption", label: "Classical encryption techniques" },
  { keyword: "classical cipher", label: "Classical encryption techniques" },
  { keyword: "cryptanalysis", label: "Cryptanalysis vs brute force" },
  { keyword: "brute", label: "Cryptanalysis vs brute force" },
  { keyword: "caesar", label: "Caesar cipher" },
  { keyword: "monoalphabetic", label: "Monoalphabetic cipher" },
  { keyword: "playfair", label: "Playfair cipher" },
  { keyword: "hill", label: "Hill cipher" },
];

// Minimum number of distinct CNS topic groups that must appear in extracted
// text before we consider it "full module" rather than a single section.
// A partial extract covering only threats/social engineering typically hits
// ~3 groups (attack + key + maybe one cipher), so 7 is a strong signal that
// crypto + services + ciphers are all present.
const CNS_MIN_COVERAGE_TOPICS = 7;

export type CnsCoverageResult = {
  isLikelyCns: boolean;
  detectedKeywords: string[];
  detectedTopics: string[];
  topicCount: number;
  isWeak: boolean;
  reason: string;
};

function detectCnsCoverage(text: string): CnsCoverageResult {
  const haystack = (text || "").toLowerCase();
  if (!haystack) {
    return {
      isLikelyCns: false,
      detectedKeywords: [],
      detectedTopics: [],
      topicCount: 0,
      isWeak: true,
      reason: "Empty text.",
    };
  }

  // Cheap pre-signal: does this look like CNS/crypto material at all?
  const cnsHints = ["cryptography", "cipher", "encryption", "decryption", "network security", "cryptanalysis"];
  const isLikelyCns = cnsHints.some((hint) => haystack.includes(hint));

  const detectedKeywords: string[] = [];
  const detectedTopicSet = new Set<string>();

  for (const { keyword, label } of CNS_COVERAGE_KEYWORDS) {
    if (!haystack.includes(keyword)) continue;
    detectedKeywords.push(keyword);
    detectedTopicSet.add(label);
  }

  const detectedTopics = [...detectedTopicSet];
  const topicCount = detectedTopics.length;

  // A truly partial extract (one section) will usually hit very few topic
  // groups even when it is CNS material. We only flag weakness when the
  // content looks like CNS but the breadth is low, so non-CNS files are not
  // forced into re-extraction loops.
  let isWeak = false;
  let reason = "Coverage looks sufficient.";
  if (isLikelyCns && topicCount < CNS_MIN_COVERAGE_TOPICS) {
    isWeak = true;
    reason = `Likely CNS module but only ${topicCount} of ${CNS_COVERAGE_KEYWORDS.length} topic groups detected (need >= ${CNS_MIN_COVERAGE_TOPICS}). Expected crypto basics, CIA, OSI, services/mechanisms, and classical ciphers.`;
  }

  return {
    isLikelyCns,
    detectedKeywords,
    detectedTopics,
    topicCount,
    isWeak,
    reason,
  };
}

/**
 * Public helper so the summarize route can decide whether stored
 * extracted_text is good enough, or whether it must re-download the original
 * file and re-process before summarizing. Kept here so the keyword list lives
 * in one place next to the summarizer that relies on the same coverage.
 */
export function analyzeCnsCoverage(text: string): CnsCoverageResult {
  const result = detectCnsCoverage(text);
  devLog("coverage analysis", {
    isLikelyCns: result.isLikelyCns,
    topicCount: result.topicCount,
    detectedTopics: result.detectedTopics,
    isWeak: result.isWeak,
    textLength: text.length,
  });
  return result;
}

const REQUIRED_CNS_EXTRACTION_TOPICS: { label: string; keywords: string[] }[] = [
  { label: "Cryptography", keywords: ["cryptography"] },
  { label: "Plaintext", keywords: ["plaintext"] },
  { label: "Ciphertext", keywords: ["ciphertext"] },
  { label: "CIA triad", keywords: ["cia triad", "confidentiality"] },
  { label: "OSI security architecture", keywords: ["osi security architecture", "osi"] },
  { label: "Security attacks", keywords: ["security attack", "active attack", "passive attack"] },
  { label: "Security services", keywords: ["security service"] },
  { label: "Security mechanisms", keywords: ["security mechanism"] },
  { label: "Symmetric cipher model", keywords: ["symmetric cipher", "symmetric encryption"] },
  { label: "Cryptanalysis", keywords: ["cryptanalysis", "brute force"] },
  { label: "Caesar cipher", keywords: ["caesar"] },
  { label: "Monoalphabetic cipher", keywords: ["monoalphabetic"] },
  { label: "Playfair cipher", keywords: ["playfair"] },
  { label: "Hill cipher", keywords: ["hill cipher"] },
];

export type CnsExtractionCoverage = {
  required: boolean;
  valid: boolean;
  detectedTopics: string[];
  missingTopics: string[];
};

export function validateCnsExtractionCoverage(text: string, fileName = ""): CnsExtractionCoverage {
  const haystack = text.toLowerCase();
  const fileNameLooksCns = /(^|[^a-z])(cns(?:module)?|cryptography|network[-\s]?security)([^a-z]|$)/i.test(fileName);
  const textLooksCns = ["cryptography", "cipher", "network security", "cryptanalysis"].some((keyword) => haystack.includes(keyword));
  const required = fileNameLooksCns || textLooksCns;
  const detectedTopics = REQUIRED_CNS_EXTRACTION_TOPICS
    .filter((topic) => topic.keywords.some((keyword) => haystack.includes(keyword)))
    .map((topic) => topic.label);
  const detected = new Set(detectedTopics);
  const missingTopics = required
    ? REQUIRED_CNS_EXTRACTION_TOPICS.map((topic) => topic.label).filter((topic) => !detected.has(topic))
    : [];
  const valid = Boolean(text.trim()) && (!required || missingTopics.length === 0);

  devLog("strict extraction coverage", {
    fileNameLooksCns,
    textLooksCns,
    required,
    valid,
    detectedTopics,
    missingTopics,
    textLength: text.length,
  });

  return { required, valid, detectedTopics, missingTopics };
}

const CNS_TOPIC_HINT =
  "For Cryptography and Network Security material, check for these topics and include only the ones actually present: Cryptography basics; computer security concepts; plaintext, ciphertext, encryption, decryption, key; CIA triad; OSI security architecture; threats vs attacks; active and passive attacks; security services; security mechanisms; symmetric cipher model; classical encryption techniques; Caesar cipher; monoalphabetic cipher; Playfair cipher; Hill cipher.";

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[aiSummary] ${message}`, details ?? "");
}

export function chunkText(text: string) {
  return segmentTextWithCitations({
    text,
    sourceType: "file",
    sourceName: "Study material",
    maxChars: MAX_CHUNK_CHARS,
    idPrefix: "summary-source",
  }).map((segment) => segment.text);
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

function toStringArray(value: unknown, limit = 16) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, limit);
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

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueList(values: string[], limit = 24) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const value of values) {
    const item = value.replace(/\s+/g, " ").trim();
    if (!item) continue;
    const key = normalizeKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= limit) break;
  }

  return items;
}

function missingTopics(baseTopics: string[], candidateTopics: string[]) {
  const baseKeys = baseTopics.map(normalizeKey).filter(Boolean);
  return candidateTopics.filter((topic) => {
    const key = normalizeKey(topic);
    if (!key) return false;
    return !baseKeys.some((baseKey) => baseKey.includes(key) || key.includes(baseKey));
  });
}

function parseTopicWiseSummary(value: unknown): TopicSummary[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const topic = textValue(record, "topic", "title", "name");
      const explanation = textValue(record, "explanation", "summary", "description");
      const importantPoints = arrayValue(record, "important_points", "importantPoints", "points", "key_points", "keyPoints");

      if (!topic && !explanation) return null;

      return {
        topic: topic || "Topic",
        explanation,
        important_points: importantPoints,
      };
    })
    .filter((item): item is TopicSummary => Boolean(item))
    .slice(0, 18);
}

function topicArrayValue(record: Record<string, unknown>) {
  const direct = parseTopicWiseSummary(record.topic_wise_summary ?? record.topicWiseSummary ?? record.topic_summaries ?? record.topicSummaries);
  if (direct.length) return direct;
  return [];
}

function validateSummary(value: unknown): StructuredSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const coveredTopics = arrayValue(record, "covered_topics", "coveredTopics", "topics", "major_topics", "majorTopics");
  const keyPoints = arrayValue(record, "key_points", "keyPoints");
  const importantConcepts = arrayValue(record, "important_concepts", "importantConcepts");
  const summary: StructuredSummary = {
    suggested_title: textValue(record, "suggested_title", "suggestedTitle", "title") || "Study summary",
    short_summary: textValue(record, "short_summary", "shortSummary", "summary"),
    module_overview: textValue(record, "module_overview", "moduleOverview", "overview"),
    covered_topics: coveredTopics,
    key_points: keyPoints,
    topic_wise_summary: topicArrayValue(record),
    exam_focus_points: arrayValue(record, "exam_focus_points", "examFocusPoints", "exam_points", "examPoints"),
    memory_lines: arrayValue(record, "memory_lines", "memoryLines", "memory_tricks", "memoryTricks"),
    common_mistakes: arrayValue(record, "common_mistakes", "commonMistakes", "mistakes"),
    important_concepts: importantConcepts,
    action_items: arrayValue(record, "action_items", "actionItems", "next_actions", "nextActions"),
    suggested_tags: arrayValue(record, "suggested_tags", "suggestedTags", "tags").slice(0, 12),
    suggested_next_step: textValue(record, "suggested_next_step", "suggestedNextStep", "next_step", "nextStep"),
    // Citations are attached deterministically from source segments after the
    // model response is validated. Model-provided page numbers are ignored.
    source_citations: [],
  };

  if (!summary.short_summary) summary.short_summary = summary.module_overview || summary.key_points.slice(0, 3).join(" ");
  if (!summary.module_overview) summary.module_overview = summary.short_summary;
  if (!summary.covered_topics.length) summary.covered_topics = summary.topic_wise_summary.map((item) => item.topic).filter(Boolean);
  if (!summary.important_concepts.length) summary.important_concepts = summary.covered_topics;
  if (!summary.suggested_next_step) summary.suggested_next_step = "Revise the covered topics, then ask StudyPilot for a quiz on weak areas.";

  if (!summary.short_summary) return null;
  return summary;
}

function parseCandidate(json: string) {
  try {
    return validateSummary(JSON.parse(json));
  } catch {
    const repaired = json
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");

    try {
      return validateSummary(JSON.parse(repaired));
    } catch {
      return null;
    }
  }
}

function parseSummaryJson(raw: string) {
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
      devLog("Gemini JSON parse succeeded", { method: attempt.method, rawLength: raw.length });
      return parsed;
    }
  }

  devLog("Gemini JSON parse failed", { rawLength: raw.length });
  return null;
}

function validateChunkMap(value: unknown, index: number, total: number, citation: SourceCitation): ChunkMap | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const topics = uniqueList(arrayValue(record, "topics", "covered_topics", "coveredTopics", "main_topics", "mainTopics"), 12);
  const importantPoints = uniqueList(arrayValue(record, "important_points", "importantPoints", "key_points", "keyPoints", "points"), 16);
  const importantConcepts = uniqueList(arrayValue(record, "important_concepts", "importantConcepts", "concepts"), 12);

  if (!topics.length && !importantPoints.length && !importantConcepts.length) return null;

  return {
    chunk_number: Number(record.chunk_number ?? record.chunkNumber ?? index + 1) || index + 1,
    chunk_total: Number(record.chunk_total ?? record.chunkTotal ?? total) || total,
    heading: textValue(record, "heading", "title", "section_title", "sectionTitle") || `Chunk ${index + 1}`,
    topics,
    important_points: importantPoints,
    exam_focus_points: uniqueList(arrayValue(record, "exam_focus_points", "examFocusPoints", "exam_points", "examPoints"), 12),
    important_concepts: importantConcepts,
    memory_lines: uniqueList(arrayValue(record, "memory_lines", "memoryLines", "memory_tricks", "memoryTricks"), 8),
    common_mistakes: uniqueList(arrayValue(record, "common_mistakes", "commonMistakes", "mistakes"), 8),
    citation,
  };
}

function parseChunkMapJson(raw: string, index: number, total: number, citation: SourceCitation) {
  const trimmed = raw.trim();
  const withoutFence = stripJsonFence(trimmed);
  const extractedObject = extractFirstJsonObject(withoutFence) || extractFirstJsonObject(trimmed);
  const attempts = [trimmed, withoutFence, extractedObject].filter(Boolean);

  for (const attempt of attempts) {
    try {
      const parsed = validateChunkMap(JSON.parse(attempt), index, total, citation);
      if (parsed) return parsed;
    } catch {
      const repaired = attempt
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");

      try {
        const parsed = validateChunkMap(JSON.parse(repaired), index, total, citation);
        if (parsed) return parsed;
      } catch {
        // Keep trying the next candidate.
      }
    }
  }

  return null;
}

function fallbackChunkMap(raw: string, index: number, total: number, citation: SourceCitation): ChunkMap {
  const lines = raw
    .replace(/^#+\s*/gm, "")
    .split(/\n|;|\.\s+/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.length > 8)
    .slice(0, 14);

  return {
    chunk_number: index + 1,
    chunk_total: total,
    heading: `Chunk ${index + 1}`,
    topics: uniqueList(lines.slice(0, 6), 6),
    important_points: uniqueList(lines, 12),
    exam_focus_points: [],
    important_concepts: uniqueList(lines.slice(0, 6), 6),
    memory_lines: [],
    common_mistakes: [],
    citation,
  };
}

function chunkMapsToMaterial(chunkMaps: ChunkMap[]) {
  const allTopics = uniqueList(chunkMaps.flatMap((chunk) => chunk.topics.length ? chunk.topics : [chunk.heading]), 40);
  const allConcepts = uniqueList(chunkMaps.flatMap((chunk) => chunk.important_concepts), 40);

  return [
    `TOTAL_CHUNKS: ${chunkMaps.length}`,
    allTopics.length ? `ALL_DETECTED_TOPICS:\n${allTopics.map((topic) => `- ${topic}`).join("\n")}` : "",
    allConcepts.length ? `ALL_DETECTED_CONCEPTS:\n${allConcepts.map((concept) => `- ${concept}`).join("\n")}` : "",
    "CHUNK_MAPS:",
    ...chunkMaps.map((chunk) =>
      [
        `Chunk ${chunk.chunk_number} of ${chunk.chunk_total}`,
        `Source: ${formatCitationLocator(chunk.citation)}`,
        `Heading: ${chunk.heading}`,
        chunk.topics.length ? `Topics:\n${chunk.topics.map((topic) => `- ${topic}`).join("\n")}` : "",
        chunk.important_points.length ? `Important points:\n${chunk.important_points.map((point) => `- ${point}`).join("\n")}` : "",
        chunk.exam_focus_points.length ? `Exam focus:\n${chunk.exam_focus_points.map((point) => `- ${point}`).join("\n")}` : "",
        chunk.important_concepts.length ? `Important concepts:\n${chunk.important_concepts.map((concept) => `- ${concept}`).join("\n")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");
}

function ensureFullModuleCoverage(summary: StructuredSummary, chunkMaps: ChunkMap[]) {
  if (!chunkMaps.length) return summary;

  const detectedTopics = uniqueList(
    chunkMaps.flatMap((chunk) => (chunk.topics.length ? chunk.topics : [chunk.heading])),
    40,
  );
  const missing = missingTopics(summary.covered_topics, detectedTopics);
  const chunkTopicSummaries: TopicSummary[] = chunkMaps.flatMap((chunk) => {
    const topics = chunk.topics.length ? chunk.topics : [chunk.heading];
    return topics.map((topic) => ({
      topic,
      explanation: `From chunk ${chunk.chunk_number}: ${chunk.important_points.slice(0, 3).join(" ")}`,
      important_points: chunk.important_points.slice(0, 5),
    }));
  });

  const existingTopicNames = summary.topic_wise_summary.map((topic) => topic.topic);
  const supplementalTopics = chunkTopicSummaries.filter((topic) => missingTopics(existingTopicNames, [topic.topic]).length > 0);

  return {
    ...summary,
    module_overview:
      summary.module_overview ||
      `This full-module summary was synthesized from ${chunkMaps.length} chunks of the uploaded material.`,
    covered_topics: uniqueList([...summary.covered_topics, ...missing], 30),
    key_points: uniqueList([...summary.key_points, ...chunkMaps.flatMap((chunk) => chunk.important_points)], 24),
    topic_wise_summary: [...summary.topic_wise_summary, ...supplementalTopics].slice(0, 24),
    exam_focus_points: uniqueList([...summary.exam_focus_points, ...chunkMaps.flatMap((chunk) => chunk.exam_focus_points)], 20),
    memory_lines: uniqueList([...summary.memory_lines, ...chunkMaps.flatMap((chunk) => chunk.memory_lines)], 14),
    common_mistakes: uniqueList([...summary.common_mistakes, ...chunkMaps.flatMap((chunk) => chunk.common_mistakes)], 14),
    important_concepts: uniqueList([...summary.important_concepts, ...chunkMaps.flatMap((chunk) => chunk.important_concepts), ...detectedTopics], 28),
  };
}

async function summarizeChunk(chunk: string, index: number, total: number, citation: SourceCitation) {
  const response = await generateSummaryAIText(
    `${STUDYPILOT_TUTOR_INSTRUCTION}

You are preparing a compact map for ONE chunk of a larger module.
Do not summarize it as the whole file. Capture only what is present in this chunk.

Return strict JSON only. Do not include markdown.
The JSON shape must be:
{
  "chunk_number": ${index + 1},
  "chunk_total": ${total},
  "heading": "string",
  "topics": ["string"],
  "important_points": ["string"],
  "exam_focus_points": ["string"],
  "important_concepts": ["string"],
  "memory_lines": ["string"],
  "common_mistakes": ["string"]
}

${CNS_TOPIC_HINT}

SOURCE LOCATOR:
${formatCitationLocator(citation)}

CHUNK TEXT:
${chunk}`,
    {
      temperature: 0.2,
      maxOutputTokens: 2200,
      responseMimeType: "application/json",
    },
  );

  const parsed = parseChunkMapJson(response, index, total, citation);
  if (parsed) {
    devLog("chunk map parsed", {
      chunkNumber: index + 1,
      total,
      topics: parsed.topics.length,
      importantPoints: parsed.important_points.length,
    });
    return parsed;
  }

  devLog("chunk map used text fallback", { chunkNumber: index + 1, total, rawLength: response.length });
  return fallbackChunkMap(response, index, total, citation);
}

async function generateStructuredSummary(
  text: string,
  sourceKind: "full-text" | "chunk-map",
  chunkMaps: ChunkMap[] = [],
  coverageReminder?: string,
) {
  const materialLabel = sourceKind === "chunk-map" ? "chunk-level maps from the same uploaded file" : "uploaded study material";
  const chunkCount = Math.max(1, chunkMaps.length);
  // Scale output budget to module size so large modules are not starved into
  // dropping later topics (e.g. the classical ciphers at the end of CNS M1).
  const maxOutputTokens = Math.min(
    SYNTHESIS_TOKEN_BASE + chunkCount * SYNTHESIS_TOKEN_PER_CHUNK,
    SYNTHESIS_TOKEN_MAX,
  );
  const chunkRule =
    sourceKind === "chunk-map"
      ? `\nFull-module synthesis rules for chunk maps:\n- You are given maps for ALL ${chunkMaps.length} chunks of the same uploaded material.\n- Your answer is invalid if it summarizes only chunk 1 or only one section.\n- Use ALL_DETECTED_TOPICS and every Chunk N of ${chunkMaps.length} when deciding covered_topics, key_points, and topic_wise_summary.\n- Include a broad topic_wise_summary that represents early, middle, and late chunks.\n- If chunks overlap, merge duplicates; if chunks differ, preserve the distinct topics.\n- Do a private coverage check before returning JSON: every major topic listed in the chunk maps should appear in covered_topics or topic_wise_summary.\n`
      : "";
  const reminder = coverageReminder
    ? `\nIMPORTANT COVERAGE FIX from your previous attempt:\n${coverageReminder}\nYour previous draft omitted major topics that ARE present in the material. Re-read ALL of the material below and include each listed topic in covered_topics and topic_wise_summary with a real explanation (not just a name).\n`
    : "";
  const prompt = `${STUDYPILOT_TUTOR_INSTRUCTION}

Create a balanced full-module study summary from the ${materialLabel}. Use only the provided material. Do not hallucinate topics that are not present.

Critical summary rules:
- Identify the main subject of the file.
- Detect all major topics covered in the material.
- Cover the full module, not a random subsection.
- Give fair attention to each major topic.
- If one topic has more text, still mention other major topics that are present.
- Mention topic coverage clearly.
- Use student-friendly explanations, examples, memory lines, common mistakes, and exam/viva points.
- For Cryptography and Network Security files, check for cryptography basics, security concepts, CIA triad, OSI security architecture, threats vs attacks, active/passive attacks, security services, mechanisms, symmetric cipher model, and classical encryption ciphers such as Caesar, monoalphabetic, Playfair, and Hill. Only include topics actually present in the material.
${chunkRule}${reminder}

Return strict JSON only. Do not include markdown. The JSON shape must be:
{
  "suggested_title": "string",
  "short_summary": "string",
  "module_overview": "string",
  "covered_topics": ["string"],
  "key_points": ["string"],
  "topic_wise_summary": [
    {
      "topic": "string",
      "explanation": "string",
      "important_points": ["string"]
    }
  ],
  "exam_focus_points": ["string"],
  "memory_lines": ["string"],
  "common_mistakes": ["string"],
  "important_concepts": ["string"],
  "action_items": ["string"],
  "suggested_tags": ["string"],
  "suggested_next_step": "string"
}

MATERIAL:
${text}`;

  const response = await generateSummaryAIText(prompt, {
    temperature: coverageReminder ? 0.3 : 0.2,
    maxOutputTokens,
    responseMimeType: "application/json",
  });
  devLog("AI structured response received", {
    rawLength: response.length,
    sourceKind,
    maxOutputTokens,
    coverageRetry: Boolean(coverageReminder),
  });
  const parsed = parseSummaryJson(response);
  if (!parsed) throw new Error("Gemini JSON parse failed.");
  // Do not apply the deterministic backstop here: the orchestrator measures
  // coverage first and only falls back to it if Gemini still misses topics.
  return parsed;
}

/**
 * Decide whether Gemini's synthesis covered the source material broadly
 * enough. For chunk-map material we compare against the topics detected
 * across all chunk maps; for raw full text we compare against CNS keyword
 * groups so a crypto module can't collapse into a single section.
 *
 * Returns the human-readable reminder to feed back on retry, or "" when the
 * first pass already looks complete.
 */
function buildCoverageReminder(summary: StructuredSummary, chunkMaps: ChunkMap[], rawText?: string): string {
  const sourceTopics =
    chunkMaps.length > 0
      ? uniqueList(chunkMaps.flatMap((chunk) => (chunk.topics.length ? chunk.topics : [chunk.heading])), 40)
      : analyzeCnsCoverage(rawText ?? "").detectedTopics;

  const covered = summary.covered_topics;
  const missing = missingTopics(covered, sourceTopics);

  if (missing.length < COVERAGE_RETRY_THRESHOLD) return "";

  const list = missing.slice(0, 16).map((topic) => `- ${topic}`).join("\n");
  return [
    `Your previous draft was missing ${missing.length} major topic(s) that ARE present in the material.`,
    "Required topics still missing from covered_topics / topic_wise_summary:",
    list,
    "For each one, add a real entry to topic_wise_summary (topic + explanation + important_points), not just a label.",
  ].join("\n");
}

export async function summarizeStudyText(
  text: string,
  source: SummarySourceContext = { sourceType: "file", sourceName: "Study material" },
) {
  const segments = segmentTextWithCitations({
    text,
    sourceId: source.sourceId,
    sourceType: source.sourceType,
    sourceName: source.sourceName,
    maxChars: MAX_CHUNK_CHARS,
    idPrefix: "summary-source",
  });
  const chunks = segments.map((segment) => segment.text);
  const sourceCitations = uniqueSourceCitations(segments.map((segment) => segment.citation));

  if (!chunks.length) {
    throw new Error("No readable text found in this file. Try another file or add manual notes.");
  }

  if (chunks.length === 1) {
    let summary = await generateStructuredSummary(chunks[0], "full-text");
    const reminder = buildCoverageReminder(summary, [], chunks[0]);
    devLog("single-chunk coverage check", { missedCount: reminder ? 1 : 0, retry: Boolean(reminder) });
    if (reminder) {
      const retried = await generateStructuredSummary(chunks[0], "full-text", [], reminder);
      // Keep the retry only if it actually improved coverage.
      if (retried.covered_topics.length >= summary.covered_topics.length) summary = retried;
    }
    const final = {
      ...ensureFullModuleCoverage(summary, []),
      source_citations: sourceCitations,
    };
    devLog("summary complete", { chunkCount: 1, coveredTopicsCount: final.covered_topics.length });
    return final;
  }

  const chunkMaps: ChunkMap[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    chunkMaps.push(await summarizeChunk(chunks[index], index, chunks.length, segments[index].citation));
  }

  const detectedTopicCount = uniqueList(chunkMaps.flatMap((chunk) => chunk.topics), 60).length;
  devLog("all chunk maps prepared", {
    chunks: chunkMaps.length,
    detectedTopics: detectedTopicCount,
  });

  const material = chunkMapsToMaterial(chunkMaps);
  let summary = await generateStructuredSummary(material, "chunk-map", chunkMaps);
  const reminder = buildCoverageReminder(summary, chunkMaps);
  devLog("multi-chunk coverage check", {
    detectedTopicCount,
    firstPassCovered: summary.covered_topics.length,
    retry: Boolean(reminder),
    ...(reminder ? { missedReminder: reminder.slice(0, 200) } : {}),
  });
  if (reminder) {
    const retried = await generateStructuredSummary(material, "chunk-map", chunkMaps, reminder);
    if (retried.covered_topics.length >= summary.covered_topics.length) summary = retried;
    devLog("multi-chunk coverage retry complete", {
      retriedCovered: retried.covered_topics.length,
      accepted: retried.covered_topics.length >= summary.covered_topics.length,
    });
  }

  const final = {
    ...ensureFullModuleCoverage(summary, chunkMaps),
    source_citations: sourceCitations,
  };
  devLog("summary complete", {
    chunkCount: chunkMaps.length,
    coveredTopicsCount: final.covered_topics.length,
  });
  return final;
}
