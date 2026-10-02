import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";

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

function cleanIds(value: unknown, max = 20): string[] | null {
  if (!Array.isArray(value)) return [];
  const ids = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))];
  if (ids.length > max || ids.some((id) => !isValidUuid(id))) return null;
  return ids;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

async function handleGet(request: Request, { params }: RouteContext) {
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
  let cursor: { createdAt: string; id: string | null } | null = null;
  if (rawCursor) {
    const [rawCreatedAt, rawId] = rawCursor.split("|");
    const ts = Date.parse(rawCreatedAt);
    if (!Number.isFinite(ts)) return apiError("cursor must be a valid ISO timestamp.", 400);
    if (rawId && !isValidUuid(rawId)) return apiError("cursor contains an invalid row id.", 400);
    cursor = { createdAt: new Date(ts).toISOString(), id: rawId || null };
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
      .order("id", { ascending })
      .limit(limit + 1); // fetch one extra to detect has_more

    if (cursor) {
      if (cursor.id) {
        const operator = ascending ? "gt" : "lt";
        query = query.or(
          `created_at.${operator}.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.${operator}.${cursor.id})`,
        );
      } else {
        query = ascending
          ? query.gt("created_at", cursor.createdAt)
          : query.lt("created_at", cursor.createdAt);
      }
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    const pageRows = (rows ?? []).slice(0, limit);
    const hasMore = (rows ?? []).length > limit;
    const boundaryRow = pageRows[pageRows.length - 1];
    const nextCursor = hasMore && boundaryRow
      ? `${boundaryRow.created_at as string}|${boundaryRow.id as string}`
      : null;
    const messages = ascending ? pageRows : [...pageRows].reverse();

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

export async function GET(request: Request, context: RouteContext) {
  return withRequestObservability(request, "/api/conversations/[id]/messages", async () => handleGet(request, context));
}

async function handlePost(request: Request, { params }: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { id: conversationId } = await params;
  if (!isValidUuid(conversationId)) return apiError("Invalid conversation id.", 400);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return apiError("Request body must be valid JSON.", 400);
  }
  const question = typeof body.question === "string" ? body.question.trim() : "";
  const answer = body.answer;
  const fileIds = cleanIds(body.related_file_ids ?? body.relatedFileIds);
  const noteIds = cleanIds(body.related_note_ids ?? body.relatedNoteIds);
  if (!question || question.length > 2_000) return apiError("Voice turn question is invalid.", 400);
  if (!isPlainRecord(answer)) return apiError("Voice turn answer is invalid.", 400);
  if (JSON.stringify(answer).length > 100_000) return apiError("Voice turn answer is too large.", 413);
  if (!fileIds || !noteIds) return apiError("Voice turn references are invalid.", 400);

  const conversationResult = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (conversationResult.error) return apiError(conversationResult.error.message, 500);
  if (!conversationResult.data) return apiError("Conversation not found.", 404);

  const { data, error } = await supabase
    .from("assistant_questions")
    .insert({
      user_id: user.id,
      conversation_id: conversationId,
      question,
      answer,
      related_file_ids: fileIds,
      related_note_ids: noteIds,
      mode: "voice_tool",
      status: "answered",
    })
    .select(MESSAGE_SELECT)
    .single();
  if (error) return apiError(error.message, 500);
  return NextResponse.json({ message: data }, { status: 201 });
}

export async function POST(request: Request, context: RouteContext) {
  return withRequestObservability(request, "/api/conversations/[id]/messages", async () => handlePost(request, context));
}
