import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Maximum messages returned per page. No artificial usage quotas —
// this is purely a response-size guard.
const PAGE_SIZE = 40;
const MAX_PAGE_SIZE = 100;

// Columns exposed to clients. Excludes internal fields (mode, status).
const MESSAGE_SELECT =
  "id, question, answer, related_file_ids, related_note_ids, conversation_id, created_at";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function isValidUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

type RouteContext = { params: Promise<{ id: string }> };

// ---------------------------------------------------------------------------
// GET /api/conversations/[id]/messages
//
// Returns messages belonging to a single conversation owned by the caller.
// Pagination uses a cursor (the created_at of the last message received).
//
// Query params:
//   cursor   — ISO timestamp; fetch messages created AFTER this value (forward)
//              or omit to start from the oldest message in the conversation.
//   limit    — number of messages per page (1–100, default 40)
//   direction— "asc" (oldest-first, default) | "desc" (newest-first)
//
// Response:
//   { messages: [...], next_cursor: string | null, has_more: boolean }
// ---------------------------------------------------------------------------

export async function GET(request: Request, { params }: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { id: conversationId } = await params;
  if (!isValidUuid(conversationId)) return apiError("Invalid conversation id.", 400);

  // ── Parse query params ───────────────────────────────────────────────────
  const { searchParams } = new URL(request.url);

  const rawLimit = Number(searchParams.get("limit") ?? PAGE_SIZE);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : PAGE_SIZE));

  const rawDirection = searchParams.get("direction") ?? "asc";
  const ascending = rawDirection !== "desc";

  const rawCursor = searchParams.get("cursor") ?? "";
  // Validate cursor: must be a parseable ISO timestamp if supplied.
  let cursor: string | null = null;
  if (rawCursor) {
    const ts = Date.parse(rawCursor);
    if (!Number.isFinite(ts)) return apiError("cursor must be a valid ISO timestamp.", 400);
    cursor = new Date(ts).toISOString();
  }

  try {
    // ── Ownership guard ──────────────────────────────────────────────────────
    // RLS enforces per-user isolation; this explicit check also gives a
    // clean 404 instead of an empty messages array for non-existent/foreign IDs.
    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .select("id")
      .eq("id", conversationId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (convoError) throw convoError;
    if (!convo) return apiError("Conversation not found.", 404);

    // ── Fetch messages ────────────────────────────────────────────────────────
    // We always filter by both conversation_id AND user_id so a malformed FK
    // can never surface another user's messages.
    let query = supabase
      .from("assistant_questions")
      .select(MESSAGE_SELECT)
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .order("created_at", { ascending })
      .limit(limit + 1); // fetch one extra to detect has_more

    if (cursor) {
      // When ascending: created_at > cursor (items after cursor)
      // When descending: created_at < cursor (items before cursor)
      query = ascending
        ? query.gt("created_at", cursor)
        : query.lt("created_at", cursor);
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const messages = (rows ?? []).slice(0, limit);
    const hasMore = (rows ?? []).length > limit;

    // The next cursor is the created_at of the last message in this page.
    const lastRow = messages[messages.length - 1];
    const nextCursor = hasMore && lastRow ? (lastRow.created_at as string) : null;

    return NextResponse.json({
      messages,
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load messages.";
    return apiError(message, 500);
  }
}
