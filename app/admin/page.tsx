import { AppShell } from "@/frontend/components/AppShell";
import { Card } from "@/frontend/components/ui";
import { getPlatformAdminStats } from "@/backend/lib/adminStats";
import { requireAdmin } from "@/backend/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Stat = {
  label: string;
  value: number;
  error?: boolean;
};

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.status === 401 ? "/auth" : "/dashboard");

  let platformStats;
  let statsFailed = false;
  try {
    platformStats = await getPlatformAdminStats();
  } catch {
    statsFailed = true;
    platformStats = { files: 0, notes: 0, summaries: 0, chats: 0, quizzes: 0 };
  }

  const stats: Stat[] = [
    { label: "Files", value: platformStats.files, error: statsFailed },
    { label: "Notes", value: platformStats.notes, error: statsFailed },
    { label: "Summaries", value: platformStats.summaries, error: statsFailed },
    { label: "AI chats", value: platformStats.chats, error: statsFailed },
    { label: "Quizzes", value: platformStats.quizzes, error: statsFailed },
  ];

  const errors = stats.filter((stat) => stat.error);

  return (
    <AppShell admin>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Admin dashboard</h1>
        <p className="mt-2 text-slate-400">Platform-wide aggregate activity from StudyPilot&apos;s production data.</p>
      </div>

      <div className="mb-6 rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-4 text-sm leading-6 text-emerald-100">
        Counts are aggregated by a server-only privileged client after trusted admin authorization. No student records or private content are returned to the browser.
      </div>

      {errors.length ? (
        <div className="mb-6 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-200">
          Some stats could not be loaded. Check Supabase schema and RLS policies.
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <p className="text-sm text-slate-400">{stat.label}</p>
            <p className="mt-3 text-4xl font-bold text-white">{stat.value}</p>
            {stat.error ? <p className="mt-3 text-xs leading-5 text-red-200">Temporarily unavailable</p> : null}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
