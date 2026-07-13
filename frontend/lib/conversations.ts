"use client";

import type { Conversation, ConversationMessage, ContextMode } from "./conversationTypes";

// Thin Typed wrappers around the Phase 1A conversation REST endpoints. These
// helpers purely own fetch (de)serialisation and friendly error messages —
// every validation/ownership check still lives server-side so callers never
// have to second-guess constraints.
//
// Notes:
//  - We never silently swallow 404s: callers use status to drive UI.
//  - We never persist anything to localStorage/sessionStorage.
//  - Methods are intentionally per-resource for readability. The component
//    layer may compose them as needed.

export type ListResult =
  | { ok: true; conversations: Conversation[] }
  | { ok: false; status: number; message: string };

export async function listConversations(query?: string): Promise<ListResult> {
  const url = query ? `/api/conversations?q=${encodeURIComponent(query)}` : "/api/conversations";
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store" });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    const message = await safeError(res);
    return { ok: false, status: res.status, message };
  }

  const data = (await res.json()) as { conversations?: Conversation[] };
  return { ok: true, conversations: data.conversations ?? [] };
}

export type CreateResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; status: number; message: string };

export async function createConversation(payload: {
  title?: string;
  contextMode?: ContextMode;
  activeFileIds?: string[];
  activeNoteIds?: string[];
}): Promise<CreateResult> {
  let res: Response;
  try {
    res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        context_mode: payload.contextMode ?? "general",
        active_file_ids: payload.activeFileIds ?? [],
        active_note_ids: payload.activeNoteIds ?? [],
      }),
    });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeError(res) };
  }

  const data = (await res.json()) as { conversation: Conversation };
  return { ok: true, conversation: data.conversation };
}

export type GetResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; status: number; message: string };

export async function getConversation(id: string): Promise<GetResult> {
  let res: Response;
  try {
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: "no-store" });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeError(res) };
  }

  const data = (await res.json()) as { conversation: Conversation };
  return { ok: true, conversation: data.conversation };
}

export type MessagesResult =
  | { ok: true; messages: ConversationMessage[] }
  | { ok: false; status: number; message: string };

// Fetch the full chronological message list for a conversation. The API is
// paginated, but for Phase 1B only the first (most recent 100) page is
// hydrated up-front into the chat — that keeps the UI linear and well under
// the response-size guard while remaining simple to extend later.
export async function getMessages(id: string): Promise<MessagesResult> {
  let res: Response;
  try {
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages?limit=100&direction=asc`, {
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeError(res) };
  }

  const data = (await res.json()) as { messages?: ConversationMessage[] };
  return { ok: true, messages: data.messages ?? [] };
}

export type PatchResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; status: number; message: string };

// PATCH is intentionally granular — callers only include fields they need to
// change so they do not stomp on each other.
export async function patchConversation(
  id: string,
  patch: {
    title?: string | null;
    pinned?: boolean;
    contextMode?: ContextMode;
    activeFileIds?: string[];
    activeNoteIds?: string[];
  },
): Promise<PatchResult> {
  const body: Record<string, unknown> = {};
  if ("title" in patch) body.title = patch.title;
  if ("pinned" in patch) body.pinned = patch.pinned;
  if ("contextMode" in patch) body.context_mode = patch.contextMode;
  if ("activeFileIds" in patch) body.active_file_ids = patch.activeFileIds;
  if ("activeNoteIds" in patch) body.active_note_ids = patch.activeNoteIds;

  let res: Response;
  try {
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeError(res) };
  }

  const data = (await res.json()) as { conversation: Conversation };
  return { ok: true, conversation: data.conversation };
}

export type DeleteResult =
  | { ok: true; id: string }
  | { ok: false; status: number; message: string };

export async function deleteConversation(id: string): Promise<DeleteResult> {
  let res: Response;
  try {
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeError(res) };
  }

  return { ok: true, id };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function safeError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error || "Request failed.";
  } catch {
    return "Request failed.";
  }
}

/**
 * Derive a short title from the first meaningful user question.
 * Greetings / very short inputs / nothing-but-punctuation never become a
 * title — faithful to the requirement that greetings alone must not title the
 * conversation.
 *
 * Mirrors only the *shape* of backend/lib/greetingDetector.ts — the same
 * regex set — so titles generated on the client match the server's idea of a
 * greeting. If the question is a greeting this returns null and the caller
 * leaves the conversation untitled until a real question appears.
 */
const GREETING_PATTERNS: RegExp[] = [
  /^hel+o+[!?.,\s]*$/i,
  /^h[iíì]+[!?.,\s]*$/i,
  /^hey+(\s+(?:there|studypilot|study\s*pilot))?[!?.,\s]*$/i,
  /^h[ae]llo+(\s+(?:there|studypilot|study\s*pilot))?[!?.,\s]*$/i,
  /^good\s+(morning|afternoon|evening|night)[!?.,\s]*$/i,
  /^good\s+day[!?.,\s]*$/i,
  /^sup[!?.,\s]*$/i,
  /^yo[!?.,\s]*$/i,
  /^greetings[!?.,\s]*$/i,
  /^howdy[!?.,\s]*$/i,
  /^namaste[!?.,\s]*$/i,
  /^vanakkam[!?.,\s]*$/i,
  /^how\s+are\s+(you|u)\??[!?.,\s]*$/i,
  /^how\s+r\s+u\??[!?.,\s]*$/i,
  /^what['']?s\s+up[!?.,\s]*$/i,
  /^how\s+do\s+you\s+do[!?.,\s]*$/i,
  /^you\s+there\??[!?.,\s]*$/i,
  /^thank(s|\s+you|\s+u)?[!?.,\s]*$/i,
  /^thank(s|\s+you|\s+u)?(\s+so\s+much|\s+a\s+lot|\s+very\s+much)?[!?.,\s]*$/i,
  /^ty[!?.,\s]*$/i,
  /^thx[!?.,\s]*$/i,
  /^dhanyavaad(am)?[!?.,\s]*$/i,
  /^shukriya[!?.,\s]*$/i,
  /^bye[!?.,\s]*$/i,
  /^good\s+bye[!?.,\s]*$/i,
  /^goodbye[!?.,\s]*$/i,
  /^see\s+(you|ya)\s*(later|soon|around)?[!?.,\s]*$/i,
  /^cya[!?.,\s]*$/i,
  /^take\s+care[!?.,\s]*$/i,
  /^later[!?.,\s]*$/i,
  /^ok(ay)?[!?.,\s]*$/i,
  /^sure[!?.,\s]*$/i,
  /^alright[!?.,\s]*$/i,
  /^cool[!?.,\s]*$/i,
  /^great[!?.,\s]*$/i,
  /^nice[!?.,\s]*$/i,
  /^got\s+it[!?.,\s]*$/i,
  /^sounds\s+good[!?.,\s]*$/i,
];

function isGreeting(question: string): boolean {
  return GREETING_PATTERNS.some((pattern) => pattern.test(question.trim()));
}

const MAX_TITLE_LENGTH = 80;

export function shortTitleFromQuestion(question: string): string | null {
  const trimmed = question.trim();
  if (!trimmed) return null;
  if (isGreeting(trimmed)) return null;
  // Collapse whitespace and trim to a short headline length.
  const collapsed = trimmed.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > MAX_TITLE_LENGTH ? `${collapsed.slice(0, MAX_TITLE_LENGTH - 1)}…` : collapsed;
}
