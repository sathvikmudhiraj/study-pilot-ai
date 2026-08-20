import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";
import { isSupportedLanguageCode } from "@/shared/languages";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALLOWED_CONTEXT_MODES = ["general", "file", "web", "research", "image"] as const;
type ContextMode = (typeof ALLOWED_CONTEXT_MODES)[number];

const MAX_TITLE_LENGTH = 200;
const MAX_FILE_IDS = 8;
const MAX_NOTE_IDS = 8;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONVERSATION_SELECT =
  "id, title, pinned, context_mode, active_file_ids, active_note_ids, language_code, created_at, updated_at";
const LEGACY_CONVERSATION_SELECT = "id, title, created_at";

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
      lower.includes("updated_at")
    )
  );
}

function withDefaultLanguage<T extends Record<string, unknown>>(row: T | null) {
  return row
    ? {
        ...row,
        pinned: row.pinned ?? false,
        context_mode: row.context_mode ?? "general",
        active_file_ids: row.active_file_ids ?? [],
        active_note_ids: row.active_note_ids ?? [],
        language_code: row.language_code ?? "en",
        updated_at: row.updated_at ?? row.created_at,
      }
    : null;
}

function isValidUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
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

function sanitizeContextMode(value: unknown): ContextMode | null {
  if (typeof value === "string" && ALLOWED_CONTEXT_MODES.includes(value.trim() as ContextMode)) {
    return value.trim() as ContextMode;
  }
  return null;
}

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// Ownership guard: returns the conversation row if the user owns it,
// otherwise returns null. RLS is the primary guard; this is a belt-and-
// suspenders double-check that also surfaces a clean 404/403.
// ---------------------------------------------------------------------------

async function requireOwnedConversation(
  supabase: NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>,
  userId: string,
  conversationId: string,
) {
  const { data, error } = await supabase
    .from("conversations")
    .select(CONVERSATION_SELECT)
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error && isMissingOptionalConversationColumn(error)) {
    const legacyResult = await supabase
      .from("conversations")
      .select(LEGACY_CONVERSATION_SELECT)
      .eq("id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (legacyResult.error) throw legacyResult.error;
    return withDefaultLanguage(legacyResult.data);
  }
  if (error) throw error;
  return withDefaultLanguage(data);
}

// ---------------------------------------------------------------------------
// GET /api/conversations/[id]
// ---------------------------------------------------------------------------

