import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handleGet(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const { data, error, count } = await supabase
    .from("diagrams")
    .select("id, title, diagram_type, source_type, mermaid, explanation, source_file_id, source_answer_id, created_at, updated_at", { count: "exact" })
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.error("[diagrams] list failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return apiError("Failed to fetch diagrams.", 500);
  }

  return NextResponse.json({ diagrams: data ?? [], total: count ?? 0 });
}

export async function GET(request: Request) {
  return withRequestObservability(request, "/api/diagrams", async () => handleGet(request));
}
