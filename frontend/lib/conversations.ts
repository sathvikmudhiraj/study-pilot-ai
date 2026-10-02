"use client";

import type { Conversation, ConversationMessage, ConversationSearchResult, ContextMode } from "./conversationTypes";
import type { ConversationStudyState } from "@/shared/studyState";
import type { SupportedLanguageCode } from "@/shared/languages";

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
  | { ok: true; conversations: Conversation[]; nextCursor: string | null; hasMore: boolean }
  | { ok: false; status: number; message: string };

export async function listConversations(cursor?: string | null): Promise<ListResult> {
  const url = cursor ? `/api/conversations?cursor=${encodeURIComponent(cursor)}` : "/api/conversations";
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    const message = await safeError(res);
    return { ok: false, status: res.status, message };
  }

  const data = (await res.json()) as { conversations?: Conversation[]; next_cursor?: string | null; has_more?: boolean };
  return { ok: true, conversations: data.conversations ?? [], nextCursor: data.next_cursor ?? null, hasMore: Boolean(data.has_more) };
}

export type SearchResult =
  | { ok: true; results: ConversationSearchResult[] }
  | { ok: false; status: number; message: string };

export async function searchConversations(query: string, signal?: AbortSignal): Promise<SearchResult> {
  try {
    const res = await fetch(`/api/conversations/search?q=${encodeURIComponent(query)}`, {
      cache: "no-store", credentials: "same-origin", signal,
    });
    if (!res.ok) return { ok: false, status: res.status, message: await safeError(res) };
    const data = await res.json() as { results?: ConversationSearchResult[] };
    return { ok: true, results: data.results ?? [] };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }
}

export type CreateResult =
  | { ok: true; conversation: Conversation }
  | { ok: false; status: number; message: string };

export async function createConversation(payload: {
  title?: string;
  contextMode?: ContextMode;
  activeFileIds?: string[];
  activeNoteIds?: string[];
  language?: SupportedLanguageCode;
  studyState?: ConversationStudyState;
}): Promise<CreateResult> {
  let res: Response;
  try {
    res = await fetch("/api/conversations", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title,
        context_mode: payload.contextMode ?? "general",
        active_file_ids: payload.activeFileIds ?? [],
        active_note_ids: payload.activeNoteIds ?? [],
        language_code: payload.language,
        study_state: payload.studyState,
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
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { cache: "no-store", credentials: "same-origin" });
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
  | { ok: true; messages: ConversationMessage[]; nextCursor: string | null; hasMore: boolean }
  | { ok: false; status: number; message: string };

// Fetch the full chronological message list for a conversation. The API is
// paginated, but for Phase 1B only the first (most recent 100) page is
// hydrated up-front into the chat — that keeps the UI linear and well under
// the response-size guard while remaining simple to extend later.
export async function getMessages(id: string, cursor?: string | null): Promise<MessagesResult> {
  let res: Response;
  try {
    const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages?limit=60&direction=desc${cursorQuery}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeError(res) };
  }

  const data = (await res.json()) as { messages?: ConversationMessage[]; next_cursor?: string | null; has_more?: boolean };
  return { ok: true, messages: data.messages ?? [], nextCursor: data.next_cursor ?? null, hasMore: Boolean(data.has_more) };
}

export type CreateMessageResult =
  | { ok: true; message: ConversationMessage }
  | { ok: false; status: number; message: string };

export async function createConversationMessage(
  id: string,
  payload: { question: string; answer: Record<string, unknown>; relatedFileIds?: string[]; relatedNoteIds?: string[] },
): Promise<CreateMessageResult> {
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/messages`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: payload.question,
        answer: payload.answer,
        related_file_ids: payload.relatedFileIds ?? [],
        related_note_ids: payload.relatedNoteIds ?? [],
      }),
    });
    if (!res.ok) return { ok: false, status: res.status, message: await safeError(res) };
    const data = await res.json() as { message: ConversationMessage };
    return { ok: true, message: data.message };
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }
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
    language?: SupportedLanguageCode;
    studyState?: ConversationStudyState;
  },
): Promise<PatchResult> {
  const body: Record<string, unknown> = {};
  if ("title" in patch) body.title = patch.title;
  if ("pinned" in patch) body.pinned = patch.pinned;
  if ("contextMode" in patch) body.context_mode = patch.contextMode;
  if ("activeFileIds" in patch) body.active_file_ids = patch.activeFileIds;
  if ("activeNoteIds" in patch) body.active_note_ids = patch.activeNoteIds;
  if ("language" in patch) body.language_code = patch.language;
  if ("studyState" in patch) body.study_state = patch.studyState;

  let res: Response;
  try {
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "same-origin",
      cache: "no-store",
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

type DraftRecord = { id: string; draft_text: string; draft_version: number };
export type DraftResult =
  | { ok: true; draft: DraftRecord }
  | { ok: false; status: number; message: string; draft?: DraftRecord };

export async function saveConversationDraft(id: string, draft: string, version: number): Promise<DraftResult> {
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/draft`, {
      method: "PATCH", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft, version }),
    });
    const data = await res.json().catch(() => ({})) as { error?: string; draft?: DraftRecord };
    if (!res.ok) return { ok: false, status: res.status, message: data.error ?? "Could not save draft.", ...(data.draft ? { draft: data.draft } : {}) };
    return { ok: true, draft: data.draft! };
  } catch {
    return { ok: false, status: 0, message: "Network error. Check your connection and try again." };
  }
}

export type DeleteResult =
  | { ok: true; id: string }
  | { ok: false; status: number; message: string };

export async function deleteConversation(id: string): Promise<DeleteResult> {
  let res: Response;
  try {
    res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
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
