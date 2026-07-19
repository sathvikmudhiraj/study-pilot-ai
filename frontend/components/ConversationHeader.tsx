"use client";

import { useEffect, useId, useRef, useState } from "react";
import { activeContextLabel, type ContextMode } from "@/frontend/lib/conversationTypes";
import { IconChat, IconEdit, IconMenu } from "./icons";

// ConversationHeader renders the compact chat header above the message list.
// It is responsible for:
//   - Showing the active conversation title (with an inline rename affordance)
//   - Showing the active-context label (General / Using <file name> / Web
//     Search / Deep Research / Image context)
//   - Surfacing a mobile-only toggle that opens the conversation drawer
//   - Representing the legacy "Previous Study Chat" view as read-only (no rename)

type Props = {
  /** Active conversation id; null in the "not yet started" state or when legacy is active. */
  activeId: string | null;
  /** Title of the active conversation or null when untitled / new chat. */
  title: string | null;
  /** Current context mode; null means default/general. */
  contextMode: ContextMode | null;
  /** File names currently bound to the conversation (skip UUIDs). */
  activeFileNames: string[];
  /** True when the legacy read-only view is open. */
  legacyActive: boolean;
  /** Renaming is disabled while a request is in-flight. */
  renameDisabled?: boolean;
  onRename: (title: string) => void;
  onOpenMobileDrawer: () => void;
};

export function ConversationHeader({
  activeId,
  title,
  contextMode,
  activeFileNames,
  legacyActive,
  renameDisabled,
  onRename,
  onOpenMobileDrawer,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // Note: editing/draft state is reset when the parent re-mounts this header
  // via its `key` (which changes whenever activeId / legacyActive changes).
  // This avoids the "calling setState in effect" anti-pattern while keeping
  // the same UX guarantee that opening a different conversation exits the
  // inline-rename mode without carrying over the previous chat's title.

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  if (legacyActive) {
    return (
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 lg:pl-0">
          <button
            type="button"
            onClick={onOpenMobileDrawer}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
            aria-label="Open conversations"
          >
            <IconMenu size={16} />
          </button>
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400">
            <IconChat size={14} />
          </div>
          <h2 className="truncate text-sm font-semibold text-white">Previous Study Chat</h2>
        </div>
        <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-semibold text-slate-400">
          Read-only
        </span>
      </div>
    );
  }

  const displayedTitle = title ?? "New chat";
  const contextLabel = activeContextLabel(contextMode, activeFileNames);

  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {/* Mobile-only drawer toggle */}
        <button
          type="button"
          onClick={onOpenMobileDrawer}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
          aria-label="Open conversations"
        >
          <IconMenu size={16} />
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <label htmlFor={inputId} className="grid gap-1">
              <span className="sr-only">Conversation title</span>
              <input
                id={inputId}
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancel();
                  }
                }}
                onBlur={commit}
                maxLength={200}
                className="h-9 w-full max-w-md rounded-lg border border-emerald-300/40 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
              />
            </label>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-sm font-semibold text-white" title={displayedTitle}>
                {displayedTitle}
              </h2>
              {activeId && !renameDisabled ? (
                <button
                  type="button"
                  onClick={startEditing}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
                  aria-label="Rename conversation"
                  title="Rename"
                >
                  <IconEdit size={12} />
                </button>
              ) : null}
            </div>
          )}
          <p className="mt-0.5 truncate text-[11px] text-slate-400" title={contextLabel}>
            {contextLabel}
          </p>
        </div>
      </div>
    </div>
  );

  function startEditing() {
    setDraft(title ?? "");
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft("");
  }

  function commit() {
    const trimmed = draft.trim().slice(0, 200);
    setEditing(false);
    setDraft("");
    // Empty / whitespace-only rename keeps the current title.
    if (trimmed && trimmed !== title) onRename(trimmed);
  }
}
