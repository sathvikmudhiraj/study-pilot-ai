export type ConversationStudyState = {
  active_subject?: string;
  active_topic?: string;
  active_subtopic?: string;
  active_task?: string;
  active_mode?: string;
  preferred_language?: string;
  detected_language?: string;
  voice_preference?: string;
  last_meaningful_intent?: string;
  current_artifact_id?: string;
  last_artifact_id?: string;
  last_artifact_kind?: string;
  generated_asset_ids?: string[];
  last_quiz_id?: string;
  last_revision_plan_id?: string;
  learning_goal?: string;
  unfinished_task?: Record<string, unknown>;
  follow_up_state?: Record<string, unknown>;
  updated_at?: string;
};

const TEXT_LIMITS = {
  active_subject: 240,
  active_topic: 240,
  active_subtopic: 240,
  active_task: 80,
  active_mode: 80,
  preferred_language: 40,
  detected_language: 40,
  voice_preference: 80,
  last_meaningful_intent: 80,
  current_artifact_id: 100,
  last_artifact_id: 100,
  last_artifact_kind: 80,
  last_quiz_id: 100,
  last_revision_plan_id: 100,
  learning_goal: 500,
} as const;

const RECORD_KEYS = ["unfinished_task", "follow_up_state"] as const;

function boundedRecord(value: unknown): Record<string, unknown> | undefined | null {
  if (value === null || value === "") return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const serialized = JSON.stringify(value);
  if (serialized.length > 4000) return null;
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function sanitizeStudyStatePatch(value: unknown): ConversationStudyState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const clean: ConversationStudyState = {};
  for (const [key, limit] of Object.entries(TEXT_LIMITS) as Array<[keyof typeof TEXT_LIMITS, number]>) {
    if (!(key in source)) continue;
    if (source[key] === null || source[key] === "") {
      clean[key] = undefined;
      continue;
    }
    if (typeof source[key] !== "string") return null;
    clean[key] = source[key].trim().slice(0, limit) || undefined;
  }
  if ("generated_asset_ids" in source) {
    if (source.generated_asset_ids === null) clean.generated_asset_ids = undefined;
    else if (!Array.isArray(source.generated_asset_ids)) return null;
    else clean.generated_asset_ids = [...new Set(source.generated_asset_ids
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 100))
      .filter(Boolean))].slice(0, 20);
  }
  for (const key of RECORD_KEYS) {
    if (!(key in source)) continue;
    const record = boundedRecord(source[key]);
    if (record === null) return null;
    clean[key] = record;
  }
  clean.updated_at = new Date().toISOString();
  return clean;
}
