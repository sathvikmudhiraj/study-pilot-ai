import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DRAFT_LENGTH = 20_000;
type RouteContext = { params: Promise<{ id: string }> };

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handlePatch(request: Request, { params }: RouteContext) {
  const user = await requireUser();
  if (!user) return error("Please log in first.", 401);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return error("Supabase is not configured.", 500);
  const { id } = await params;
  if (!UUID_RE.test(id)) return error("Invalid conversation id.", 400);

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return error("Invalid request body.", 400);
  }
  if (typeof body.draft !== "string" || body.draft.length > MAX_DRAFT_LENGTH) {
    return error("Draft is invalid or too large.", 400);
  }
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0) {
    return error("Draft version is invalid.", 400);
  }

  const expectedVersion = Number(body.version);
  const update = await supabase
    .from("conversations")
    .update({ draft_text: body.draft, draft_version: expectedVersion + 1 })
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("draft_version", expectedVersion)
    .select("id, draft_text, draft_version")
    .maybeSingle();
  if (update.error) return error(update.error.message, 500);
  if (update.data) return NextResponse.json({ draft: update.data });

  const current = await supabase
    .from("conversations")
    .select("id, draft_text, draft_version")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (current.error) return error(current.error.message, 500);
  if (!current.data) return error("Conversation not found.", 404);
  return NextResponse.json({ error: "Draft changed elsewhere.", draft: current.data }, { status: 409 });
}

export async function PATCH(request: Request, context: RouteContext) {
  return withRequestObservability(request, "/api/conversations/[id]/draft", () => handlePatch(request, context));
}
