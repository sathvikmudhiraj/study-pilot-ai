import type { Conversation } from "./conversationTypes";

export type RestoreDecision = {
  requestedConversationId: string | null;
  handledRequestedConversationId: string | null;
  loadingConversations: boolean;
  activeId: string | null;
  legacyActive: boolean;
  suppressLatestRestore: boolean;
  conversations: Conversation[];
};

export type RestoredAttachment = {
  id: string;
  label: string;
  type: "file" | "note";
};

function conversationTime(conversation: Conversation): number {
  const updated = Date.parse(conversation.updated_at);
  if (Number.isFinite(updated)) return updated;
  const created = Date.parse(conversation.created_at);
  return Number.isFinite(created) ? created : 0;
}

export function latestConversation(conversations: Conversation[]): Conversation | null {
  return conversations.reduce<Conversation | null>((latest, conversation) => {
    if (!latest) return conversation;
    return conversationTime(conversation) > conversationTime(latest) ? conversation : latest;
  }, null);
}

export function shouldOpenRequestedConversation(
  requestedConversationId: string | null,
  handledRequestedConversationId: string | null,
) {
  return Boolean(requestedConversationId && handledRequestedConversationId !== requestedConversationId);
}

export function latestConversationToRestore(decision: RestoreDecision): Conversation | null {
  if (decision.suppressLatestRestore) return null;
  if (decision.requestedConversationId) return null;
  if (decision.loadingConversations) return null;
  if (decision.activeId || decision.legacyActive) return null;
  return latestConversation(decision.conversations);
}

export function upsertConversationFirst(conversations: Conversation[], conversation: Conversation): Conversation[] {
  return [
    conversation,
    ...conversations.filter((current) => current.id !== conversation.id),
  ];
}

export function assistantIdsFromRows(rows: Array<{ id: string }>) {
  return new Set(rows.map((row) => row.id));
}

export function restoredAttachmentsFromConversation(
  conversation: Pick<Conversation, "active_file_ids" | "active_note_ids">,
  fileNamesById: Map<string, string>,
  noteNamesById: Map<string, string>,
): RestoredAttachment[] {
  return [
    ...(conversation.active_file_ids ?? []).map((id) => ({
      id,
      type: "file" as const,
      label: fileNamesById.get(id) ?? "Attached file",
    })),
    ...(conversation.active_note_ids ?? []).map((id) => ({
      id,
      type: "note" as const,
      label: noteNamesById.get(id) ?? "Attached note",
    })),
  ];
}

export function isComposerReadOnly(legacyActive: boolean) {
  return legacyActive;
}

export function isConversationEditable(legacyActive: boolean, activeId: string | null) {
  return Boolean(activeId && !legacyActive);
}

export function formatConversationTimestamp(iso: string, nowMs = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";
  const diffMs = Math.max(0, nowMs - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return "Just now";
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))}h ago`;
  if (diffMs < 7 * day) return `${Math.max(1, Math.floor(diffMs / day))}d ago`;

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}
