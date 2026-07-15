import Link from "next/link";
import { AppShell } from "@/frontend/components/AppShell";
import { FilesBrowser } from "@/frontend/components/FilesBrowser";
import { PageHeader } from "@/frontend/components/ui";
import { IconUpload } from "@/frontend/components/icons";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { supabaseSetupMessage } from "@/frontend/lib/supabase/errors";

export const dynamic = "force-dynamic";

const LIBRARY_FILE_LIMIT = 100;
const LIBRARY_NOTE_LIMIT = 100;

export default async function FilesPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();
  const [filesResult, notesResult] =
    supabase && user
      ? await Promise.all([
          supabase
            .from("files")
            .select("id, file_name, file_type, mime_type, file_size, processing_status, status, created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(LIBRARY_FILE_LIMIT),
          supabase
            .from("notes")
            .select("id, title, topic, raw_notes, content, importance, source_type, metadata, file_id, key_link, note_date, created_at, updated_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(LIBRARY_NOTE_LIMIT),
        ])
      : [{ data: [] }, { data: [] }];

  return (
    <AppShell>
      <PageHeader
        title="My library"
        description="Find, review, and practice from your uploaded files and manual notes."
        actions={
          <Link
            href="/upload"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-300 hover:-translate-y-[1px]"
          >
            <IconUpload size={16} />
            Upload notes
          </Link>
        }
      />
      {(filesResult.error || notesResult.error) ? (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-5 text-sm leading-6 text-amber-100 animate-fade-in">
          {supabaseSetupMessage(filesResult.error?.message || notesResult.error?.message || "Supabase setup is incomplete.")}
        </div>
      ) : (
        <FilesBrowser files={filesResult.data ?? []} notes={notesResult.data ?? []} />
      )}
    </AppShell>
  );
}
