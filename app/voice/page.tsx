import { AppShell } from "@/frontend/components/AppShell";
import { VoiceTutor } from "@/frontend/components/VoiceTutor";
import { PageHeader } from "@/frontend/components/ui";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { supabaseSetupMessage } from "@/frontend/lib/supabase/errors";

export const dynamic = "force-dynamic";

export default async function VoicePage() {
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

  // Pull the most recent file so commands like "explain this file" have a
  // default attachment. We only read its id/name; nothing is uploaded, deleted,
  // or changed here.
  const recentFileResult = await supabase
    .from("files")
    .select("id, file_name")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const setupError = recentFileResult.error;
  const recentFile = recentFileResult.data;

  return (
    <AppShell>
      <PageHeader
        title="Voice tutor"
        description="Ask questions or say a command hands-free. Voice input runs only in your browser when you tap Start listening, and answers can be read aloud in your chosen language."
      />

      {setupError ? (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-5 text-sm leading-6 text-amber-100 animate-fade-in">
          {supabaseSetupMessage(setupError.message)}
        </div>
      ) : (
        <VoiceTutor
          initialFileId={recentFile?.id ?? null}
          initialFileName={recentFile?.file_name ?? null}
        />
      )}
    </AppShell>
  );
}
