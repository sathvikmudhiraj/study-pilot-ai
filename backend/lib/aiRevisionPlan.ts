import "server-only";

import { generateAITextWithMetadata, generateRevisionAITextWithMetadata, getAIProviderRuntimeInfo, type AIProviderResult, type AIProviderTelemetryEvent } from "./aiProvider";
import { generateLocalizedText } from "./aiLanguage";
import { STUDYPILOT_TUTOR_INSTRUCTION } from "./tutorPrompt";
import type { LearnerProfile } from "./learnerProfile";
import { DEFAULT_LANGUAGE, type SupportedLanguageCode } from "@/shared/languages";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StudyFile = {
  file_name: string;
  content_type: string | null;
  extracted_text: string;
};

export type StudyNote = {
  title: string;
  topic: string | null;
  raw_notes: string;
};

export type StudySummary = {
  suggested_title: string | null;
  covered_topics: string[];
  key_points: string[];
  exam_focus_points: string[];
  common_mistakes: string[];
  memory_lines: string[];
  action_items: string[];
  important_concepts: string[];
};

export type StudyQuiz = {
  title: string | null;
  difficulty: string | null;
  question_count: number;
};

export type QuizPerformance = {
  attempt_count: number;
  strong_topics: string[];
  weak_topics: string[];
  last_quiz_score: {
    score: number;
    total: number;
    percentage: number;
    attempted_at: string;
  } | null;
};

export type StudyContext = {
  files: StudyFile[];
  notes: StudyNote[];
  summaries: StudySummary[];
  quizzes: StudyQuiz[];
  quiz_analytics: QuizPerformance;
  learner_profile?: Pick<LearnerProfile, "weakTopics" | "recentMistakes" | "preferredDifficulty" | "learningPace">;
};

export type DayPlan = {
  day: number;
  date: string;
  focus_topics: string[];
  tasks: string[];
  estimated_time: string;
};

export type PlanMeta = {
  total_days: number;
  next_steps: string[];
  study_tips: string[];
  strong_topics: string[];
  weak_topics: string[];
  last_quiz_score: QuizPerformance["last_quiz_score"];
};