async function handleGet({ params }: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { id } = await params;
  if (!isValidUuid(id)) return apiError("Invalid conversation id.", 400);

  try {
    const conversation = await requireOwnedConversation(supabase, user.id, id);
    if (!conversation) return apiError("Conversation not found.", 404);
    return NextResponse.json({ conversation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load conversation.";
    return apiError(message, 500);
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/conversations/[id]
// Supports: rename (title), pin/unpin (pinned), context mode, active files/notes.
// ---------------------------------------------------------------------------

async function handlePatch(request: Request, { params }: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { id } = await params;
  if (!isValidUuid(id)) return apiError("Invalid conversation id.", 400);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  // Prevent user from re-assigning ownership.
  if ("user_id" in body || "userId" in body) {
    return apiError("User ownership cannot be changed.", 400);
  }

  // Confirm ownership before accepting updates.
  try {
    const existing = await requireOwnedConversation(supabase, user.id, id);
    if (!existing) return apiError("Conversation not found.", 404);

    const updates: Record<string, unknown> = {};

    // title: null clears it; omitted = no change
    if ("title" in body) {
      if (body.title === null || body.title === "") {
        updates.title = null;
      } else if (typeof body.title === "string") {
        const trimmed = body.title.trim().slice(0, MAX_TITLE_LENGTH);
        updates.title = trimmed || null;
      } else {
        return apiError("Title must be a string or null.", 400);
      }
    }

    // pinned
    if ("pinned" in body) {
      if (typeof body.pinned !== "boolean") return apiError("pinned must be true or false.", 400);
      updates.pinned = body.pinned;
    }

    if ("language_code" in body || "languageCode" in body) {
      const language = body.language_code ?? body.languageCode;
      if (!isSupportedLanguageCode(language)) return apiError("Choose a supported language.", 400);
      updates.language_code = language;
    }

    // context_mode
    if ("context_mode" in body || "contextMode" in body) {
      const raw = body.context_mode ?? body.contextMode;
      const mode = sanitizeContextMode(raw);
      if (!mode) return apiError(`context_mode must be one of: ${ALLOWED_CONTEXT_MODES.join(", ")}.`, 400);
      updates.context_mode = mode;
    }

    // active_file_ids: each UUID must be owned by this user
    if ("active_file_ids" in body || "activeFileIds" in body) {
      const requested = cleanIds(body.active_file_ids ?? body.activeFileIds, MAX_FILE_IDS);
      if (requested.length > 0) {
        const { data: ownedFiles, error: fileError } = await supabase
          .from("files")
          .select("id")
          .eq("user_id", user.id)
          .in("id", requested);
        if (fileError) throw fileError;
        updates.active_file_ids = (ownedFiles ?? []).map((f) => f.id);
      } else {
        updates.active_file_ids = [];
      }
    }

    // active_note_ids: each UUID must be owned by this user
    if ("active_note_ids" in body || "activeNoteIds" in body) {
      const requested = cleanIds(body.active_note_ids ?? body.activeNoteIds, MAX_NOTE_IDS);
      if (requested.length > 0) {
        const { data: ownedNotes, error: noteError } = await supabase
          .from("notes")
          .select("id")
          .eq("user_id", user.id)
          .in("id", requested);
        if (noteError) throw noteError;
        updates.active_note_ids = (ownedNotes ?? []).map((n) => n.id);
      } else {
        updates.active_note_ids = [];
      }
    }

    if (!Object.keys(updates).length) {
      return apiError("Provide at least one field to update.", 400);
    }

    let data: Record<string, unknown> | null = null;
    let error: unknown = null;

    const updateResult = await supabase
      .from("conversations")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select(CONVERSATION_SELECT)
      .single();
    data = updateResult.data;
    error = updateResult.error;

    if (error && isMissingOptionalConversationColumn(error)) {
      const legacyUpdates = { ...updates };
      delete legacyUpdates.language_code;
      delete legacyUpdates.pinned;
      delete legacyUpdates.context_mode;
      delete legacyUpdates.active_file_ids;
      delete legacyUpdates.active_note_ids;
      if (!Object.keys(legacyUpdates).length) {
        return NextResponse.json({ conversation: existing });
      }

      const legacyResult = await supabase
        .from("conversations")
        .update(legacyUpdates)
        .eq("id", id)
        .eq("user_id", user.id)
        .select(LEGACY_CONVERSATION_SELECT)
        .single();
      data = withDefaultLanguage(legacyResult.data);
      error = legacyResult.error;
    }

    if (error) throw error;

    return NextResponse.json({ conversation: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update conversation.";
    return apiError(message, 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/conversations/[id]
// Cascades to its assistant_questions rows via the FK.
// ---------------------------------------------------------------------------

async function handleDelete({ params }: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { id } = await params;
  if (!isValidUuid(id)) return apiError("Invalid conversation id.", 400);

  try {
    // Verify ownership before deleting.
    const existing = await requireOwnedConversation(supabase, user.id, id);
    if (!existing) return apiError("Conversation not found.", 404);

    const { error } = await supabase
      .from("conversations")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) throw error;

    return NextResponse.json({ deleted: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete conversation.";
    return apiError(message, 500);
  }
}

export async function GET(request: Request, context: RouteContext) {
  return withRequestObservability(request, "/api/conversations/[id]", async () => handleGet(context));
}

export async function PATCH(request: Request, context: RouteContext) {
  return withRequestObservability(request, "/api/conversations/[id]", async () => handlePatch(request, context));
}

export async function DELETE(request: Request, context: RouteContext) {
  return withRequestObservability(request, "/api/conversations/[id]", async () => handleDelete(context));
}
