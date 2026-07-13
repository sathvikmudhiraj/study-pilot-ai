import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), 303);
}
