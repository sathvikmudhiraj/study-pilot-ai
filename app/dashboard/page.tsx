import Link from "next/link";
import { AppShell } from "@/frontend/components/AppShell";
import { DashboardCountUp } from "@/frontend/components/DashboardCountUp";
import { DashboardDateTime } from "@/frontend/components/DashboardDateTime";
import { PageHeader, Card, Badge, EmptyState } from "@/frontend/components/ui";
import { IconUpload, IconChat, IconSummarize, IconQuiz, IconFiles, IconZap, IconSparkles, IconChevronRight, IconPlus } from "@/frontend/components/icons";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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

  const recentTotal = recentFiles.length + recentNotes.length;

  return (
    <AppShell>
      <div className="mb-8 grid min-w-0 gap-5 pt-2 sm:pt-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-end">
        <div className="animate-fade-in-up">
          <PageHeader
            badge="Private study command center"
            title="Student dashboard"
            description="Your notes, AI answers, summaries, and quizzes in one focused workspace."
          />
        </div>
        <DashboardDateTime />
      </div>

      {/* ─── KPI cards ─────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        <Card hover={false} padding="none" className="group relative overflow-hidden p-0 animate-fade-in-up transition-all duration-200 hover:-translate-y-[2px] hover:border-emerald-400/20 hover:shadow-lg hover:shadow-emerald-950/15 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
          <Link
            href="/files"
            aria-label={`Uploaded files: ${counts.files} in your Supabase storage. Open files library.`}
            className="block cursor-pointer rounded-[inherit] p-5 outline-none transition-colors duration-200 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            <div className="flex items-center gap-3 mb-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] transition-transform duration-200 group-hover:-translate-y-0.5 group-focus-within:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                <IconFiles size={18} className="text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-400">Uploaded files</p>
            </div>
            <p className="text-3xl font-bold tracking-tight text-white"><DashboardCountUp value={counts.files} /></p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">In your Supabase storage</p>
              <IconChevronRight size={14} className="shrink-0 text-slate-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-300 group-focus-visible:translate-x-0.5 group-focus-visible:text-emerald-300" />
            </div>
          </Link>
        </Card>

        <Card hover={false} padding="none" className="group relative overflow-hidden p-0 animate-fade-in-up transition-all duration-200 hover:-translate-y-[2px] hover:border-cyan-400/20 hover:shadow-lg hover:shadow-cyan-950/15 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
          <Link
            href="/upload"
            aria-label={`Manual notes: ${counts.notes} typed and saved. Open manual notes creation.`}
            className="block cursor-pointer rounded-[inherit] p-5 outline-none transition-colors duration-200 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            <div className="flex items-center gap-3 mb-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] transition-transform duration-200 group-hover:-translate-y-0.5 group-focus-within:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                <IconSparkles size={18} className="text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-400">Manual notes</p>
            </div>
            <p className="text-3xl font-bold tracking-tight text-white"><DashboardCountUp value={counts.notes} /></p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Typed and saved</p>
              <IconChevronRight size={14} className="shrink-0 text-slate-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-cyan-300 group-focus-visible:translate-x-0.5 group-focus-visible:text-cyan-300" />
            </div>
          </Link>
        </Card>

        <Card hover={false} padding="none" className="group relative overflow-hidden p-0 animate-fade-in-up transition-all duration-200 hover:-translate-y-[2px] hover:border-emerald-400/20 hover:shadow-lg hover:shadow-emerald-950/15 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
          <Link
            href="/files"
            aria-label={`Recent activity: ${recentTotal} recent files and notes. Open recent items.`}
            className="block cursor-pointer rounded-[inherit] p-5 outline-none transition-colors duration-200 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            <div className="flex items-center gap-3 mb-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] transition-transform duration-200 group-hover:-translate-y-0.5 group-focus-within:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                <IconZap size={18} className="text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-400">Recent activity</p>
            </div>
            <p className="text-3xl font-bold tracking-tight text-white"><DashboardCountUp value={recentTotal} /></p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Last 4 files + notes</p>
              <IconChevronRight size={14} className="shrink-0 text-slate-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-300 group-focus-visible:translate-x-0.5 group-focus-visible:text-emerald-300" />
            </div>
          </Link>
        </Card>

        <Card hover={false} padding="none" className="group relative overflow-hidden p-0 animate-fade-in-up transition-all duration-200 hover:-translate-y-[2px] hover:border-cyan-400/20 hover:shadow-lg hover:shadow-cyan-950/15 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
          <Link
            href="/upload"
            aria-label="Quick start. Upload notes to begin studying."
            className="block cursor-pointer rounded-[inherit] p-5 outline-none transition-colors duration-200 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
            <div className="flex items-center gap-3 mb-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-emerald-400/15 bg-emerald-400/10 transition-transform duration-200 group-hover:-translate-y-0.5 group-focus-within:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                <IconQuiz size={18} className="text-emerald-300" />
              </div>
              <p className="text-sm font-medium text-slate-400">Quick start</p>
            </div>
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-200">
              Upload notes
              <IconUpload size={14} className="text-emerald-300" />
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Start studying</p>
              <IconChevronRight size={14} className="shrink-0 text-slate-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-300 group-focus-visible:translate-x-0.5 group-focus-visible:text-emerald-300" />
            </div>
          </Link>
        </Card>
      </div>

      {/* ─── Recent activity ──────────────────────────────────────────── */}
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 animate-fade-in-up" style={{ animationDelay: "220ms" }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recent files</h2>
            <Link href="/files" className="text-sm font-medium text-emerald-300 hover:text-emerald-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] rounded">View all →</Link>
          </div>
          {recentFiles.length ? (
            <div className="grid gap-3 stagger-children">
              {recentFiles.map((file) => (
                <Link key={file.id} href={`/files/${file.id}`} className="min-w-0 rounded-lg border border-white/[0.06] bg-slate-950/50 p-4 transition-all duration-200 hover:-translate-y-[2px] hover:border-emerald-400/20 hover:bg-white/[0.04] hover:shadow-lg hover:shadow-emerald-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] animate-fade-in-up motion-reduce:transition-none motion-reduce:hover:translate-y-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 break-words font-medium text-white text-sm">{file.file_name}</div>
                    <Badge variant={file.processing_status === "uploaded" ? "emerald" : "amber"} className="shrink-0">
                      {file.processing_status ?? file.status ?? "uploaded"}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{formatDate(file.created_at)}</div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No study files yet"
              description="Upload PDFs, slides, documents, or notes to start building your workspace."
              action={<Link href="/upload" className="inline-flex h-10 items-center rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-slate-950 hover:bg-emerald-300 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]">Upload notes</Link>}
            />
          )}
        </section>

        <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 animate-fade-in-up" style={{ animationDelay: "280ms" }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recent notes</h2>
            <Link href="/files" className="text-sm font-medium text-emerald-300 hover:text-emerald-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] rounded">View all →</Link>
          </div>
          {recentNotes.length ? (
            <div className="grid gap-3 stagger-children">
              {recentNotes.map((note) => (
                <div key={note.id} className="min-w-0 rounded-lg border border-white/[0.06] bg-slate-950/50 p-4 animate-fade-in-up">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 break-words font-medium text-white text-sm">{note.title ?? "Untitled note"}</div>
                    <Badge variant="cyan" className="shrink-0">{note.topic ?? "Manual note"}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">{formatDate(note.created_at)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-5">
              <div>
                <p className="font-semibold text-white text-sm">No manual notes yet</p>
                <p className="mt-1 text-sm text-slate-400">Save typed notes directly to your workspace.</p>
              </div>
              <Link
                href="/upload"
                className="group inline-flex h-9 items-center gap-1.5 rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-xs font-semibold text-cyan-100 transition-all duration-200 hover:-translate-y-[2px] hover:border-cyan-300/35 hover:bg-cyan-300/15 hover:shadow-lg hover:shadow-cyan-950/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <IconPlus size={14} className="transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0" />
                Create note
              </Link>
            </div>
          )}
        </section>
      </div>

      {/* ─── Quick actions ────────────────────────────────────────────── */}
      <div className="mt-8 animate-fade-in-up" style={{ animationDelay: "340ms" }}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
          {([
            {
              title: "Upload notes",
              href: "/upload",
              copy: "Add files or typed notes to your study brain.",
              icon: <IconUpload size={20} className="text-emerald-300" />,
              primary: true,
              accent: "emerald",
            },
            {
              title: "Ask AI",
              href: "/chat",
              copy: "Get answers grounded in your notes.",
              icon: <IconChat size={20} className="text-cyan-300" />,
              primary: true,
              accent: "cyan",
            },
            {
              title: "Generate summary",
              href: "/summary",
              copy: "Turn notes into an exam-ready brief.",
              icon: <IconSummarize size={20} className="text-slate-300" />,
              primary: false,
              accent: "emerald",
            },
            {
              title: "Create quiz",
              href: "/quiz",
              copy: "Practice with MCQs and answer explanations.",
              icon: <IconQuiz size={20} className="text-slate-300" />,
              primary: false,
              accent: "cyan",
            },
          ] as const).map((action) => {
            const primaryClasses =
              action.primary && action.accent === "emerald"
                ? "border-emerald-400/25 bg-emerald-400/[0.07] hover:border-emerald-400/40 hover:bg-emerald-400/10"
                : action.primary && action.accent === "cyan"
                  ? "border-cyan-400/25 bg-cyan-400/[0.07] hover:border-cyan-400/40 hover:bg-cyan-400/10"
                  : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.06]";
            const iconWrapPrimary =
              action.accent === "emerald"
                ? "border-emerald-400/20 bg-emerald-400/10 group-hover:border-emerald-400/35 group-hover:bg-emerald-400/15"
                : "border-cyan-400/20 bg-cyan-400/10 group-hover:border-cyan-400/35 group-hover:bg-cyan-400/15";
            const iconWrap = action.primary
              ? iconWrapPrimary
              : "border-white/10 bg-white/[0.04] group-hover:border-emerald-400/20 group-hover:bg-emerald-400/10";
            const titleClass = action.primary ? "font-semibold text-white text-sm" : "font-medium text-slate-200 text-sm";
            return (
              <Link
                key={action.href}
                href={action.href}
                aria-label={`${action.title}: ${action.copy}`}
                className={`min-w-0 rounded-xl border p-5 transition-all duration-200 hover:-translate-y-[2px] hover:shadow-lg hover:shadow-emerald-950/10 group animate-fade-in-up focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:ring-emerald-400/50 ${primaryClasses}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-all duration-200 group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 ${iconWrap}`}>
                    {action.icon}
                  </div>
                  <h3 className={titleClass}>{action.title}</h3>
                </div>
                <p className="mt-3 text-sm text-slate-400 leading-relaxed">{action.copy}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
