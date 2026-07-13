import Link from "next/link";
import Image from "next/image";
import { AppShell } from "@/frontend/components/AppShell";
import { SummaryPanel } from "@/frontend/components/SummaryPanel";
import { Badge } from "@/frontend/components/ui";
import { IconChevronLeft, IconFileText } from "@/frontend/components/icons";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { supabaseSetupMessage } from "@/frontend/lib/supabase/errors";

export const dynamic = "force-dynamic";

function formatSize(bytes: number | null) {
  if (!bytes) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function cleanProcessingNotes(notes: string[] | null) {
  if (!Array.isArray(notes)) return [];

  const friendly = notes
    .map((note) => {
      const lower = note.toLowerCase();

      if (
        lower.includes("pdf text extraction failed") ||
        lower.includes("pdf.worker") ||
        lower.includes("cannot find module") ||
        lower.includes("c:\\") ||
        lower.includes(".next/server")
      ) {
        return "Standard PDF text extraction was limited, so StudyPilot used AI vision fallback.";
      }

      if (lower.includes("gemini multimodal pdf fallback produced") || lower.includes("ai fallback produced")) {
        return "AI fallback produced readable study content.";
      }

      if (lower.includes("attempting gemini multimodal pdf fallback")) {
        return "StudyPilot used AI vision fallback for this PDF.";
      }

      if (lower.includes("pdf text extracted") || lower.includes("pdf text was extracted")) {
        return "PDF text was extracted successfully.";
      }

      return note.replace(/[A-Z]:\\[^\s]+/g, "[local path hidden]");
    })
    .filter(Boolean);

  return Array.from(new Set(friendly));
}

export default async function FileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  let signedUrl: string | null = null;
  let previewError = "";

  if (!user) {
    return (
      <AppShell>
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-5 text-red-200">Not authenticated. Please log in again.</div>
      </AppShell>
    );
  }

  if (!supabase) {
    return (
      <AppShell>
        <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5 text-amber-100">
          Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
        </div>
      </AppShell>
    );
  }

  const baseResult = await supabase
    .from("files")
    .select("id, user_id, file_name, file_type, mime_type, file_size, storage_path, processing_status, status, extracted_text, created_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  const file = baseResult.data
    ? {
        ...baseResult.data,
        content_type: null as string | null,
        processing_notes: null as string[] | null,
      }
    : null;
  const error = baseResult.error;

  if (file) {
    const optional = await supabase
      .from("files")
      .select("content_type, processing_notes")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!optional.error && optional.data) {
      file.content_type = optional.data.content_type;
      file.processing_notes = optional.data.processing_notes;
    }
  }

  if (error) {
    return (
      <AppShell>
        <div className="rounded-lg border border-amber-300/30 bg-amber-300/10 p-5 text-sm leading-6 text-amber-100">{supabaseSetupMessage(error.message)}</div>
      </AppShell>
    );
  }

  if (!file) {
    return (
      <AppShell>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-8">
          <h1 className="text-2xl font-bold text-white">File not found</h1>
          <p className="mt-2 text-slate-400">This file does not exist or you do not have access to it.</p>
          <Link href="/files" className="mt-5 inline-flex h-10 items-center rounded-md bg-emerald-400 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-300">
            Back to files
          </Link>
        </div>
      </AppShell>
    );
  }

  if (file.storage_path) {
    const signed = await supabase.storage.from("study-files").createSignedUrl(file.storage_path, 60 * 10);
    if (signed.error) {
      previewError = signed.error.message.includes("not found")
        ? "Storage bucket missing or file is not available. Create the study-files bucket and verify storage policies."
        : signed.error.message;
    } else {
      signedUrl = signed.data.signedUrl;
    }
  } else {
    previewError = "This file does not have a storage path.";
  }

  const summaryBase = await supabase
    .from("ai_outputs")
    .select("id, short_summary, key_points, action_items, important_concepts, suggested_tags, suggested_title, suggested_next_step")
    .eq("user_id", user.id)
    .eq("file_id", file.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const summary = summaryBase.data
    ? {
        ...summaryBase.data,
        content: null as string | null,
        module_overview: null as string | null,
        covered_topics: null as string[] | null,
        topic_wise_summary: null as { topic: string; explanation: string; important_points: string[] }[] | null,
        exam_focus_points: null as string[] | null,
        memory_lines: null as string[] | null,
        common_mistakes: null as string[] | null,
      }
    : null;

  if (summary?.id) {
    const optionalSummary = await supabase
      .from("ai_outputs")
      .select("content, module_overview, covered_topics, topic_wise_summary, exam_focus_points, memory_lines, common_mistakes, source_citations")
      .eq("user_id", user.id)
      .eq("id", summary.id)
      .maybeSingle();

    if (!optionalSummary.error && optionalSummary.data) {
      Object.assign(summary, optionalSummary.data);
    }
  }
  const processingNotes = cleanProcessingNotes(file.processing_notes);
  const canCreateStudyActions = Boolean((file.extracted_text ?? "").trim() || summary);

  return (
    <AppShell>
      {/* Header */}
      <div className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href="/files" className="inline-flex items-center gap-1 text-sm font-medium text-emerald-300 transition hover:text-emerald-200">
            <IconChevronLeft size={16} />
            Back to files
          </Link>
          <h1 className="mt-3 break-words text-2xl font-bold tracking-tight text-white sm:text-3xl animate-fade-in-up">{file.file_name}</h1>
          <p className="mt-2 text-slate-400">Study material preview and processing details.</p>
        </div>
        <Badge variant={file.processing_status === "uploaded" ? "emerald" : "amber"} className="shrink-0">
          {file.processing_status ?? file.status ?? "uploaded"}
        </Badge>
      </div>

      {/* Split view: preview left, summary right */}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
        {/* ─── Preview panel (independent scroll) ───────────────────────── */}
        <section className="min-w-0 self-start rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 sm:p-5 animate-fade-in">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Type", file.content_type ?? file.file_type ?? file.mime_type ?? "Study file"],
              ["Size", formatSize(file.file_size)],
              ["Uploaded", new Date(file.created_at).toLocaleDateString()],
              ["Status", file.processing_status ?? file.status ?? "uploaded"],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-lg border border-white/[0.06] bg-slate-950/50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
                <div className="mt-1.5 break-words text-sm font-medium text-white">{value}</div>
              </div>
            ))}
          </div>

          {processingNotes.length ? (
            <div className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.06] p-4">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cyan-200">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                Processing notes
              </h2>
              <ul className="mt-3 grid gap-1.5 text-sm leading-6 text-slate-300">
                {processingNotes.map((note) => (
                  <li key={note} className="flex items-start gap-2">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-cyan-400/60" />
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Preview area with independent scrolling */}
          <div className="mt-4 overflow-hidden rounded-lg border border-white/[0.06] bg-slate-950/80">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
              <IconFileText size={14} className="text-slate-500" />
              <span className="text-xs font-medium text-slate-400">Preview</span>
            </div>
            {signedUrl && (file.content_type === "image" || file.mime_type?.startsWith("image/")) ? (
              <div className="relative max-h-[70vh] min-h-[400px] overflow-auto p-4">
                <Image src={signedUrl} alt={file.file_name} fill unoptimized className="object-contain p-4" />
              </div>
            ) : signedUrl && (file.content_type === "pdf" || file.mime_type === "application/pdf" || file.file_name.toLowerCase().endsWith(".pdf")) ? (
              <iframe src={`${signedUrl}#toolbar=1&navpanes=0`} title={file.file_name} className="h-[70vh] min-h-[400px] w-full" />
            ) : file.extracted_text ? (
              <div className="max-h-[70vh] min-h-[400px] overflow-auto p-4 sm:p-5">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Extracted text</h2>
                <pre className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{file.extracted_text.slice(0, 12000)}</pre>
              </div>
            ) : (
              <div className="grid min-h-[400px] place-items-center p-6 text-center">
                <div className="max-w-md">
                  <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-500">
                    <IconFileText size={22} />
                  </div>
                  <h2 className="text-base font-semibold text-white">Preview unavailable</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {previewError || "Generate a summary to extract text, or upload a PDF/image for direct preview."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ─── Summary panel (independent scroll, sticky on desktop) ────── */}
        <div className="min-w-0 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto xl:self-start">
          <SummaryPanel fileId={file.id} initialSummary={summary ?? null} canCreateStudyActions={canCreateStudyActions} />
        </div>
      </div>
    </AppShell>
  );
}
