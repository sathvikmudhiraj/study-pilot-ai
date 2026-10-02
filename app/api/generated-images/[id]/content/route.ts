import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function handleGet(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "Invalid image id." }, { status: 400 });
  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Storage is not configured." }, { status: 503 });

  const asset = await supabase.from("generated_images")
    .select("storage_path, mime_type")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("status", "ready")
    .maybeSingle();
  if (asset.error) return NextResponse.json({ error: "Could not load the image." }, { status: 500 });
  if (!asset.data) return NextResponse.json({ error: "Image not found." }, { status: 404 });

  const downloaded = await supabase.storage.from("generated-images").download(asset.data.storage_path);
  if (downloaded.error || !downloaded.data) return NextResponse.json({ error: "Image content is unavailable." }, { status: 404 });
  const extension = asset.data.mime_type === "image/png" ? "png" : asset.data.mime_type === "image/webp" ? "webp" : "jpg";
  return new NextResponse(await downloaded.data.arrayBuffer(), {
    status: 200,
    headers: {
      "Content-Type": asset.data.mime_type,
      "Content-Length": String(downloaded.data.size),
      "Cache-Control": "private, max-age=300, must-revalidate",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="studypilot-${id}.${extension}"`,
    },
  });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRequestObservability(request, "/api/generated-images/[id]/content", async () => handleGet(request, context));
}
