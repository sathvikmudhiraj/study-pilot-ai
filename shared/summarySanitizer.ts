export type SummaryTopic = {
  topic: string;
  explanation: string;
  important_points: string[];
};

export type SummarySanitizable = {
  suggested_title?: string | null;
  short_summary?: string | null;
  module_overview?: string | null;
  covered_topics?: unknown;
  key_points?: unknown;
  topic_wise_summary?: unknown;
  exam_focus_points?: unknown;
  memory_lines?: unknown;
  common_mistakes?: unknown;
  important_concepts?: unknown;
  action_items?: unknown;
  suggested_tags?: unknown;
  suggested_next_step?: string | null;
  [key: string]: unknown;
};

const INTERNAL_SUMMARY_KEYS = [
  "chunk_number",
  "chunk_total",
  "chunkNumber",
  "chunkTotal",
  "heading",
  "topics",
  "CHUNK_MAPS",
  "TOTAL_CHUNKS",
  "ALL_DETECTED_TOPICS",
  "ALL_DETECTED_CONCEPTS",
];

const INTERNAL_KEY_PATTERN = new RegExp(
  `(?:^|[\\s"'{}[\\],])(?:${INTERNAL_SUMMARY_KEYS.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*[:=]`,
  "i",
);

function normalizeKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripJsonFragments(value: string) {
  return value
    .replace(/```(?:json)?[\s\S]*?```/gi, " ")
    .replace(/"?(?:chunk_number|chunk_total|chunkNumber|chunkTotal)"?\s*:\s*\d+/gi, " ")
    .replace(/"?(?:heading|topics)"?\s*:\s*(?:"[^"]*"|\[[\s\S]*?\]|\{[\s\S]*?\}|[^,\n}\]]+)/gi, " ")
    .replace(/\{[\s\S]*?\}/g, " ")
    .replace(/\[[\s\S]*?\]/g, " ")
    .replace(/\{[^}\n]*$/g, " ")
    .replace(/\[[^\]\n]*$/g, " ");
}

export function sanitizeSummaryText(value: unknown, fallback = "") {
  const stripped = stripJsonFragments(String(value ?? ""));
  const cleaned = stripped
    .replace(/[{}[\]]/g, " ")
    .replace(/^\s*["',:;|-]+|["',:;|-]+\s*$/g, "")
    .replace(/\b(?:chunk_number|chunk_total|chunkNumber|chunkTotal|heading|topics)\b\s*[:=]?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || INTERNAL_KEY_PATTERN.test(cleaned)) return fallback;
  return cleaned;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "")).filter(Boolean);
}

export function sanitizeSummaryList(value: unknown, limit = 24, excludeKeys: Set<string> = new Set()) {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const raw of stringList(value)) {
    const item = sanitizeSummaryText(raw);
    const key = normalizeKey(item);
    if (!item || !key || seen.has(key) || excludeKeys.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= limit) break;
  }

  return items;
}

export function sanitizeTopicSummaries(value: unknown, limit = 18) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const cleaned: SummaryTopic[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const topic = sanitizeSummaryText(record.topic);
    const explanation = sanitizeSummaryText(record.explanation);
    const importantPoints = sanitizeSummaryList(record.important_points, 8);
    const key = normalizeKey(topic || explanation);
    if (!key || seen.has(key)) continue;
    if (!topic && !explanation && !importantPoints.length) continue;
    seen.add(key);
    cleaned.push({
      topic: topic || "Important concept",
      explanation,
      important_points: importantPoints,
    });
    if (cleaned.length >= limit) break;
  }

  return cleaned;
}

function keySet(values: string[]) {
  return new Set(values.map(normalizeKey).filter(Boolean));
}

function sanitizeContentString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return value;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return value;
    const contentSummary = { ...parsed };
    delete contentSummary.content;
    return JSON.stringify(sanitizeSummaryForDisplay(contentSummary));
  } catch {
    return sanitizeSummaryText(value, "");
  }
}