export type RevisionPlan = {
  title: string;
  important_topics: string[];
  revise_first: string[];
  pending_topics: string[];
  daily_plan: DayPlan[];
  plan: PlanMeta;
  starts_on: string;
  ends_on: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TEXT_PER_FILE_WITH_SUMMARIES = 700;
const MAX_TEXT_PER_FILE_WITHOUT_SUMMARIES = 1600;
const MAX_TEXT_PER_FILE = 3000;
const MAX_TOTAL_FILE_TEXT_WITH_SUMMARIES = 3500;
const MAX_TOTAL_FILE_TEXT_WITHOUT_SUMMARIES = 9000;
const MAX_TEXT_PER_NOTE = 1000;
const MAX_TOTAL_NOTE_TEXT = 4500;
const MAX_REVISION_SUMMARIES = 12;
const MAX_SUMMARY_ITEMS = 8;
const DEFAULT_PLAN_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[aiRevisionPlan] ${message}`, details ?? "");
}

function telemetryLog(message: string, details?: Record<string, unknown>) {
  console.info(`[aiRevisionPlan] ${message}`, details ?? {});
}

function truncate(text: string, max: number) {
  if (!text || text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "\n…[truncated]";
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

function charCount(values: string[]) {
  return values.reduce((total, value) => total + value.length, 0);
}

function textChars(value: string | null | undefined) {
  return String(value ?? "").trim().length;
}

function scoreTextForTerms(text: string, terms: string[]) {
  const lower = text.toLowerCase();
  return terms.reduce((score, term) => score + (term && lower.includes(term) ? 1 : 0), 0);
}

function priorityTerms(ctx: StudyContext) {
  return uniqueStrings(
    [
      ...ctx.quiz_analytics.weak_topics,
      ...(ctx.learner_profile?.weakTopics ?? []).map((topic) => topic.topic),
      ...ctx.summaries.flatMap((summary) => summary.covered_topics.slice(0, 4)),
      ...ctx.summaries.flatMap((summary) => summary.important_concepts.slice(0, 4)),
    ],
    30,
  ).map((term) => term.toLowerCase());
}

function summaryTextForScoring(summary: StudySummary) {
  return [
    summary.suggested_title ?? "",
    ...summary.covered_topics,
    ...summary.key_points,
    ...summary.exam_focus_points,
    ...summary.important_concepts,
    ...summary.common_mistakes,
    ...summary.memory_lines,
  ].join("\n");
}

function selectedSummaries(ctx: StudyContext) {
  const terms = priorityTerms(ctx);
  return ctx.summaries
    .map((summary, index) => ({
      summary,
      index,
      score: scoreTextForTerms(summaryTextForScoring(summary), terms),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_REVISION_SUMMARIES)
    .map(({ summary }) => summary);
}

function listLine(label: string, values: string[], limit = MAX_SUMMARY_ITEMS) {
  const items = uniqueStrings(values, limit);
  return items.length ? `${label}: ${items.join("; ")}` : "";
}

type RevisionContextStats = {
  fileCount: number;
  noteCount: number;
  summaryCount: number;
  selectedSummaryCount: number;
  quizCount: number;
  originalFileTextChars: number;
  includedFileTextChars: number;
  originalNoteTextChars: number;
  includedNoteTextChars: number;
  contextChars: number;
  largestFileTextChars: number;
  fullExtractedTextSent: boolean;
};

// ---------------------------------------------------------------------------
// JSON parsing (reuse the robust pattern from aiSummary)
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

type ParseAttempt = {
  parsed: Record<string, unknown> | null;
  method: string;
  error: string | null;
};

function parseJsonWithDiagnostics(raw: string): ParseAttempt {
  if (!raw.trim()) {
    return { parsed: null, method: "none", error: "empty response" };
  }

  const candidates = [
    { method: "direct-or-fence", value: stripJsonFence(raw) },
    { method: "fenced-first-object", value: extractFirstJsonObject(stripJsonFence(raw)) },
    { method: "raw-first-object", value: extractFirstJsonObject(raw) },
  ].filter((candidate) => Boolean(candidate.value));

  let lastError: string | null = null;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { parsed: parsed as Record<string, unknown>, method: candidate.method, error: null };
      }
      lastError = "Parsed JSON was not an object.";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "JSON parse failed.";
      // try repair
      const repaired = candidate.value
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      try {
        const parsed = JSON.parse(repaired);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return { parsed: parsed as Record<string, unknown>, method: `${candidate.method}-punctuation-repair`, error: null };
        }
        lastError = "Repaired JSON was not an object.";
      } catch (repairError) {
        lastError = repairError instanceof Error ? repairError.message : "JSON repair parse failed.";
        // continue to next candidate
      }
    }
  }

  return { parsed: null, method: "none", error: lastError };
}

function responseDebugShape(raw: string, parsed?: Record<string, unknown> | null) {
  const stripped = stripJsonFence(raw);
  const firstObject = extractFirstJsonObject(stripped || raw);
  const rootKeys = parsed ? Object.keys(parsed).slice(0, 30) : [];
  const planValue = parsed?.plan;
  const dailyValue = parsed?.daily_plan ?? parsed?.dailyPlan ?? parsed?.days ?? parsed?.schedule;

  return {
    rawLength: raw.length,
    startsWithFence: raw.trimStart().startsWith("```"),
    hasLeadingProse: raw.trimStart()[0] !== "{",
    hasTrailingProse: Boolean(firstObject && stripped.trim() !== firstObject.trim()),
    rootKeys,
    dailyPlanType: Array.isArray(dailyValue) ? "array" : typeof dailyValue,
    dailyPlanLength: Array.isArray(dailyValue) ? dailyValue.length : null,
    planType: Array.isArray(planValue) ? "array" : typeof planValue,
    sample: raw.slice(0, 1800),
  };
}

// ---------------------------------------------------------------------------
// Build prompt from study context
// ---------------------------------------------------------------------------

function learnerProfileRevisionSection(ctx: StudyContext) {
  const profile = ctx.learner_profile;
  if (!profile || (!profile.weakTopics.length && !profile.recentMistakes.length)) return "";
  return [
    "LEARNER PROFILE PRIORITIES:",
    profile.weakTopics.length
      ? `Highest-priority weak topics: ${profile.weakTopics
          .slice(0, 6)
          .map((topic) => `${topic.topic} [canonical: ${topic.canonicalId}] (${topic.accuracy}% accuracy, ${topic.misses} misses)`)
          .join("; ")}`
      : "",
    profile.recentMistakes.length
      ? `Repeated mistakes: ${profile.recentMistakes
          .slice(0, 4)
          .map((mistake) => `${mistake.topic}${mistake.misses > 1 ? ` (${mistake.misses} misses)` : ""}`)
          .join("; ")}`
      : "",
    `Learning pace: ${profile.learningPace}; preferred quiz difficulty: ${profile.preferredDifficulty}`,
  ].filter(Boolean).join("\n");
}

