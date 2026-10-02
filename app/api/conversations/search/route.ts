import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function handleGet(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);
  const query = new URL(request.url).searchParams.get("q")?.trim().slice(0, 200) ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  const result = await supabase.rpc("search_user_conversations", {
    search_query: query,
    result_limit: 30,
  });
  if (result.error) return apiError(result.error.message, 500);
  return NextResponse.json({ results: result.data ?? [] });
}

export async function GET(request: Request) {
  return withRequestObservability(request, "/api/conversations/search", () => handleGet(request));
}
