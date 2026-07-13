import Link from "next/link";
import { AppShell } from "@/frontend/components/AppShell";
import { DashboardDateTime } from "@/frontend/components/DashboardDateTime";
import { PageHeader, Card, Badge, EmptyState } from "@/frontend/components/ui";
import { IconUpload, IconChat, IconSummarize, IconQuiz, IconFiles, IconZap, IconSparkles } from "@/frontend/components/icons";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();
  const counts = {
    files: 0,
    notes: 0,
  };
  const recentFiles: { id: string; file_name: string; created_at: string; processing_status: string | null; status: string | null }[] = [];
  const recentNotes: { id: string; title: string | null; topic: string | null; created_at: string }[] = [];

  if (supabase && user) {
    const [filesResult, notesResult, recentFilesResult, recentNotesResult] = await Promise.all([
      supabase.from("files").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("notes").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("files").select("id, file_name, created_at, processing_status, status").eq("user_id", user.id).order("created_at", { ascending: false }).limit(4),
      supabase.from("notes").select("id, title, topic, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(4),
    ]);

    counts.files = filesResult.count ?? 0;
    counts.notes = notesResult.count ?? 0;
    recentFiles.push(...(recentFilesResult.data ?? []));
    recentNotes.push(...(recentNotesResult.data ?? []));
  }

  return (
    <AppShell>
      <div className="mb-8 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
        <PageHeader
          badge="Private study command center"
          title="Student dashboard"
          description="Your notes, AI answers, summaries, and quizzes in one focused workspace."
        />
        <DashboardDateTime />
      </div>

      {/* ─── KPI cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        <Card className="group relative overflow-hidden p-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="flex items-center gap-3 mb-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04]">
              <IconFiles size={18} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-400">Uploaded files</p>
          </div>
          <p className="text-3xl font-bold tracking-tight text-white">{counts.files}</p>
          <p className="mt-1 text-xs text-slate-500">In your Supabase storage</p>
        </Card>

        <Card className="group relative overflow-hidden p-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="flex items-center gap-3 mb-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04]">
              <IconSparkles size={18} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-400">Manual notes</p>
          </div>
          <p className="text-3xl font-bold tracking-tight text-white">{counts.notes}</p>
          <p className="mt-1 text-xs text-slate-500">Typed and saved</p>
        </Card>

        <Card className="group relative overflow-hidden p-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="flex items-center gap-3 mb-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04]">
              <IconZap size={18} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-400">Recent items</p>
          </div>
          <p className="text-3xl font-bold tracking-tight text-white">{recentFiles.length + recentNotes.length}</p>
          <p className="mt-1 text-xs text-slate-500">Last 4 files + notes</p>
        </Card>

        <Card className="group relative overflow-hidden p-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          <div className="flex items-center gap-3 mb-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-emerald-400/15 bg-emerald-400/10">
              <IconQuiz size={18} className="text-emerald-300" />
            </div>
            <p className="text-sm font-medium text-slate-400">Quick start</p>
          </div>
          <p className="text-sm font-semibold text-emerald-200">Study mode ready</p>
          <p className="mt-1 text-xs text-slate-500">Upload to begin</p>
        </Card>
      </div>

      {/* ─── Recent activity ──────────────────────────────────────────── */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recent files</h2>
            <Link href="/files" className="text-sm font-medium text-emerald-300 hover:text-emerald-200 transition">View all →</Link>
          </div>
          {recentFiles.length ? (
            <div className="grid gap-3 stagger-children">
              {recentFiles.map((file) => (
                <Link key={file.id} href={`/files/${file.id}`} className="min-w-0 rounded-lg border border-white/[0.06] bg-slate-950/50 p-4 transition-all duration-200 hover:border-emerald-400/20 hover:bg-white/[0.04] animate-fade-in-up">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 break-words font-medium text-white text-sm">{file.file_name}</div>
                    <Badge variant={file.processing_status === "uploaded" ? "emerald" : "amber"} className="shrink-0">
                      {file.processing_status ?? file.status ?? "uploaded"}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{new Date(file.created_at).toLocaleDateString()}</div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No study files yet"
              description="Upload PDFs, slides, documents, or notes to start building your workspace."
              action={<Link href="/upload" className="inline-flex h-10 items-center rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-300 transition">Upload notes</Link>}
            />
          )}
        </section>

        <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recent notes</h2>
            <Link href="/files" className="text-sm font-medium text-emerald-300 hover:text-emerald-200 transition">View all →</Link>
          </div>
          {recentNotes.length ? (
            <div className="grid gap-3 stagger-children">
              {recentNotes.map((note) => (
                <div key={note.id} className="min-w-0 rounded-lg border border-white/[0.06] bg-slate-950/50 p-4 animate-fade-in-up">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 break-words font-medium text-white text-sm">{note.title ?? "Untitled note"}</div>
                    <Badge variant="cyan" className="shrink-0">{note.topic ?? "Manual note"}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{new Date(note.created_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No manual notes yet"
              description="Save typed notes directly to your workspace from the Upload page."
            />
          )}
        </section>
      </div>

      {/* ─── Quick actions ────────────────────────────────────────────── */}
      <div className="mt-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
          {([
            { title: "Upload notes", href: "/upload", copy: "Add files or typed notes to your study brain.", icon: <IconUpload size={20} className="text-emerald-300" /> },
            { title: "Ask AI", href: "/chat", copy: "Get answers grounded in your notes.", icon: <IconChat size={20} className="text-cyan-300" /> },
            { title: "Generate summary", href: "/summary", copy: "Turn notes into an exam-ready brief.", icon: <IconSummarize size={20} className="text-emerald-300" /> },
            { title: "Create quiz", href: "/quiz", copy: "Practice with MCQs and answer explanations.", icon: <IconQuiz size={20} className="text-cyan-300" /> },
          ] as const).map((action) => (
            <Link key={action.href} href={action.href} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 transition-all duration-200 hover:border-white/[0.15] hover:bg-white/[0.06] hover:-translate-y-[1px] group animate-fade-in-up">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] transition group-hover:border-emerald-400/20 group-hover:bg-emerald-400/10">
                  {action.icon}
                </div>
                <h3 className="font-semibold text-white text-sm">{action.title}</h3>
              </div>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">{action.copy}</p>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
