import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleDelete(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid image id." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });

  const asset = await supabase.from("generated_images").select("id, storage_path")
    .eq("id", id).eq("user_id", user.id).maybeSingle();
  if (asset.error) return NextResponse.json({ error: "Could not load the image." }, { status: 500 });
  if (!asset.data) return NextResponse.json({ error: "Image not found." }, { status: 404 });
  const removed = await supabase.storage.from("generated-images").remove([asset.data.storage_path]);
  if (removed.error) return NextResponse.json({ error: "Could not delete image content." }, { status: 500 });
  const deleted = await supabase.from("generated_images").delete().eq("id", id).eq("user_id", user.id);
  if (deleted.error) return NextResponse.json({ error: "Could not delete image metadata." }, { status: 500 });
  return NextResponse.json({ deleted: true, id });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRequestObservability(request, "/api/generated-images/[id]", async () => handleDelete(request, context));
}
