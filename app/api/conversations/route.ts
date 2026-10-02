import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";
import { isSupportedLanguageCode } from "@/shared/languages";
import { sanitizeStudyStatePatch } from "@/shared/studyState";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_CONTEXT_MODES = ["general", "file", "web", "research", "image"] as const;
type ContextMode = (typeof ALLOWED_CONTEXT_MODES)[number];

const MAX_TITLE_LENGTH = 200;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 50;
const MAX_FILE_IDS = 8;
const MAX_NOTE_IDS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns returned for list responses (no heavy data)
const CONVERSATION_LIST_SELECT =
  "id, title, pinned, context_mode, active_file_ids, active_note_ids, language_code, draft_text, draft_version, study_state, created_at, updated_at";
const LEGACY_CONVERSATION_LIST_SELECT = "id, title, created_at";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function isMissingOptionalConversationColumn(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");
  const lower = message.toLowerCase();
  return (
    (lower.includes("does not exist") || lower.includes("could not find")) &&
    (
      lower.includes("language_code") ||
      lower.includes("pinned") ||
      lower.includes("context_mode") ||
      lower.includes("active_file_ids") ||
      lower.includes("active_note_ids") ||
      lower.includes("draft_text") ||
      lower.includes("draft_version") ||
      lower.includes("study_state") ||
      lower.includes("updated_at")
    )
  );
}

function withDefaultLanguage<T extends Record<string, unknown>>(rows: T[] | null | undefined) {
  return (rows ?? []).map((row) => ({
    ...row,
    pinned: row.pinned ?? false,
    context_mode: row.context_mode ?? "general",
    active_file_ids: row.active_file_ids ?? [],
    active_note_ids: row.active_note_ids ?? [],
    language_code: row.language_code ?? "en",
    draft_text: row.draft_text ?? "",
    draft_version: row.draft_version ?? 0,
    study_state: row.study_state ?? {},
    updated_at: row.updated_at ?? row.created_at,
  }));
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function cleanIds(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? "").trim().toLowerCase())
        .filter((item) => UUID_RE.test(item)),
    ),
  ).slice(0, max);
}

function sanitizeContextMode(value: unknown): ContextMode {
  if (typeof value === "string" && ALLOWED_CONTEXT_MODES.includes(value.trim() as ContextMode)) {
    return value.trim() as ContextMode;
  }
  return "general";
}

function sanitizeTitle(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TITLE_LENGTH) : null;
}

// ---------------------------------------------------------------------------
// GET /api/conversations
// Returns all pinned conversations plus one stable cursor page of unpinned rows.
// ---------------------------------------------------------------------------

