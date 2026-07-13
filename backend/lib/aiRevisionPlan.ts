import "server-only";

import { generateAIText } from "./aiProvider";
import { STUDYPILOT_TUTOR_INSTRUCTION } from "./tutorPrompt";

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

const MAX_TEXT_PER_FILE = 3000;
const DEFAULT_PLAN_DAYS = 7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[aiRevisionPlan] ${message}`, details ?? "");
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
// Build prompt from study context
// ---------------------------------------------------------------------------

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

  return sections.join("\n\n======\n\n");
}

// ---------------------------------------------------------------------------
// Validate and normalize Gemini response into RevisionPlan
// ---------------------------------------------------------------------------

function validateRevisionPlan(record: Record<string, unknown>, ctx: StudyContext): RevisionPlan {
  const title = String(record.title ?? "Revision Plan").trim() || "Revision Plan";
  const trackedWeakTopics = uniqueStrings(ctx.quiz_analytics.weak_topics, 20);
  const trackedStrongTopics = uniqueStrings(ctx.quiz_analytics.strong_topics, 20);
  const importantTopics = uniqueStrings(
    [...trackedWeakTopics, ...stringList(record.important_topics ?? record.importantTopics ?? record.topics)],
    30,
  );
  const reviseFirst = uniqueStrings(
    [...trackedWeakTopics, ...stringList(record.revise_first ?? record.reviseFirst ?? record.priority_topics)],
    20,
  );
  const weakKeys = new Set(trackedWeakTopics.map((topic) => topic.toLowerCase()));
  const pendingTopics = uniqueStrings(
    stringList(record.pending_topics ?? record.pendingTopics ?? record.remaining_topics).filter(
      (topic) => !weakKeys.has(topic.toLowerCase()),
    ),
    30,
  );

  // Parse daily plan
  const rawDaily = record.daily_plan ?? record.dailyPlan ?? [];
  const dailyPlan: DayPlan[] = (Array.isArray(rawDaily) ? rawDaily : [])
    .map((item: unknown, index: number) => {
      if (!item || typeof item !== "object") return null;
      const day = item as Record<string, unknown>;
      return {
        day: Number(day.day ?? day.day_number ?? index + 1) || index + 1,
        date: String(day.date ?? "").trim() || "",
        focus_topics: uniqueStrings(stringList(day.focus_topics ?? day.focusTopics ?? day.topics), 10),
        tasks: uniqueStrings(stringList(day.tasks ?? day.study_tasks ?? day.activities), 10),
        estimated_time: String(day.estimated_time ?? day.time ?? day.duration ?? "1 hour").trim() || "1 hour",
      };
    })
    .filter((item): item is DayPlan => Boolean(item))
    .slice(0, 14);

  // Parse plan metadata
  const rawPlan = record.plan ?? {};
  const plan: PlanMeta = {
    total_days: Number((rawPlan as Record<string, unknown>)?.total_days ?? (rawPlan as Record<string, unknown>)?.totalDays ?? dailyPlan.length) || dailyPlan.length || DEFAULT_PLAN_DAYS,
    next_steps: uniqueStrings(stringList((rawPlan as Record<string, unknown>)?.next_steps ?? (rawPlan as Record<string, unknown>)?.nextSteps ?? record.next_steps), 8),
    study_tips: uniqueStrings(stringList((rawPlan as Record<string, unknown>)?.study_tips ?? (rawPlan as Record<string, unknown>)?.studyTips ?? []), 8),
    strong_topics: trackedStrongTopics,
    weak_topics: trackedWeakTopics,
    last_quiz_score: ctx.quiz_analytics.last_quiz_score,
  };

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

export async function generateRevisionPlan(ctx: StudyContext): Promise<RevisionPlan> {
  const contextText = buildStudyContextText(ctx);

  devLog("generating revision plan", {
    fileCount: ctx.files.length,
    noteCount: ctx.notes.length,
    summaryCount: ctx.summaries.length,
    quizCount: ctx.quizzes.length,
    contextLength: contextText.length,
  });

  const today = new Date();
  const prompt = `${STUDYPILOT_TUTOR_INSTRUCTION}

You are creating a structured 7-day revision plan for a college student. Use ONLY the study material, summaries, and quiz information provided below. Do not hallucinate topics that are not present.

Your revision plan must:
1. Identify all major topics across the uploaded files, notes, and summaries.
2. Rank topics by importance (exam relevance, frequency in material, complexity).
3. Put every tracked weak quiz topic near the start of "revise_first" and schedule it early. Strong topics may receive lighter review.
4. Split the "revise_first" (highest priority, weakest areas or most exam-critical topics) from "pending_topics" (everything else).
5. Create a ${DEFAULT_PLAN_DAYS}-day daily plan. Each day should:
   - Focus on 2-4 topics (logical groupings, not random).
   - Include 3-5 concrete tasks (re-read notes, practice quiz, write explanation, solve examples, memorize memory lines).
   - Include an estimated study time.
6. Provide next steps for after the plan ends.
7. Give practical study tips.

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

  const response = await generateAIText(prompt, {
    temperature: 0.25,
    maxOutputTokens: 6000,
    responseMimeType: "application/json",
  });

  devLog("Gemini response received", { rawLength: response.length });

  const parsed = tryParseJson(response);
  if (!parsed) throw new Error("Gemini returned a plan format StudyPilot could not read. Please try again.");

  const plan = validateRevisionPlan(parsed, ctx);

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
