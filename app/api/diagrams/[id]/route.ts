import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleDelete(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const { id } = await params;
  if (!UUID_RE.test(id)) return apiError("Invalid diagram ID.", 400);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { error } = await supabase
    .from("diagrams")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return apiError("Failed to delete diagram.", 500);

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withRequestObservability(request, "/api/diagrams/[id]", async () => handleDelete(request, { params }));
}