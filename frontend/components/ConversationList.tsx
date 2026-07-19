"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Conversation } from "@/frontend/lib/conversationTypes";
import { formatConversationTimestamp } from "@/frontend/lib/chatPersistence";
import {
  IconChat,
  IconEdit,
  IconMoreHorizontal,
  IconPin,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from "./icons";

// ConversationList is the ChatGPT-style left panel inside /chat. It supports:
//  - New chat
//  - Pinned / recent sections (pinned first when present)
//  - Search filter (title-based, debounced)
//  - Open / Rename / Pin / Unpin / Delete (with confirmation)
//  - Loading, empty and error states
//  - Desktop compact sidebar (always visible on lg+) and a mobile drawer/sheet
//  - Fully keyboard accessible; Escape closes dialogs and the mobile drawer
//
// State about the active conversation lives one level up — this component is
// purely presentational + dispatches local optimistic actions upward via
// callbacks. It never persists anything to localStorage/sessionStorage.

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  /** Whether the legacy "Previous Study Chat" view is currently active. */
  legacyActive: boolean;
  /** Provided only when legacy assistant_questions rows exist. */
  hasLegacy: boolean;
  /** Disable the New chat button (e.g. mid-request). */
  newDisabled?: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void | Promise<void>;
  onTogglePin: (id: string, pinned: boolean) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onOpenLegacy: () => void;

  /** Mobile drawer open state (drawer is rendered separately by parent). */
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

const RECENT_LIMIT = 40;

export function ConversationList({
  conversations,
  activeId,
  loading,
  error,
  legacyActive,
  hasLegacy,
  newDisabled,
  onSelect,
  onNew,
  onRename,
  onTogglePin,
  onDelete,
  onOpenLegacy,
  mobileOpen,
  onCloseMobile,
}: Props) {
  // Search filter; debounced via parent? No — local-only filter applied to
  // the conversations already passed in. The parent already asked the server
  // to filter when the query is set, but we also keep a quick substring here
  // so typing does not flicker.
  const [search, setSearch] = useState("");

  // Rename tracking: which conversation is being renamed and its draft value.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameId = useId();

  // Confirm-delete tracking.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const confirmMenuRef = useRef<HTMLDivElement>(null);

  // Per-row "more" menu — lightweight, only one open at a time.
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Escape closes any open menu / rename / confirm.
  useEffect(() => {
    if (!renamingId && !confirmingId && !menuId && !mobileOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setRenamingId(null);
        setRenameValue("");
        setConfirmingId(null);
        setMenuId(null);
        onCloseMobile();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirmingId, menuId, mobileOpen, onCloseMobile, renamingId]);

  // Close the "more" menu / confirm row on outside clicks.
  useEffect(() => {
    if (!menuId && !confirmingId) return;
    function handle(e: MouseEvent) {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) setMenuId(null);
      if (confirmMenuRef.current && !confirmMenuRef.current.contains(target)) {
        setConfirmingId(null);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [confirmingId, menuId]);

  // Focus the rename input when entering rename mode.
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const filtered = search.trim()
    ? conversations.filter((c) =>
        (c.title ?? "Untitled chat").toLowerCase().includes(search.trim().toLowerCase()),
      )
    : conversations;

  const pinned = filtered.filter((c) => c.pinned);
  const recent = filtered.filter((c) => !c.pinned).slice(0, RECENT_LIMIT);

  function startRename(c: Conversation) {
    setMenuId(null);
    setRenamingId(c.id);
    setRenameValue(c.title ?? "");
  }

  function confirmRename() {
    if (!renamingId) return;
    const trimmed = renameValue.trim().slice(0, 200);
    setRenamingId(null);
    setRenameValue("");
    if (trimmed) onRename(renamingId, trimmed);
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameValue("");
  }

  const panel = renderPanel();

  return (
    <>
      {/* Desktop compact sidebar */}
      <aside
        className="hidden w-[272px] shrink-0 flex-col gap-3 border-r border-white/[0.06] bg-slate-950/70 p-3 lg:flex"
        aria-label="Conversations"
      >
        {panel}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Conversations">
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close conversations"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            tabIndex={-1}
          />
          <div className="absolute inset-y-0 left-0 flex w-[88vw] max-w-[340px] flex-col gap-3 bg-slate-950 p-3 shadow-2xl shadow-black/50 animate-fade-in">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Conversations</span>
              <button
                type="button"
                onClick={onCloseMobile}
                aria-label="Close"
                className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <IconX size={16} />
              </button>
            </div>
            {panel}
          </div>
        </div>
      ) : null}
    </>
  );

  function renderPanel() {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        {/* New chat + search */}
        <div className="grid gap-2">
          <button
            type="button"
            onClick={onNew}
            disabled={newDisabled}
            className="inline-flex h-10 w-full items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
          >
            <IconPlus size={16} />
            New chat
          </button>
          <div className="relative">
            <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats"
              aria-label="Search conversations"
              className="h-9 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/40 focus-visible:ring-2 focus-visible:ring-emerald-400/40 placeholder:text-slate-500"
            />
          </div>
        </div>

        {/* Body: loading / error / empty / lists */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
          {loading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState message={error} />
          ) : filtered.length === 0 && !hasLegacy && !search.trim() ? (
            <EmptyState onNew={onNew} />
          ) : filtered.length === 0 && search.trim() ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-6 text-center">
              <p className="text-sm font-medium text-slate-200">No matches</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Try a shorter title or start a new chat.</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {pinned.length ? (
                <section>
                  <h3 className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-amber-200/80">Pinned</h3>
                  <ul className="grid gap-0.5">
                    {pinned.map((c) => row(c))}
                  </ul>
                </section>
              ) : null}
              {recent.length ? (
                <section>
                  <h3 className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent</h3>
                  <ul className="grid gap-0.5">
                    {recent.map((c) => row(c))}
                  </ul>
                </section>
              ) : null}
              {hasLegacy ? (
                <section>
                  <h3 className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Previous chats</h3>
                  <button
                    type="button"
                    onClick={onOpenLegacy}
                    className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40 ${
                      legacyActive
                        ? "border-emerald-300/30 bg-emerald-400/[0.12] text-emerald-100 shadow-inner shadow-emerald-950/20"
                        : "border-transparent text-slate-300 hover:border-white/10 hover:bg-white/[0.06]"
                    }`}
                  >
                    <IconChat size={14} className="shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate">Previous Study Chat</span>
                    <span className="shrink-0 rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
                      Read-only
                    </span>
                  </button>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  function row(c: Conversation) {
    const isActive = activeId === c.id && !legacyActive;
    const renaming = renamingId === c.id;
    const confirming = confirmingId === c.id;
    const menuOpen = menuId === c.id;
    const title = c.title ?? "Untitled chat";
    const timestamp = formatConversationTimestamp(c.updated_at || c.created_at);
    return (
      <li key={c.id} className="relative">
        {renaming ? (
          <label htmlFor={renameId} className="grid gap-1">
            <span className="sr-only">Conversation title</span>
            <input
              id={renameId}
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmRename();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelRename();
                }
              }}
              onBlur={() => {
                // commit on blur unless already cleared
                if (renamingId === c.id) confirmRename();
              }}
              maxLength={200}
              className="h-9 w-full rounded-lg border border-emerald-300/40 bg-slate-900 px-2 text-sm text-slate-100 outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
            />
          </label>
        ) : (
          <div
            className={`group relative flex items-center gap-1 rounded-lg border pl-2.5 pr-1 transition focus-within:border-emerald-300/35 focus-within:bg-white/[0.06] ${
              isActive
                ? "border-emerald-300/35 bg-emerald-400/[0.12] shadow-inner shadow-emerald-950/20"
                : "border-transparent hover:border-white/10 hover:bg-white/[0.06]"
            }`}
          >
            {isActive ? <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-emerald-300" aria-hidden="true" /> : null}
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              className="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-1.5 text-left focus-visible:outline-none"
              aria-current={isActive ? "true" : undefined}
              title={title}
            >
              {c.pinned ? <IconPin size={12} className="shrink-0 text-amber-200" /> : <IconChat size={14} className="shrink-0 text-slate-400" />}
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-sm font-medium ${isActive ? "text-emerald-100" : "text-slate-300"}`}>
                  {title}
                </span>
                {timestamp ? (
                  <time
                    dateTime={c.updated_at || c.created_at}
                    suppressHydrationWarning
                    className={`mt-0.5 block truncate text-[11px] ${isActive ? "text-emerald-100/65" : "text-slate-500"}`}
                  >
                    {timestamp}
                  </time>
                ) : null}
              </span>
            </button>

            {/* Per-row more menu trigger */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuId(menuOpen ? null : c.id);
                setConfirmingId(null);
              }}
              aria-label="Conversation options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
            >
              <IconMoreHorizontal size={16} />
            </button>
          </div>
        )}

        {/* Per-row menu */}
        {menuOpen && !renaming ? (
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Options for ${title}`}
            className="absolute right-1 top-9 z-30 w-44 overflow-hidden rounded-xl border border-white/10 bg-slate-900 p-1 shadow-2xl shadow-black/50"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => startRename(c)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-200 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
            >
              <IconEdit size={14} className="text-slate-400" /> Rename
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuId(null);
                void onTogglePin(c.id, !c.pinned);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-200 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
            >
              <IconPin size={14} className="text-slate-400" />
              {c.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setConfirmingId(c.id);
                setMenuId(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-200 transition hover:bg-red-300/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/40"
            >
              <IconTrash size={14} /> Delete
            </button>
          </div>
        ) : null}

        {/* Inline delete confirmation */}
        {confirming && !renaming ? (
          <div
            ref={confirmMenuRef}
            role="alertdialog"
            aria-label={`Delete ${title}`}
            className="absolute left-0 right-0 top-9 z-30 rounded-xl border border-red-300/30 bg-slate-900 p-3 text-sm shadow-2xl shadow-black/50"
          >
            <p className="text-slate-200">Delete this conversation?</p>
            <p className="mt-1 text-xs text-slate-400">This cannot be undone.</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingId(null)}
                className="h-8 flex-1 rounded-lg border border-white/10 bg-white/5 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setConfirmingId(null);
                  await onDelete(c.id);
                }}
                className="h-8 flex-1 rounded-lg border border-red-300/30 bg-red-400/15 text-xs font-semibold text-red-100 transition hover:bg-red-400/25"
              >
                Delete
              </button>
            </div>
          </div>
        ) : null}
      </li>
    );
  }
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-1.5 p-2" aria-live="polite">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-9 rounded-lg bg-white/[0.04] animate-shimmer" />
      ))}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="m-2 rounded-lg border border-red-300/25 bg-red-300/[0.08] p-3 text-sm leading-6 text-red-100">
      {message}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-4 text-center">
      <div className="mx-auto grid h-9 w-9 place-items-center rounded-lg border border-emerald-300/20 bg-emerald-300/10 text-emerald-200">
        <IconChat size={16} />
      </div>
      <p className="text-sm font-semibold text-slate-200">No conversations yet</p>
      <p className="text-xs leading-5 text-slate-500">Ask a study question and it will stay here for later.</p>
      <button
        type="button"
        onClick={onNew}
        className="mt-1 inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 text-sm font-semibold text-emerald-100 transition hover:bg-emerald-400/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/40"
      >
        <IconPlus size={14} /> New chat
      </button>
    </div>
  );
}
