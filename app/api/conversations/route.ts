import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_CONTEXT_MODES = ["general", "file", "web", "research", "image"] as const;
type ContextMode = (typeof ALLOWED_CONTEXT_MODES)[number];

const MAX_TITLE_LENGTH = 200;
const MAX_SEARCH_LENGTH = 200;
const MAX_CONVERSATIONS_PER_PAGE = 50;
const MAX_FILE_IDS = 8;
const MAX_NOTE_IDS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Columns returned for list responses (no heavy data)
const CONVERSATION_LIST_SELECT =
  "id, title, pinned, context_mode, active_file_ids, active_note_ids, created_at, updated_at";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
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
// Returns the current user's conversations, pinned first then by updated_at.
// Optional ?q= for a safe title-based search.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { searchParams } = new URL(request.url);
  const rawSearch = searchParams.get("q") ?? "";
  const search = rawSearch.trim().slice(0, MAX_SEARCH_LENGTH);

  try {
    let query = supabase
      .from("conversations")
      .select(CONVERSATION_LIST_SELECT)
      .eq("user_id", user.id)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(MAX_CONVERSATIONS_PER_PAGE);

    if (search) {
      // ilike is safe server-side (Supabase parameterises it)
      query = query.ilike("title", `%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ conversations: data ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load conversations.";
    return apiError(message, 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/conversations
// Creates a new conversation for the authenticated user.
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
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

    const { data, error } = await supabase
      .from("conversations")
      .insert({
        user_id: user.id,
        title: title ?? null,
        pinned: false,
        context_mode: contextMode,
        active_file_ids: verifiedFileIds,
        active_note_ids: verifiedNoteIds,
      })
      .select(CONVERSATION_LIST_SELECT)
      .single();

    if (error) throw error;

    return NextResponse.json({ conversation: data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create conversation.";
    return apiError(message, 500);
  }
}

// Re-export UUID validator for use by sub-routes.
export { isUuid };
