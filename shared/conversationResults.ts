export const CONVERSATION_RESULT_KINDS = [
  "text",
  "file_reference",
  "source_citations",
  "summary",
  "generated_image",
  "diagram",
  "web_search",
  "deep_research",
  "notes",
  "quiz",
  "quiz_result",
  "learning_state_result",
  "revision_plan",
  "exam_questions",
  "viva_questions",
  "tool_status",
  "tool_result",
  "system",
] as const;

export type ConversationResultKind = (typeof CONVERSATION_RESULT_KINDS)[number];

export type ConversationResult = {
  version: 1;
  kind: ConversationResultKind;
  payload?: unknown;
  text?: string;
  artifact_id?: string;
  title?: string;
  status?: "completed" | "failed" | "cancelled";
  provenance?: {
    file_ids?: string[];
    note_ids?: string[];
    topic?: string;
    language?: string;
  };
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function validKind(value: unknown): value is ConversationResultKind {
  return typeof value === "string"
    && (CONVERSATION_RESULT_KINDS as readonly string[]).includes(value);
}

export function createConversationResult(
  kind: ConversationResultKind,
  payload?: unknown,
  options: Omit<ConversationResult, "version" | "kind" | "payload"> = {},
): ConversationResult {
  return { version: 1, kind, ...(payload === undefined ? {} : { payload }), ...options };
}

/**
 * Reads the versioned result envelope and the legacy Voice `voice_turn`
 * envelope. This is the single compatibility boundary used by Chat and Voice.
 */
export function readConversationResult(answer: unknown): ConversationResult | null {
  const root = record(answer);
  if (!root) return null;

  const current = record(root.conversation_result ?? root.conversationResult);
  if (current && validKind(current.kind)) {
    return {
      version: 1,
      kind: current.kind,
      ...(current.payload === undefined ? {} : { payload: current.payload }),
      ...(typeof current.text === "string" ? { text: current.text } : {}),
      ...(typeof current.artifact_id === "string" ? { artifact_id: current.artifact_id } : {}),
      ...(typeof current.title === "string" ? { title: current.title } : {}),
      ...(current.status === "completed" || current.status === "failed" || current.status === "cancelled"
        ? { status: current.status }
        : {}),
      ...(record(current.provenance) ? { provenance: current.provenance as ConversationResult["provenance"] } : {}),
    };
  }

  const legacy = record(root.voice_turn);
  if (legacy && validKind(legacy.kind)) {
    return {
      version: 1,
      kind: legacy.kind,
      ...(legacy.payload === undefined ? {} : { payload: legacy.payload }),
      ...(typeof legacy.text === "string" ? { text: legacy.text } : {}),
    };
  }
  return null;
}

export function withConversationResult<T extends RecordValue>(
  answer: T,
  result: ConversationResult,
): T & { conversation_result: ConversationResult } {
  return { ...answer, conversation_result: result };
}