async function handleGet(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { searchParams } = new URL(request.url);
  const requestedLimit = Number(searchParams.get("limit") ?? DEFAULT_PAGE_SIZE);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_PAGE_SIZE));
  const rawCursor = searchParams.get("cursor") ?? "";
  let cursor: { updatedAt: string; id: string } | null = null;
  if (rawCursor) {
    const [updatedAt, id] = rawCursor.split("|");
    if (!Number.isFinite(Date.parse(updatedAt)) || !isUuid(id)) return apiError("Invalid conversation cursor.", 400);
    cursor = { updatedAt: new Date(Date.parse(updatedAt)).toISOString(), id };
  }

  try {
    const pinnedResult = await supabase
      .from("conversations")
      .select(CONVERSATION_LIST_SELECT)
      .eq("user_id", user.id)
      .eq("pinned", true)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false });

    let query = supabase
      .from("conversations")
      .select(CONVERSATION_LIST_SELECT)
      .eq("user_id", user.id)
      .eq("pinned", false)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (cursor) {
      query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
    }

    const { data, error } = await query;
    const pinnedError = pinnedResult.error;
    if ((error && isMissingOptionalConversationColumn(error)) || (pinnedError && isMissingOptionalConversationColumn(pinnedError))) {
      const legacyQuery = supabase
        .from("conversations")
        .select(LEGACY_CONVERSATION_LIST_SELECT)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      const legacyResult = await legacyQuery;
      if (legacyResult.error) throw legacyResult.error;
      return NextResponse.json({ conversations: withDefaultLanguage(legacyResult.data), next_cursor: null, has_more: false });
    }
    if (pinnedError) throw pinnedError;
    if (error) throw error;

    const page = (data ?? []).slice(0, limit);
    const hasMore = (data ?? []).length > limit;
    const boundary = page[page.length - 1];
    return NextResponse.json({
      conversations: [...(pinnedResult.data ?? []), ...page],
      next_cursor: hasMore && boundary ? `${boundary.updated_at}|${boundary.id}` : null,
      has_more: hasMore,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load conversations.";
    return apiError(message, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/conversations
// Creates a new conversation for the authenticated user.
// ---------------------------------------------------------------------------

async function handlePost(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  // user_id is always taken from the authenticated session — never from the body.
  if ("user_id" in body || "userId" in body) {
    return apiError("User ownership is assigned by the server.", 400);
  }

  const title = sanitizeTitle(body.title);
  const contextMode = sanitizeContextMode(body.context_mode ?? body.contextMode);
  if (body.language_code !== undefined && !isSupportedLanguageCode(body.language_code)) {
    return apiError("Choose a supported language.", 400);
  }
  const language = isSupportedLanguageCode(body.language_code) ? body.language_code : user.preferredLanguage;
  const requestedStudyState = body.study_state === undefined && body.studyState === undefined
    ? {}
    : sanitizeStudyStatePatch(body.study_state ?? body.studyState);
  if (requestedStudyState === null) return apiError("study_state is invalid.", 400);

  // Validate fileIds: each must be a UUID owned by this user.
  const requestedFileIds = cleanIds(body.active_file_ids ?? body.activeFileIds, MAX_FILE_IDS);
  const requestedNoteIds = cleanIds(body.active_note_ids ?? body.activeNoteIds, MAX_NOTE_IDS);

  let verifiedFileIds: string[] = [];
  let verifiedNoteIds: string[] = [];

  try {
    // Verify file ownership when file IDs are supplied.
    if (requestedFileIds.length > 0) {
      const { data: ownedFiles, error: fileError } = await supabase
        .from("files")
        .select("id")
        .eq("user_id", user.id)
        .in("id", requestedFileIds);

      if (fileError) throw fileError;
      verifiedFileIds = (ownedFiles ?? []).map((f) => f.id);
    }

    // Verify note ownership when note IDs are supplied.
    if (requestedNoteIds.length > 0) {
      const { data: ownedNotes, error: noteError } = await supabase
        .from("notes")
        .select("id")
        .eq("user_id", user.id)
        .in("id", requestedNoteIds);

      if (noteError) throw noteError;
      verifiedNoteIds = (ownedNotes ?? []).map((n) => n.id);
    }

    const payload = {
      user_id: user.id,
      title: title ?? null,
      pinned: false,
      context_mode: contextMode,
      active_file_ids: verifiedFileIds,
      active_note_ids: verifiedNoteIds,
      language_code: language,
      study_state: requestedStudyState,
    };

    const { data, error } = await supabase
      .from("conversations")
      .insert(payload)
      .select(CONVERSATION_LIST_SELECT)
      .single();

    if (error && isMissingOptionalConversationColumn(error)) {
      const minimalLegacyPayload = {
        user_id: payload.user_id,
        title: payload.title,
      };
      const legacyResult = await supabase
        .from("conversations")
        .insert(minimalLegacyPayload)
        .select(LEGACY_CONVERSATION_LIST_SELECT)
        .single();

      if (legacyResult.error) throw legacyResult.error;
      return NextResponse.json({ conversation: withDefaultLanguage([legacyResult.data])[0] }, { status: 201 });
    }
    if (error) throw error;

    return NextResponse.json({ conversation: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create conversation.";
    return apiError(message, 500);
  }
}

export async function GET(request: Request) {
  return withRequestObservability(request, "/api/conversations", async () => handleGet(request));
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/conversations", async () => handlePost(request));
}

// Re-export UUID validator for use by sub-routes.
export { isUuid };
