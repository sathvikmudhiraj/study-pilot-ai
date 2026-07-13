import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

async function countRows(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, table: string) {
  if (!supabase) return { count: 0, error: "Supabase is not configured." };
  const result = await supabase.from(table).select("id", { count: "exact", head: true });
  return {
    count: result.count ?? 0,
    error: result.error?.message ?? null,
  };
}

export async function GET() {
  const user = await requireUser("admin");
  if (!user) return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const supabase = await createServerSupabaseClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured." }, { status: 500 });

  const [files, notes, summaries, chats, quizzes] = await Promise.all([
    countRows(supabase, "files"),
    countRows(supabase, "notes"),
    countRows(supabase, "ai_outputs"),
    countRows(supabase, "assistant_questions"),
    countRows(supabase, "quizzes"),
  ]);

  return NextResponse.json({
    scope: "rls-visible",
    note: "Auth user totals require Supabase Auth admin access. This route does not use fake local data.",
    files: files.count,
    notes: notes.count,
    summaries: summaries.count,
    chats: chats.count,
    quizzes: quizzes.count,
    errors: {
      files: files.error,
      notes: notes.error,
      summaries: summaries.error,
      chats: chats.error,
      quizzes: quizzes.error,
    },
  });
}
