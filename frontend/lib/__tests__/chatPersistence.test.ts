import { describe, expect, it } from "vitest";
import type { Conversation } from "@/frontend/lib/conversationTypes";
import {
  assistantIdsFromRows,
  formatConversationTimestamp,
  isComposerReadOnly,
  isConversationEditable,
  latestConversationToRestore,
  restoredAttachmentsFromConversation,
  shouldOpenRequestedConversation,
  upsertConversationFirst,
} from "@/frontend/lib/chatPersistence";

function conversation(id: string, updatedAt: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: `Chat ${id}`,
    pinned: false,
    context_mode: "general",
    active_file_ids: null,
    active_note_ids: null,
    created_at: updatedAt,
    updated_at: updatedAt,
    ...overrides,
  };
}

describe("chat persistence helpers", () => {
  it("opens the latest conversation when there is no explicit URL or user selection", () => {
    const older = conversation("older", "2026-07-17T01:00:00.000Z");
    const latest = conversation("latest", "2026-07-17T03:00:00.000Z");

    expect(
      latestConversationToRestore({
        requestedConversationId: null,
        handledRequestedConversationId: null,
        loadingConversations: false,
        activeId: null,
        legacyActive: false,
        suppressLatestRestore: false,
        conversations: [older, latest],
      })?.id,
    ).toBe("latest");
  });

  it("does not override explicit user selection with latest-chat restore", () => {
    const latest = conversation("latest", "2026-07-17T03:00:00.000Z");

    expect(
      latestConversationToRestore({
        requestedConversationId: null,
        handledRequestedConversationId: null,
        loadingConversations: false,
        activeId: null,
        legacyActive: false,
        suppressLatestRestore: true,
        conversations: [latest],
      }),
    ).toBeNull();
  });

  it("restores a URL conversationId once and ignores duplicate URL handling", () => {
    expect(shouldOpenRequestedConversation("abc", null)).toBe(true);
    expect(shouldOpenRequestedConversation("abc", "abc")).toBe(false);
    expect(shouldOpenRequestedConversation(null, "abc")).toBe(false);
  });

  it("puts a newly created conversation at the top immediately without duplicates", () => {
    const existing = conversation("existing", "2026-07-17T01:00:00.000Z");
    const created = conversation("created", "2026-07-17T04:00:00.000Z");

    expect(upsertConversationFirst([existing], created).map((item) => item.id)).toEqual(["created", "existing"]);
    expect(upsertConversationFirst([created, existing], created).map((item) => item.id)).toEqual(["created", "existing"]);
  });

  it("keeps only true legacy chats read-only while current chats remain editable", () => {
    expect(isComposerReadOnly(true)).toBe(true);
    expect(isComposerReadOnly(false)).toBe(false);
    expect(isConversationEditable(true, "current")).toBe(false);
    expect(isConversationEditable(false, "current")).toBe(true);
    expect(isConversationEditable(false, null)).toBe(false);
  });

  it("restores timestamps and attachments for selected conversations", () => {
    const files = new Map([["file-1", "Algebra.pdf"]]);
    const notes = new Map([["note-1", "Exam notes"]]);
    const restored = restoredAttachmentsFromConversation(
      conversation("with-context", "2026-07-17T01:00:00.000Z", {
        active_file_ids: ["file-1", "missing-file"],
        active_note_ids: ["note-1"],
      }),
      files,
      notes,
    );

    expect(restored).toEqual([
      { id: "file-1", type: "file", label: "Algebra.pdf" },
      { id: "missing-file", type: "file", label: "Attached file" },
      { id: "note-1", type: "note", label: "Exam notes" },
    ]);
    expect(formatConversationTimestamp("2026-07-17T02:30:00.000Z", Date.parse("2026-07-17T03:00:00.000Z"))).toBe("30m ago");
  });

  it("tracks loaded assistant rows so duplicate message loading is prevented", () => {
    const ids = assistantIdsFromRows([{ id: "row-1" }, { id: "row-2" }, { id: "row-1" }]);

    expect(ids.has("row-1")).toBe(true);
    expect(ids.has("row-2")).toBe(true);
    expect(ids.size).toBe(2);
  });
});
