import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { withRequestObservability } from "@/backend/lib/observability";

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/auth/logout", async () => {
    const supabase = await createServerSupabaseClient();
    if (supabase) await supabase.auth.signOut();
    return NextResponse.redirect(new URL("/", request.url), 303);
  });
}