function buildStudyContextText(ctx: StudyContext): string {
  const sections: string[] = [];

  if (ctx.files.length) {
    sections.push(
      `UPLOADED FILES (${ctx.files.length}):\n` +
        ctx.files
          .map(
            (f) =>
              `File: "${f.file_name}" (${f.content_type ?? "unknown"})\nContent preview:\n${truncate(f.extracted_text, MAX_TEXT_PER_FILE)}`,
          )
          .join("\n\n---\n\n"),
    );
  }

  if (ctx.notes.length) {
    sections.push(
      `MANUAL NOTES (${ctx.notes.length}):\n` +
        ctx.notes
          .map((n) => `Note: "${n.title}"${n.topic ? ` — Topic: ${n.topic}` : ""}\n${truncate(n.raw_notes, MAX_TEXT_PER_FILE)}`)
          .join("\n\n---\n\n"),
    );
  }

  if (ctx.summaries.length) {
    const summaryLines = ctx.summaries.map((s) => {
      const parts: string[] = [];
      if (s.suggested_title) parts.push(`Title: ${s.suggested_title}`);
      if (s.covered_topics.length) parts.push(`Topics: ${s.covered_topics.join(", ")}`);
      if (s.key_points.length) parts.push(`Key points: ${s.key_points.join("; ")}`);
      if (s.exam_focus_points.length) parts.push(`Exam focus: ${s.exam_focus_points.join("; ")}`);
      if (s.common_mistakes.length) parts.push(`Common mistakes: ${s.common_mistakes.join("; ")}`);
      if (s.memory_lines.length) parts.push(`Memory lines: ${s.memory_lines.join("; ")}`);
      if (s.action_items.length) parts.push(`Action items: ${s.action_items.join("; ")}`);
      if (s.important_concepts.length) parts.push(`Important concepts: ${s.important_concepts.join("; ")}`);
      return parts.join("\n");
    });
    sections.push(`AI SUMMARIES (${ctx.summaries.length}):\n${summaryLines.join("\n\n---\n\n")}`);
  }

  if (ctx.quizzes.length) {
    const quizLines = ctx.quizzes.map((q) => {
      const parts: string[] = [];
      if (q.title) parts.push(`Quiz: ${q.title}`);
      if (q.difficulty) parts.push(`Difficulty: ${q.difficulty}`);
      parts.push(`Questions: ${q.question_count}`);
      return parts.join(" | ");
    });
    sections.push(`QUIZZES (${ctx.quizzes.length}):\n${quizLines.join("\n")}`);
  }

  if (ctx.quiz_analytics.attempt_count) {
    const last = ctx.quiz_analytics.last_quiz_score;
    sections.push(
      [
        "QUIZ PERFORMANCE (use this to set revision priority):",
        last ? `Last quiz score: ${last.score}/${last.total} (${Math.round(last.percentage)}%)` : "",
        ctx.quiz_analytics.weak_topics.length ? `Weak topics: ${ctx.quiz_analytics.weak_topics.join(", ")}` : "Weak topics: none tracked",
        ctx.quiz_analytics.strong_topics.length ? `Strong topics: ${ctx.quiz_analytics.strong_topics.join(", ")}` : "Strong topics: none tracked",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const profileSection = learnerProfileRevisionSection(ctx);
  if (profileSection) sections.push(profileSection);

  return sections.join("\n\n======\n\n");
}

function buildReducedStudyContextText(ctx: StudyContext): { text: string; stats: RevisionContextStats & { legacyContextChars: number } } {
  const sections: string[] = [];
  const summaries = selectedSummaries(ctx);
  const hasStructuredSummaries = summaries.length > 0;
  const perFileLimit = hasStructuredSummaries ? MAX_TEXT_PER_FILE_WITH_SUMMARIES : MAX_TEXT_PER_FILE_WITHOUT_SUMMARIES;
  const totalFileLimit = hasStructuredSummaries ? MAX_TOTAL_FILE_TEXT_WITH_SUMMARIES : MAX_TOTAL_FILE_TEXT_WITHOUT_SUMMARIES;
  const fileOriginalLengths = ctx.files.map((file) => textChars(file.extracted_text));
  let remainingFileChars = totalFileLimit;
  let includedFileTextChars = 0;
  let includedNoteTextChars = 0;

  if (summaries.length) {
    const summaryLines = summaries.map((summary) => {
      const parts = [
        summary.suggested_title ? `Title: ${summary.suggested_title}` : "",
        listLine("Topics", summary.covered_topics, 12),
        listLine("Key points", summary.key_points),
        listLine("Exam focus", summary.exam_focus_points),
        listLine("Important concepts", summary.important_concepts),
        listLine("Common mistakes", summary.common_mistakes, 6),
        listLine("Memory lines", summary.memory_lines, 6),
        listLine("Action items", summary.action_items, 6),
      ].filter(Boolean);
      return parts.join("\n");
    });
    sections.push(`SELECTED AI SUMMARIES AND KEY POINTS (${summaries.length} of ${ctx.summaries.length}):\n${summaryLines.join("\n\n---\n\n")}`);
  }

  if (ctx.files.length) {
    const fileLines: string[] = [];
    for (const file of ctx.files) {
      const rawText = file.extracted_text.trim();
      if (!rawText || remainingFileChars <= 0) {
        fileLines.push(`File: "${file.file_name}" (${file.content_type ?? "unknown"})`);
        continue;
      }

      const excerptLimit = Math.min(perFileLimit, remainingFileChars);
      const includedChars = Math.min(rawText.length, excerptLimit);
      includedFileTextChars += includedChars;
      remainingFileChars -= includedChars;
      fileLines.push(
        `File: "${file.file_name}" (${file.content_type ?? "unknown"})\nRelevant excerpt (${includedChars} of ${rawText.length} chars):\n${truncate(rawText, excerptLimit)}`,
      );
    }
    sections.push(`UPLOADED FILES (${ctx.files.length}, bounded excerpts):\n${fileLines.join("\n\n---\n\n")}`);
  }

  if (ctx.notes.length) {
    const noteLines: string[] = [];
    let remainingNoteChars = MAX_TOTAL_NOTE_TEXT;
    for (const note of ctx.notes) {
      const rawText = note.raw_notes.trim();
      const noteTitle = `Note: "${note.title}"${note.topic ? ` - Topic: ${note.topic}` : ""}`;
      if (!rawText || remainingNoteChars <= 0) {
        noteLines.push(noteTitle);
        continue;
      }

      const excerptLimit = Math.min(MAX_TEXT_PER_NOTE, remainingNoteChars);
      const includedChars = Math.min(rawText.length, excerptLimit);
      includedNoteTextChars += includedChars;
      remainingNoteChars -= includedChars;
      noteLines.push(`${noteTitle}\n${truncate(rawText, excerptLimit)}`);
    }
    sections.push(`MANUAL NOTES (${ctx.notes.length}, bounded excerpts):\n${noteLines.join("\n\n---\n\n")}`);
  }

  if (ctx.quizzes.length) {
    const quizLines = ctx.quizzes.map((quiz) => {
      const parts: string[] = [];
      if (quiz.title) parts.push(`Quiz: ${quiz.title}`);
      if (quiz.difficulty) parts.push(`Difficulty: ${quiz.difficulty}`);
      parts.push(`Questions: ${quiz.question_count}`);
      return parts.join(" | ");
    });
    sections.push(`QUIZZES (${ctx.quizzes.length}):\n${quizLines.join("\n")}`);
  }

  if (ctx.quiz_analytics.attempt_count) {
    const last = ctx.quiz_analytics.last_quiz_score;
    sections.push(
      [
        "QUIZ PERFORMANCE (use this to set revision priority):",
        last ? `Last quiz score: ${last.score}/${last.total} (${Math.round(last.percentage)}%)` : "",
        ctx.quiz_analytics.weak_topics.length ? `Weak topics: ${ctx.quiz_analytics.weak_topics.join(", ")}` : "Weak topics: none tracked",
        ctx.quiz_analytics.strong_topics.length ? `Strong topics: ${ctx.quiz_analytics.strong_topics.join(", ")}` : "Strong topics: none tracked",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  const profileSection = learnerProfileRevisionSection(ctx);
  if (profileSection) sections.push(profileSection);

  const text = sections.join("\n\n======\n\n");
  return {
    text,
    stats: {
      fileCount: ctx.files.length,
      noteCount: ctx.notes.length,
      summaryCount: ctx.summaries.length,
      selectedSummaryCount: summaries.length,
      quizCount: ctx.quizzes.length,
      originalFileTextChars: charCount(ctx.files.map((file) => file.extracted_text)),
      includedFileTextChars,
      originalNoteTextChars: charCount(ctx.notes.map((note) => note.raw_notes)),
      includedNoteTextChars,
      contextChars: text.length,
      largestFileTextChars: fileOriginalLengths.length ? Math.max(...fileOriginalLengths) : 0,
      fullExtractedTextSent: fileOriginalLengths.some((length) => length > totalFileLimit && includedFileTextChars >= length),
      legacyContextChars: buildStudyContextText(ctx).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Validate and normalize Gemini response into RevisionPlan
// ---------------------------------------------------------------------------

function requiredText(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function firstArray(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstRecord(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return {};
}

function validateRevisionPlan(record: Record<string, unknown>, ctx: StudyContext): RevisionPlan {
  const errors: string[] = [];
  const title = requiredText(record, "title", "plan_title", "planTitle", "revision_title", "revisionTitle");
  if (!title) errors.push("title is missing");
  const trackedWeakTopics = uniqueStrings(ctx.quiz_analytics.weak_topics, 20);
  const trackedStrongTopics = uniqueStrings(ctx.quiz_analytics.strong_topics, 20);
  const importantTopics = uniqueStrings(
    [...trackedWeakTopics, ...stringList(firstArray(record, "important_topics", "importantTopics", "topics", "all_topics", "allTopics"))],
    30,
  );
  const reviseFirst = uniqueStrings(
    [...trackedWeakTopics, ...stringList(firstArray(record, "revise_first", "reviseFirst", "priority_topics", "priorityTopics", "high_priority_topics", "highPriorityTopics"))],
    20,
  );
  const weakKeys = new Set(trackedWeakTopics.map((topic) => topic.toLowerCase()));
  const pendingTopics = uniqueStrings(
    stringList(firstArray(record, "pending_topics", "pendingTopics", "remaining_topics", "remainingTopics", "later_topics", "laterTopics")).filter(
      (topic) => !weakKeys.has(topic.toLowerCase()),
    ),
    30,
  );
  if (!importantTopics.length) errors.push("important_topics is missing or empty");
  if (!reviseFirst.length) errors.push("revise_first is missing or empty");

  // Parse daily plan
  const rawDaily = record.daily_plan ?? record.dailyPlan ?? record.days ?? record.schedule ?? record.week_plan ?? record.weekPlan ?? [];
  const dailyPlan: DayPlan[] = (Array.isArray(rawDaily) ? rawDaily : [])
    .map((item: unknown, index: number) => {
      if (!item || typeof item !== "object") return null;
      const day = item as Record<string, unknown>;
      const focusTopics = uniqueStrings(stringList(day.focus_topics ?? day.focusTopics ?? day.topics ?? day.focus), 10);
      const tasks = uniqueStrings(stringList(day.tasks ?? day.study_tasks ?? day.studyTasks ?? day.activities ?? day.to_do ?? day.todo), 10);
      if (!focusTopics.length || !tasks.length) return null;
      return {
        day: Number(day.day ?? day.day_number ?? index + 1) || index + 1,
        date: String(day.date ?? "").trim() || "",
        focus_topics: focusTopics,
        tasks,
        estimated_time: String(day.estimated_time ?? day.time ?? day.duration ?? "1 hour").trim() || "1 hour",
      };
    })
    .filter((item): item is DayPlan => Boolean(item))
    .slice(0, 14);
  if (!dailyPlan.length) errors.push("daily_plan is missing or contains no valid days");

  // Parse plan metadata
  const rawPlan = firstRecord(record, "plan", "metadata", "plan_meta", "planMeta");
  const nextSteps = uniqueStrings(stringList(rawPlan.next_steps ?? rawPlan.nextSteps ?? record.next_steps ?? record.nextSteps), 8);
  const studyTips = uniqueStrings(stringList(rawPlan.study_tips ?? rawPlan.studyTips ?? record.study_tips ?? record.studyTips), 8);
  if (!nextSteps.length) errors.push("plan.next_steps is missing or empty");
  if (!studyTips.length) errors.push("plan.study_tips is missing or empty");
  const plan: PlanMeta = {
    total_days: Number(rawPlan.total_days ?? rawPlan.totalDays ?? dailyPlan.length) || dailyPlan.length || DEFAULT_PLAN_DAYS,
    next_steps: nextSteps,
    study_tips: studyTips,
    strong_topics: trackedStrongTopics,
    weak_topics: trackedWeakTopics,
    last_quiz_score: ctx.quiz_analytics.last_quiz_score,
  };

  if (errors.length) {
    throw new Error(`AI revision plan schema validation failed: ${errors.join("; ")}.`);
  }

  // Compute dates from today if not provided
  const today = new Date();
  const startsOn = String(record.starts_on ?? record.startsOn ?? "").trim() || today.toISOString().split("T")[0]!;
  const totalDays = plan.total_days || DEFAULT_PLAN_DAYS;
  const endsDate = new Date(today);
  endsDate.setDate(endsDate.getDate() + totalDays - 1);
  const endsOn = String(record.ends_on ?? record.endsOn ?? "").trim() || endsDate.toISOString().split("T")[0]!;

  // Fill in missing dates on daily plans
  for (const day of dailyPlan) {
    if (!day.date) {
      const d = new Date(today);
      d.setDate(d.getDate() + day.day - 1);
      day.date = d.toISOString().split("T")[0]!;
    }
  }

  if (dailyPlan[0] && trackedWeakTopics.length) {
    dailyPlan[0].focus_topics = uniqueStrings([...trackedWeakTopics.slice(0, 3), ...dailyPlan[0].focus_topics], 10);
    dailyPlan[0].tasks = uniqueStrings(
      [
        ...trackedWeakTopics.slice(0, 3).map((topic) => `Review weak topic: ${topic}, then answer one practice question.`),
        ...dailyPlan[0].tasks,
      ],
      10,
    );
  }

  return {
    title,
    important_topics: importantTopics,
    revise_first: reviseFirst,
    pending_topics: pendingTopics,
    daily_plan: dailyPlan,
    plan,
    starts_on: startsOn,
    ends_on: endsOn,
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function generateRevisionPlan(
  ctx: StudyContext,
  language: SupportedLanguageCode = DEFAULT_LANGUAGE,
  signal?: AbortSignal,
): Promise<RevisionPlan> {
  const { text: contextText, stats } = buildReducedStudyContextText(ctx);
  const providerInfo = getAIProviderRuntimeInfo("revision");
  const telemetryEvents: AIProviderTelemetryEvent[] = [];
  let actualProvider = providerInfo.primaryProvider;
  let actualModel = providerInfo.primaryModel;
  let actualTimeoutMs = providerInfo.fastFallbackTimeoutMs;
  let aiLatencyMs = 0;

  devLog("generating revision plan", {
    fileCount: ctx.files.length,
    noteCount: ctx.notes.length,
    summaryCount: ctx.summaries.length,
    quizCount: ctx.quizzes.length,
    contextLength: contextText.length,
  });
  telemetryLog("revision context prepared", {
    provider: providerInfo.configuredProvider,
    primaryProvider: providerInfo.primaryProvider,
    primaryModel: providerInfo.primaryModel,
    fallbackProvider: providerInfo.fallbackProvider,
    fallbackModel: providerInfo.fallbackModel,
    timeoutMs: providerInfo.timeoutMs,
    fastFallbackTimeoutMs: providerInfo.fastFallbackTimeoutMs,
    ...stats,
  });

  const today = new Date();
  const prompt = `${STUDYPILOT_TUTOR_INSTRUCTION}

You are creating a structured 7-day revision plan for a college student. Use ONLY the study material, summaries, and quiz information provided below. Do not hallucinate topics that are not present.

Your revision plan must:
1. Identify all major topics across the uploaded files, notes, and summaries.
2. Rank topics by importance (exam relevance, frequency in material, complexity).
3. Put every tracked weak quiz topic near the start of "revise_first" and schedule it early. Strong topics may receive lighter review.
4. Keep the plan full-chapter: weak topics receive extra priority, but they must not replace coverage of the full uploaded chapter/material.
5. Split the "revise_first" (highest priority, weakest areas or most exam-critical topics) from "pending_topics" (everything else).
6. Create a ${DEFAULT_PLAN_DAYS}-day daily plan. Each day should:
   - Focus on 2-4 topics (logical groupings, not random).
   - Include 3-5 concrete tasks (re-read notes, practice quiz, write explanation, solve examples, memorize memory lines).
   - Include an estimated study time.
7. Provide next steps for after the plan ends.
8. Give practical study tips.

Today's date is ${today.toISOString().split("T")[0]}. Generate date strings for each day starting from today.

STUDY MATERIAL AND SUMMARIES:
${contextText}

Return strict JSON only. Do not include markdown. The JSON shape must be:
{
  "title": "A descriptive title for this revision plan",
  "important_topics": ["string — all topics detected"],
  "revise_first": ["string — highest priority topics to revise first"],
  "pending_topics": ["string — remaining topics to schedule later"],
  "daily_plan": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "focus_topics": ["string"],
      "tasks": ["string — specific actionable task"],
      "estimated_time": "e.g. 2 hours"
    }
  ],
  "starts_on": "YYYY-MM-DD",
  "ends_on": "YYYY-MM-DD",
  "plan": {
    "total_days": ${DEFAULT_PLAN_DAYS},
    "next_steps": ["string — what to do after this plan"],
    "study_tips": ["string — practical revision tips"]
  }
}`;

  telemetryLog("revision ai request started", {
    provider: providerInfo.configuredProvider,
    primaryProvider: providerInfo.primaryProvider,
    primaryModel: providerInfo.primaryModel,
    fallbackProvider: providerInfo.fallbackProvider,
    fallbackModel: providerInfo.fallbackModel,
    timeoutMs: providerInfo.timeoutMs,
    promptChars: prompt.length,
    contextChars: stats.contextChars,
    originalFileTextChars: stats.originalFileTextChars,
    includedFileTextChars: stats.includedFileTextChars,
    fullExtractedTextSent: stats.fullExtractedTextSent,
  });

  const aiStartedAt = Date.now();
  let response = "";
  const providerResultRef: { current: AIProviderResult | null } = { current: null };
  try {
    response = await generateLocalizedText(prompt, language, (localizedPrompt) =>
      generateRevisionAITextWithMetadata(localizedPrompt, {
        temperature: 0.25,
        maxOutputTokens: 6000,
        responseMimeType: "application/json",
        timeoutMs: providerInfo.timeoutMs,
        signal,
        telemetry(event) {
          telemetryEvents.push(event);
          if (event.event === "provider_started" || event.event === "final_provider") {
            if (event.provider !== "auto") actualProvider = event.provider;
            if (event.model) actualModel = event.model;
            if (event.timeoutMs) actualTimeoutMs = event.timeoutMs;
          }
          if (event.event === "provider_finished" && typeof event.durationMs === "number") {
            aiLatencyMs = event.durationMs;
          }
        },
      }).then((result) => {
        providerResultRef.current = result;
        return result.text;
      }),
    );
  } catch (error) {
    const failed = telemetryEvents.findLast((event) => event.event === "provider_failed");
    telemetryLog("revision ai request failed", {
      provider: failed?.provider ?? actualProvider,
      model: failed?.model ?? actualModel,
      timeoutMs: failed?.timeoutMs ?? actualTimeoutMs,
      aiLatencyMs: failed?.durationMs ?? Date.now() - aiStartedAt,
      promptChars: prompt.length,
      contextChars: stats.contextChars,
      originalFileTextChars: stats.originalFileTextChars,
      includedFileTextChars: stats.includedFileTextChars,
      fullExtractedTextSent: stats.fullExtractedTextSent,
      errorKind: failed?.errorKind ?? "request",
    });
    throw error;
  }

  telemetryLog("revision ai request completed", {
    provider: actualProvider,
    model: actualModel,
    timeoutMs: actualTimeoutMs,
    aiLatencyMs: aiLatencyMs || Date.now() - aiStartedAt,
    promptChars: prompt.length,
    contextChars: stats.contextChars,
    responseChars: response.length,
    originalFileTextChars: stats.originalFileTextChars,
    includedFileTextChars: stats.includedFileTextChars,
    fullExtractedTextSent: stats.fullExtractedTextSent,
    responseMode: providerResultRef.current?.responseMode ?? null,
    providerFailureCategory: providerResultRef.current?.providerFailureCategory ?? null,
  });

  const unavailableMessage = providerUnavailableMessage(providerResultRef.current, actualProvider);
  if (unavailableMessage) {
    devLog("AI revision provider unavailable", {
      provider: actualProvider,
      model: actualModel,
      responseMode: providerResultRef.current?.responseMode ?? null,
      providerFailureCategory: providerResultRef.current?.providerFailureCategory ?? null,
      responseChars: response.length,
    });
    throw new Error(unavailableMessage);
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[DEBUG] REVISION raw AI response:", {
      provider: actualProvider,
      model: actualModel,
      rawLength: response.length,
      rawPreview: response.slice(0, 500),
      startsWithFence: response.trimStart().startsWith("```"),
      leadingProse: response.trimStart()[0] !== "{",
    });
  }

  const parseAttempt = parseJsonWithDiagnostics(response);
  devLog("AI revision response received", {
    provider: actualProvider,
    model: actualModel,
    parseMethod: parseAttempt.method,
    parseError: parseAttempt.error,
    shape: responseDebugShape(response, parseAttempt.parsed),
  });

  let parsed = parseAttempt.parsed;
  let plan: RevisionPlan | null = null;
  let validationError: string | null = null;

  if (parsed) {
    try {
      plan = validateRevisionPlan(parsed, ctx);
    } catch (error) {
      validationError = error instanceof Error ? error.message : "AI revision plan schema validation failed.";
      devLog("AI revision schema validation failed", {
        provider: actualProvider,
        model: actualModel,
        error: validationError,
        shape: responseDebugShape(response, parsed),
      });
    }
  }

  if (process.env.NODE_ENV !== "production") {
    console.log("[DEBUG] REVISION validation:", {
      parseMethod: parseAttempt.method,
      parseError: parseAttempt.error,
      parsedKeys: parsed ? Object.keys(parsed) : null,
      validationPassed: !!plan,
      validationError,
    });
  }

  const providerResult = providerResultRef.current;
  const isProviderFailure =
    !providerResult ||
    providerResult.responseMode === "offline_fallback" ||
    !providerResult.text.trim() ||
    (providerResult.providerFailureCategory &&
      ["timeout", "quota", "busy", "auth", "config", "request"].includes(providerResult.providerFailureCategory));

  if (!plan && !isProviderFailure) {
    const failureReason = parseAttempt.error
      ? `JSON parse failed: ${parseAttempt.error}`
      : validationError ?? "Revision plan schema validation failed.";
    devLog("AI revision JSON repair started", {
      provider: actualProvider,
      model: actualModel,
      failureReason,
      rawLength: response.length,
    });

    const repairedResponse = await repairRevisionJson({
      response,
      language,
      failureReason,
      providerInfo,
      telemetryEvents,
      signal,
    });
    const repairUnavailableMessage = providerUnavailableMessage(repairedResponse.result, actualProvider);
    if (repairUnavailableMessage) {
      devLog("AI revision repair provider unavailable", {
        responseMode: repairedResponse.result?.responseMode ?? null,
        providerFailureCategory: repairedResponse.result?.providerFailureCategory ?? null,
        responseChars: repairedResponse.text.length,
      });
      throw new Error(repairUnavailableMessage);
    }

    const repairedParse = parseJsonWithDiagnostics(repairedResponse.text);
    devLog("AI revision repair response received", {
      parseMethod: repairedParse.method,
      parseError: repairedParse.error,
      shape: responseDebugShape(repairedResponse.text, repairedParse.parsed),
    });
    parsed = repairedParse.parsed;
    if (parsed) {
      try {
        plan = validateRevisionPlan(parsed, ctx);
      } catch (error) {
        validationError = error instanceof Error ? error.message : "AI revision plan schema validation failed.";
        devLog("AI revision repaired schema validation failed", {
          error: validationError,
          shape: responseDebugShape(repairedResponse.text, parsed),
        });
      }
    }
  } else if (!plan && isProviderFailure) {
    devLog("AI revision skipping JSON repair due to provider failure", {
      provider: actualProvider,
      model: actualModel,
      responseMode: providerResult?.responseMode ?? null,
      providerFailureCategory: providerResult?.providerFailureCategory ?? null,
      hasText: Boolean(providerResult?.text?.trim()),
    });
  }

  if (!plan) {
    throw new Error("AI returned a plan format StudyPilot could not read. Please try again.");
  }

  devLog("revision plan validated", {
    title: plan.title,
    importantTopics: plan.important_topics.length,
    reviseFirst: plan.revise_first.length,
    pendingTopics: plan.pending_topics.length,
    dailyPlanDays: plan.daily_plan.length,
    starts_on: plan.starts_on,
    ends_on: plan.ends_on,
  });

  return plan;
}

function revisionSchemaRepairPrompt(rawResponse: string, failureReason: string) {
  return `Repair the revision plan payload below into one complete, valid JSON object.
Return JSON only, with no markdown or commentary. Preserve the original facts, topics, dates, and tasks. Do not invent new study content.

The JSON object must match this exact schema:
{
  "title": "string",
  "important_topics": ["string"],
  "revise_first": ["string"],
  "pending_topics": ["string"],
  "daily_plan": [
    {
      "day": 1,
      "date": "YYYY-MM-DD",
      "focus_topics": ["string"],
      "tasks": ["string"],
      "estimated_time": "string"
    }
  ],
  "starts_on": "YYYY-MM-DD",
  "ends_on": "YYYY-MM-DD",
  "plan": {
    "total_days": 7,
    "next_steps": ["string"],
    "study_tips": ["string"]
  }
}

Rules:
- Convert camelCase or alternate field names to the snake_case schema above.
- If the payload is wrapped in Markdown or prose, keep only the JSON object.
- If a required field is genuinely absent or empty, return the best valid JSON only if the missing value is explicitly present elsewhere in the payload.
- Discard impossible malformed fragments rather than inventing unsupported study content.

Failure reason:
${failureReason.slice(0, 500)}

PAYLOAD TO REPAIR:
${rawResponse.slice(0, 12000)}`;
}

async function repairRevisionJson({
  response,
  language,
  failureReason,
  providerInfo,
  telemetryEvents,
  signal,
}: {
  response: string;
  language: SupportedLanguageCode;
  failureReason: string;
  providerInfo: ReturnType<typeof getAIProviderRuntimeInfo>;
  telemetryEvents: AIProviderTelemetryEvent[];
  signal?: AbortSignal;
}) {
  const repairStartedAt = Date.now();
  let repairProvider = providerInfo.primaryProvider;
  let repairModel = providerInfo.primaryModel;
  let repairTimeoutMs = providerInfo.timeoutMs;
  const repairResultRef: { current: AIProviderResult | null } = { current: null };
  const repairResponse = await generateLocalizedText(revisionSchemaRepairPrompt(response, failureReason), language, (localizedPrompt) =>
    generateAITextWithMetadata(localizedPrompt, {
      temperature: 0,
      maxOutputTokens: 5200,
      responseMimeType: "application/json",
      timeoutMs: providerInfo.timeoutMs,
      signal,
      telemetry(event) {
        telemetryEvents.push(event);
        if (event.event === "provider_started" || event.event === "final_provider") {
          if (event.provider !== "auto") repairProvider = event.provider;
          if (event.model) repairModel = event.model;
          if (event.timeoutMs) repairTimeoutMs = event.timeoutMs;
        }
      },
    }).then((result) => {
      repairResultRef.current = result;
      return result.text;
    }),
  );

  telemetryLog("revision ai repair completed", {
    provider: repairProvider,
    model: repairModel,
    timeoutMs: repairTimeoutMs,
    aiLatencyMs: Date.now() - repairStartedAt,
    responseChars: repairResponse.length,
    responseMode: repairResultRef.current?.responseMode ?? null,
    providerFailureCategory: repairResultRef.current?.providerFailureCategory ?? null,
  });

  return { text: repairResponse, result: repairResultRef.current };
}

function providerUnavailableMessage(result: AIProviderResult | null, provider: string) {
  if (!result) return null;
  if (result.responseMode !== "offline_fallback" && result.text.trim()) return null;
  if (result.providerFailureCategory === "quota") return "Free AI limit reached. Please try again later.";
  if (result.providerFailureCategory === "timeout") return "StudyPilot AI timed out while creating the revision plan. Please try again.";
  if (result.providerFailureCategory) return "StudyPilot AI could not create a revision plan right now. Please try again.";
  if (!result.text.trim()) return `StudyPilot AI returned an empty revision response from ${provider}. Please try again.`;
  return null;
}