export function sanitizeSummaryForDisplay<T extends SummarySanitizable>(summary: T): T {
  const topicWiseSummary = sanitizeTopicSummaries(summary.topic_wise_summary, 24);
  const topicWiseKeys = keySet(topicWiseSummary.map((item) => item.topic));
  const coveredTopics = sanitizeSummaryList(summary.covered_topics, 30);
  const coveredKeys = keySet(coveredTopics);
  const importantConcepts = sanitizeSummaryList(summary.important_concepts, 28, new Set([...coveredKeys, ...topicWiseKeys]));
  const importantKeys = keySet(importantConcepts);
  const keyPoints = sanitizeSummaryList(summary.key_points, 24, new Set([...coveredKeys, ...topicWiseKeys, ...importantKeys]));
  const actionItems = sanitizeSummaryList(summary.action_items, 16);
  const suggestedTags = sanitizeSummaryList(summary.suggested_tags, 12)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean);

  const sanitized = {
    ...summary,
    suggested_title: sanitizeSummaryText(summary.suggested_title, "Study summary"),
    short_summary: sanitizeSummaryText(summary.short_summary, keyPoints.slice(0, 3).join(" ")),
    module_overview: sanitizeSummaryText(summary.module_overview, sanitizeSummaryText(summary.short_summary)),
    covered_topics: coveredTopics,
    key_points: keyPoints,
    topic_wise_summary: topicWiseSummary,
    exam_focus_points: sanitizeSummaryList(summary.exam_focus_points, 20),
    memory_lines: sanitizeSummaryList(summary.memory_lines, 14),
    common_mistakes: sanitizeSummaryList(summary.common_mistakes, 14),
    important_concepts: importantConcepts,
    action_items: actionItems,
    suggested_tags: Array.from(new Set(suggestedTags)).slice(0, 12),
    suggested_next_step: sanitizeSummaryText(
      summary.suggested_next_step,
      "Review the key points, then generate a quiz to check your understanding.",
    ),
    content: sanitizeContentString(summary.content),
  } as T;

  if (!sanitized.short_summary) sanitized.short_summary = "StudyPilot generated a structured summary from the provided study material.";
  if (!sanitized.module_overview) sanitized.module_overview = sanitized.short_summary;
  if (!Array.isArray(sanitized.covered_topics) || !sanitized.covered_topics.length) {
    sanitized.covered_topics = Array.isArray(sanitized.important_concepts)
      ? sanitized.important_concepts.slice(0, 12)
      : [];
  }
  if (!Array.isArray(sanitized.key_points) || !sanitized.key_points.length) {
    sanitized.key_points = Array.isArray(sanitized.covered_topics)
      ? sanitized.covered_topics.map((topic) => `Review ${topic}.`).slice(0, 8)
      : [];
  }
  if (!Array.isArray(sanitized.action_items) || !sanitized.action_items.length) {
    sanitized.action_items = ["Review the key points.", "Practice recall with a short quiz."];
  }
  sanitized.important_concepts = sanitizeSummaryList(
    sanitized.important_concepts,
    28,
    new Set([
      ...keySet(Array.isArray(sanitized.covered_topics) ? sanitized.covered_topics.map(String) : []),
      ...keySet(Array.isArray(sanitized.topic_wise_summary) ? sanitized.topic_wise_summary.map((item) => String((item as SummaryTopic).topic)) : []),
    ]),
  );
  sanitized.key_points = sanitizeSummaryList(
    sanitized.key_points,
    24,
    new Set([
      ...keySet(Array.isArray(sanitized.covered_topics) ? sanitized.covered_topics.map(String) : []),
      ...keySet(Array.isArray(sanitized.topic_wise_summary) ? sanitized.topic_wise_summary.map((item) => String((item as SummaryTopic).topic)) : []),
      ...keySet(Array.isArray(sanitized.important_concepts) ? sanitized.important_concepts.map(String) : []),
    ]),
  );
  if (!Array.isArray(sanitized.suggested_tags) || !sanitized.suggested_tags.length) {
    sanitized.suggested_tags = Array.isArray(sanitized.covered_topics) ? sanitized.covered_topics.slice(0, 5) : [];
  }

  return sanitized;
}
