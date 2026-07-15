// Shared client-side types for the Phase 1B persistent-conversations UI.
// The shapes intentionally mirror the JSON returned by the Phase 1A APIs in
// app/api/conversations/** so the UI can be typed end-to-end without
// duplicating the server's row shape.

export const CONTEXT_MODES = ["general", "file", "web", "research", "image"] as const;
export type ContextMode = (typeof CONTEXT_MODES)[number];

export type Conversation = {
  id: string;
  title: string | null;
  pinned: boolean;
  context_mode: ContextMode;
  active_file_ids: string[] | null;
  active_note_ids: string[] | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: string;
  question: string;
  answer: unknown;
  related_file_ids: string[] | null;
  related_note_ids: string[] | null;
  conversation_id: string | null;
  created_at: string;
};

export type LegacyChat = {
  id: string;
  question: string;
  answer: unknown;
  related_file_ids: string[] | null;
  related_note_ids: string[] | null;
  created_at: string;
};

/**
 * Map a context_mode coming back from the API to a short human label used in
 * the chat header. Accepts unknown input defensively.
 */
export function contextModeLabel(mode: string | null | undefined): string {
  switch (mode) {
    case "file":
      return "Using file";
    case "web":
      return "Web Search";
    case "research":
      return "Deep Research";
    case "image":
      return "Image context";
    case "general":
    default:
      return "General AI knowledge";
  }
}

/**
 * Build the subtitle shown in the conversation header from the active
 * conversation's context mode and active file ids. File names (not UUIDs)
 * are shown because callers pass a map of id -> file_name.
 */
export function activeContextLabel(
  mode: ContextMode | null | undefined,
  fileNames: string[],
): string {
  const baseLabel = contextModeLabel(mode);
  if ((mode === "file" || mode === "image") && fileNames.length > 0) {
    return `Using ${fileNames.join(", ")}`;
  }
  return baseLabel;
}
