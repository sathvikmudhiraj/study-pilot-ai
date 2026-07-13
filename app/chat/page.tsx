import { AppShell } from "@/frontend/components/AppShell";
import { StudyChat } from "@/frontend/components/StudyChat";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { supabaseSetupMessage } from "@/frontend/lib/supabase/errors";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  if (!supabase || !user) {
    return (
      <AppShell>
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-5 text-sm leading-6 text-amber-100 animate-fade-in">
          Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
        </div>
      </AppShell>
    );
  }

  const [chatsResult, filesResult, notesResult] = await Promise.all([
    supabase
      .from("assistant_questions")
      .select("id, question, answer, related_file_ids, related_note_ids, conversation_id, created_at")
      .eq("user_id", user.id)
      .is("conversation_id", null)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("files")
      .select("id, file_name, file_type, mime_type, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("notes")
      .select("id, title, topic, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const setupError = chatsResult.error || filesResult.error || notesResult.error;

  return (
    <AppShell>
      <div className="min-w-0">
        {setupError ? (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-5 text-sm leading-6 text-amber-100 animate-fade-in">
            {supabaseSetupMessage(setupError.message)}
          </div>
        ) : (
          <StudyChat legacyChats={chatsResult.data ?? []} files={filesResult.data ?? []} notes={notesResult.data ?? []} />
        )}
      </div>
    </AppShell>
  );
}
