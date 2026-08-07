import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "@/frontend/components/AppShell";
import { DashboardCountUp } from "@/frontend/components/DashboardCountUp";
import { DashboardDateTime } from "@/frontend/components/DashboardDateTime";
import { PageHeader, Card, Badge, EmptyState } from "@/frontend/components/ui";
import {
  IconUpload,
  IconChat,
  IconSummarize,
  IconQuiz,
  IconZap,
  IconSparkles,
  IconChevronRight,
  IconPlus,
  IconTarget,
} from "@/frontend/components/icons";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { buildQuizAnalytics } from "@/backend/lib/quizAnalytics";
import { buildDashboardLearningMetrics } from "@/backend/lib/learnerProfile";

export const dynamic = "force-dynamic";

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatShortDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatPercent(value: number | null) {
  return value === null ? "No data" : `${Math.round(value)}%`;
}

function formatMinutes(value: number | null) {
  if (value === null) return "Not enough history";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();
  const counts = { files: 0, notes: 0 };
  const recentFiles: { id: string; file_name: string; created_at: string; processing_status: string | null; status: string | null }[] = [];
  const recentNotes: { id: string; title: string | null; topic: string | null; created_at: string }[] = [];
  let attemptRows: unknown[] = [];
  let revisionRows: unknown[] = [];
  let chatRows: unknown[] = [];

  if (supabase && user) {
    const [filesResult, notesResult, recentFilesResult, recentNotesResult, attemptsResult, revisionResult, chatsResult] = await Promise.all([
      supabase.from("files").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("notes").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase.from("files").select("id, file_name, created_at, processing_status, status").eq("user_id", user.id).order("created_at", { ascending: false }).limit(4),
      supabase.from("notes").select("id, title, topic, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(4),
      supabase
        .from("quiz_attempts")
        .select("score, total_questions, percentage, weak_topics, strong_topics, topic_results, wrong_questions, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("revision_plans")
        .select("daily_plan, plan, created_at, updated_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("assistant_questions")
        .select("created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    counts.files = filesResult.count ?? 0;
    counts.notes = notesResult.count ?? 0;
    recentFiles.push(...(recentFilesResult.data ?? []));
    recentNotes.push(...(recentNotesResult.data ?? []));
    attemptRows = attemptsResult.error ? [] : attemptsResult.data ?? [];
    revisionRows = revisionResult.error ? [] : revisionResult.data ?? [];
    chatRows = chatsResult.error ? [] : chatsResult.data ?? [];
  }

  const quizAnalytics = buildQuizAnalytics(attemptRows);
  const learningMetrics = buildDashboardLearningMetrics({
    attempts: attemptRows,
    quizAnalytics,
    revisionPlans: revisionRows,
    activityRows: [...attemptRows, ...revisionRows, ...chatRows, ...recentFiles, ...recentNotes],
  });
  const quizDelta = learningMetrics.quizImprovement.delta;

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
        <MetricCard href="/quiz" label="Quiz improvement" icon={<IconQuiz size={18} className="text-emerald-300" />} value={formatPercent(learningMetrics.quizImprovement.latest)} tone="emerald">
          {quizDelta === null ? "Take two quizzes to see trend" : `${quizDelta >= 0 ? "+" : ""}${quizDelta}% vs previous`}
        </MetricCard>

        <MetricCard href="/revision" label="Weak topics" icon={<IconZap size={18} className="text-amber-300" />} value={learningMetrics.weakTopics[0]?.topic ?? "No weak topic"} tone="cyan">
          {learningMetrics.weakTopics[0] ? `${learningMetrics.weakTopics[0].accuracy}% accuracy` : "Quiz attempts will reveal gaps"}
        </MetricCard>

        <MetricCard href="/revision" label="Revision progress" icon={<IconSparkles size={18} className="text-emerald-300" />} value={`${learningMetrics.revisionProgress.completionPercent}%`} tone="emerald">
          {learningMetrics.revisionProgress.completed} done, {learningMetrics.revisionProgress.pending} pending
        </MetricCard>

        <MetricCard href="/chat" label="Study streak" icon={<IconChat size={18} className="text-emerald-300" />} value={`${learningMetrics.studyStreakDays}d`} tone="cyan">
          {formatMinutes(learningMetrics.timeStudiedMinutes)} studied
        </MetricCard>
      </div>

      {learningMetrics.topicImprovementHistory.length || learningMetrics.beforeVsLatest.length || learningMetrics.masteryProgress.length ? (
        <div className="mt-8 grid gap-6 lg:grid-cols-3 animate-fade-in-up" style={{ animationDelay: "140ms" }}>
          <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 lg:col-span-2">
            <div className="mb-4 flex items-center gap-2">
              <IconZap size={16} className="text-amber-300 shrink-0" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-200">Weak-topic improvement</h2>
            </div>
            {learningMetrics.topicImprovementHistory.length ? (
              <div className="grid gap-5">
                {learningMetrics.topicImprovementHistory.map((series) => (
                  <div key={series.topicId} className="rounded-lg border border-white/10 bg-slate-950/50 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-white truncate">{series.topic}</span>
                      <span className="text-xs text-slate-500 shrink-0 ml-2">{series.points.length} attempt{series.points.length !== 1 ? "s" : ""}</span>
                    </div>
                    <ImprovementLineChart points={series.points} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Take multiple quizzes on the same topic to see your improvement trend over time.</p>
            )}

            {learningMetrics.beforeVsLatest.length ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {learningMetrics.beforeVsLatest.map((item) => (
                  <div key={item.topicId} className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.05] p-3">
                    <p className="text-xs font-semibold text-cyan-200 truncate">{item.topic}</p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-lg font-bold tabular-nums text-white">{item.latest}%</span>
                      {item.improvement !== null && item.improvement !== 0 ? (
                        <span className={`text-xs font-semibold tabular-nums ${item.improvement >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                          {item.improvement >= 0 ? "+" : ""}{item.improvement}%
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>First {item.first}%</span>
                      <span className="text-slate-700">→</span>
                      <span>Now {item.latest}%</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="bg-white/[0.03] bg-white/[0.03] rounded-xl border border-white/[0.06] p-5">
            <div className="mb-4 flex items-center gap-2">
              <IconTarget size={16} className="text-emerald-300 shrink-0" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">Topic mastery</h2>
            </div>
            {learningMetrics.masteryProgress.length ? (
              <div className="grid gap-3">
                {learningMetrics.masteryProgress.map((topic) => {
                  const barColor =
                    topic.mastery === "strong" ? "bg-emerald-400/60" :
                    topic.mastery === "developing" ? "bg-cyan-400/50" : "bg-amber-400/50";
                  const textColor =
                    topic.mastery === "strong" ? "text-emerald-200" :
                    topic.mastery === "developing" ? "text-cyan-200" : "text-amber-200";
                  return (
                    <div key={topic.canonicalId} className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-white truncate">{topic.topic}</span>
                        <span className={`text-xs font-semibold tabular-nums ${textColor}`}>{topic.accuracy}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                          style={{ width: `${topic.accuracy}%` }}
                          role="progressbar"
                          aria-valuenow={topic.accuracy}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${topic.topic} mastery ${topic.accuracy}%`}
                        />
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{topic.attempts} question{topic.attempts !== 1 ? "s" : ""} answered</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Complete quiz attempts to see topic-level mastery bars.</p>
            )}
          </section>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 animate-fade-in-up">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-white">Recommended next study</h2>
              <p className="mt-1 text-sm text-slate-400">Based on saved quiz attempts and revision history.</p>
            </div>
            <Link
              href={learningMetrics.recommendedNextStudy?.href ?? "/quiz"}
              className="inline-flex h-9 items-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 text-xs font-semibold text-emerald-100 hover:bg-emerald-300/15"
            >
              {learningMetrics.recommendedNextStudy ? "Ask AI" : "Take quiz"}
            </Link>
          </div>
          <div className="rounded-lg border border-white/10 bg-slate-950/50 p-4">
            <p className="text-lg font-semibold text-white">
              {learningMetrics.recommendedNextStudy?.topic ?? "Generate your first learning signal"}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {learningMetrics.recommendedNextStudy?.reason ?? "Take a quiz or complete a revision task so StudyPilot can recommend the next topic honestly."}
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-200">Top weak topics</h3>
              <div className="mt-2 grid gap-2">
                {learningMetrics.weakTopics.length ? (
                  learningMetrics.weakTopics.map((topic) => (
                    <Link key={topic.topic} href="/revision" className="rounded-lg border border-amber-300/15 bg-amber-300/[0.06] p-3 text-sm text-amber-50 hover:bg-amber-300/[0.09]">
                      <span className="block truncate font-semibold">{topic.topic}</span>
                      <span className="mt-1 block text-xs text-amber-100/75">{topic.accuracy}% accuracy, {topic.misses} missed</span>
                    </Link>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No weak topics yet.</p>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-200">Strong topics</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {learningMetrics.strongTopics.length ? (
                  learningMetrics.strongTopics.map((topic) => (
                    <span key={topic.topic} className="rounded-md border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-xs font-medium text-emerald-100">
                      {topic.topic} - {topic.accuracy}%
                    </span>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Mastered topics appear after quiz attempts.</p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 animate-fade-in-up">
          <h2 className="font-semibold text-white">Learning insights</h2>
          <div className="mt-4 grid gap-3">
            {learningMetrics.insights.map((insight) => (
              <div key={insight} className="rounded-lg border border-white/10 bg-slate-950/50 p-3 text-sm leading-6 text-slate-300">
                {insight}
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
              <p className="text-slate-500">Files</p>
              <p className="mt-1 font-semibold text-white"><DashboardCountUp value={counts.files} /></p>
            </div>
            <div className="rounded-lg border border-white/10 bg-slate-950/50 p-3">
              <p className="text-slate-500">Notes</p>
              <p className="mt-1 font-semibold text-white"><DashboardCountUp value={counts.notes} /></p>
            </div>
          </div>
        </section>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 animate-fade-in-up" style={{ animationDelay: "220ms" }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-white">Recent files</h2>
            <Link href="/files" className="rounded text-sm font-medium text-emerald-300 transition hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]">View all</Link>
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
            <Link href="/files" className="rounded text-sm font-medium text-emerald-300 transition hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]">View all</Link>
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

      <div className="mt-8 animate-fade-in-up" style={{ animationDelay: "340ms" }}>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 stagger-children">
          {([
            { title: "Upload notes", href: "/upload", copy: "Add files or typed notes to your study brain.", icon: <IconUpload size={20} className="text-emerald-300" /> },
            { title: "Ask AI", href: "/chat", copy: "Get answers grounded in your notes and weak-topic profile.", icon: <IconChat size={20} className="text-cyan-300" /> },
            { title: "Generate summary", href: "/summary", copy: "Turn notes into an exam-ready brief.", icon: <IconSummarize size={20} className="text-slate-300" /> },
            { title: "Create quiz", href: "/quiz", copy: "Practice with targeted questions and explanations.", icon: <IconQuiz size={20} className="text-slate-300" /> },
          ] as const).map((action) => (
            <Link
              key={action.href}
              href={action.href}
              aria-label={`${action.title}: ${action.copy}`}
              className="group min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 transition-all duration-200 hover:-translate-y-[2px] hover:border-white/[0.15] hover:bg-white/[0.06] hover:shadow-lg hover:shadow-emerald-950/10 animate-fade-in-up focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-emerald-400/20 group-hover:bg-emerald-400/10 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
                  {action.icon}
                </div>
                <h3 className="font-medium text-slate-200 text-sm">{action.title}</h3>
              </div>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">{action.copy}</p>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function ImprovementLineChart({ points }: { points: { attemptedAt: string; percentage: number; correct: number; total: number }[] }) {
  if (points.length < 2) {
    return (
      <div className="rounded border border-white/[0.08] bg-slate-950/70 p-3 text-center">
        <p className="text-xs tabular-nums text-amber-100">{points[0].percentage}%</p>
        <p className="text-[10px] text-slate-500">{points[0].correct}/{points[0].total} correct</p>
      </div>
    );
  }

  const minVal = Math.min(...points.map((p) => p.percentage));
  const maxVal = Math.max(...points.map((p) => p.percentage));
  const range = Math.max(maxVal - minVal, 1);
  const paddedMin = Math.max(0, minVal - range * 0.15);
  const paddedMax = Math.min(100, maxVal + range * 0.15);

  const viewWidth = 400;
  const viewHeight = 100;
  const padLeft = 32;
  const padRight = 16;
  const padTop = 8;
  const padBottom = 20;
  const plotWidth = viewWidth - padLeft - padRight;
  const plotHeight = viewHeight - padTop - padBottom;

  function sx(i: number) {
    return padLeft + (i / Math.max(points.length - 1, 1)) * plotWidth;
  }

  function sy(percentage: number) {
    return padTop + plotHeight - ((percentage - paddedMin) / Math.max(paddedMax - paddedMin, 1)) * plotHeight;
  }

  const gradeLines: number[] = [];
  for (let g = 0; g <= 100; g += 20) {
    if (g >= paddedMin && g <= paddedMax) {
      gradeLines.push(g);
    }
  }

  const pathD = points.map((point, i) => `${i === 0 ? "M" : "L"}${sx(i)} ${sy(point.percentage)}`).join(" ");
  const areaD = `${pathD} L${sx(points.length - 1)} ${sy(paddedMin)} L${sx(0)} ${sy(paddedMin)} Z`;

  return (
    <div className="rounded border border-white/[0.08] bg-slate-950/50 p-3">
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        width="100%"
        height={viewHeight}
        role="img"
        aria-label={`Improvement line chart: ${points.map((p) => `${p.percentage}%`).join(", ")}`}
        className="w-full"
      >
        {gradeLines.map((grade) => (
          <line
            key={`grade-${grade}`}
            x1={padLeft}
            y1={sy(grade)}
            x2={viewWidth - padRight}
            y2={sy(grade)}
            stroke="rgb(255 255 255 / 0.06)"
            strokeWidth={1}
          />
        ))}
        <polygon points={areaD.split("L").join(",")} fill="rgb(217 164 14 / 0.08)" aria-hidden="true" />
        <path d={pathD} fill="none" stroke="rgb(252 211 77 / 0.7)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, i) => (
          <g key={point.attemptedAt}>
            <circle cx={sx(i)} cy={sy(point.percentage)} r={3} fill="#0d1224" stroke="rgb(252 211 77)" strokeWidth={1.5} />
            <text x={sx(i)} y={sy(point.percentage) - 6} textAnchor="middle" fill="#fcd34d" fontSize={9} fontFamily="system-ui" fontWeight={600}>
              {point.percentage}%
            </text>
            <text x={sx(i)} y={viewHeight - 2} textAnchor="middle" fill="rgb(100 116 139)" fontSize={8} fontFamily="system-ui">
              {formatShortDate(point.attemptedAt)}
            </text>
          </g>
        ))}
        {points.length >= 2 && (
          <text x={padLeft} y={10} textAnchor="start" fill="rgb(148 163 184)" fontSize={9} fontFamily="system-ui">
            {points[0].percentage}% → {points[points.length - 1].percentage}%
          </text>
        )}
      </svg>
    </div>
  );
}

function MetricCard({
  href,
  label,
  icon,
  value,
  tone,
  children,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  value: string;
  tone: "emerald" | "cyan";
  children: ReactNode;
}) {
  const focus = tone === "emerald" ? "focus-visible:ring-emerald-400/50" : "focus-visible:ring-cyan-400/50";
  const hover = tone === "emerald" ? "hover:border-emerald-400/20 hover:shadow-emerald-950/15" : "hover:border-cyan-400/20 hover:shadow-cyan-950/15";
  return (
    <Card hover={false} padding="none" className={`group relative overflow-hidden p-0 animate-fade-in-up transition-all duration-200 hover:-translate-y-[2px] hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${hover}`}>
      <Link
        href={href}
        aria-label={`${label}: ${value}`}
        className={`block cursor-pointer rounded-[inherit] p-5 outline-none transition-colors duration-200 hover:bg-white/[0.02] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] motion-reduce:transition-none ${focus}`}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] transition-transform duration-200 group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            {icon}
          </div>
          <p className="text-sm font-medium text-slate-400">{label}</p>
        </div>
        <p className="truncate text-3xl font-bold tracking-tight text-white">{value}</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-500">{children}</p>
          <IconChevronRight size={14} className="shrink-0 text-slate-500 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-300" />
        </div>
      </Link>
    </Card>
  );
}
