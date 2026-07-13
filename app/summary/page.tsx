import Link from "next/link";
import { AppShell } from "@/frontend/components/AppShell";
import { normalizeSourceCitations, SourceCitationChips } from "@/frontend/components/SourceCitationChips";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const dynamic = "force-dynamic";

type SummaryRow = {
  id: string;
  file_id: string | null;
  note_id: string | null;
  short_summary: string | null;
  key_points: unknown;
  suggested_tags: unknown;
  suggested_title: string | null;
  suggested_next_step: string | null;
  content: string | null;
  created_at: string;
};

function asList(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function summaryCitations(content: string | null) {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return normalizeSourceCitations(parsed.source_citations);
  } catch {
    return [];
  }
}

export default async function SummaryPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  let summaries: SummaryRow[] = [];
  const fileNames = new Map<string, string>();
  const noteNames = new Map<string, string>();
  let error = "";

  if (supabase && user) {
    const result = await supabase
      .from("ai_outputs")
      .select("id, file_id, note_id, short_summary, key_points, suggested_tags, suggested_title, suggested_next_step, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (result.error) {
      error = result.error.message;
    } else {
      summaries = (result.data ?? []) as SummaryRow[];
      const fileIds = summaries.map((summary) => summary.file_id).filter(Boolean) as string[];
      const noteIds = summaries.map((summary) => summary.note_id).filter(Boolean) as string[];

      if (fileIds.length) {
        const files = await supabase.from("files").select("id, file_name").in("id", fileIds).eq("user_id", user.id);
        (files.data ?? []).forEach((file) => fileNames.set(file.id, file.file_name));
      }

      if (noteIds.length) {
        const notes = await supabase.from("notes").select("id, title").in("id", noteIds).eq("user_id", user.id);
        (notes.data ?? []).forEach((note) => noteNames.set(note.id, note.title));
      }
    }
  }

  return (
    <AppShell>
      <div className="mb-8 min-w-0">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Saved summaries</h1>
        <p className="mt-2 text-slate-400">Review AI summaries generated from your study files and manual notes.</p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
      ) : null}

      {!error && !summaries.length ? (
        <div className="rounded-lg border border-dashed border-white/15 bg-white/[0.03] p-10 text-center">
          <h2 className="text-lg font-semibold text-white">No summaries yet</h2>
          <p className="mt-2 text-sm text-slate-400">Open a study file from My Files and generate your first AI summary.</p>
          <Link href="/files" className="mt-5 inline-flex h-10 items-center rounded-md bg-emerald-400 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-300">
            Go to files
          </Link>
        </div>
      ) : null}

      <div className="grid gap-4">
        {summaries.map((summary) => {
          const title =
            summary.suggested_title ||
            (summary.file_id ? fileNames.get(summary.file_id) : null) ||
            (summary.note_id ? noteNames.get(summary.note_id) : null) ||
            "Study summary";
          const source = summary.file_id ? fileNames.get(summary.file_id) ?? "Study file" : summary.note_id ? noteNames.get(summary.note_id) ?? "Manual note" : "Study material";
          const citations = summaryCitations(summary.content);

          return (
            <article key={summary.id} className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase text-emerald-300">{source}</div>
                  <h2 className="mt-2 break-words text-lg font-bold text-white sm:text-xl">{title}</h2>
                  <div className="mt-1 text-xs text-slate-500">{new Date(summary.created_at).toLocaleDateString()}</div>
                </div>
                {summary.file_id ? (
                  <Link href={`/files/${summary.file_id}`} className="rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                    Open file
                  </Link>
                ) : null}
              </div>
              {summary.short_summary ? <p className="mt-4 text-sm leading-6 text-slate-300">{summary.short_summary}</p> : null}
              {citations.length ? (
                <div className="mt-4">
                  <SourceCitationChips citations={citations} />
                </div>
              ) : null}
              {asList(summary.key_points).length ? (
                <ul className="mt-4 grid gap-2 text-sm text-slate-400 md:grid-cols-2">
                  {asList(summary.key_points).slice(0, 4).map((point) => (
                    <li key={point} className="rounded-md border border-white/10 bg-slate-950/60 p-3">
                      {point}
                    </li>
                  ))}
                </ul>
              ) : null}
              {asList(summary.suggested_tags).length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {asList(summary.suggested_tags).map((tag) => (
                    <span key={tag} className="rounded-md border border-white/10 bg-slate-950/70 px-2 py-1 text-xs text-slate-300">
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
              {summary.suggested_next_step ? <p className="mt-4 text-sm leading-6 text-emerald-100">{summary.suggested_next_step}</p> : null}
            </article>
          );
        })}
      </div>
    </AppShell>
  );
}
