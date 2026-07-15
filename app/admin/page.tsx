import { AppShell } from "@/frontend/components/AppShell";
import { Card } from "@/frontend/components/ui";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { requireAdmin } from "@/backend/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Stat = {
  label: string;
  value: number;
  error?: string;
};

async function countRows(supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>, table: string): Promise<Stat> {
  if (!supabase) return { label: table, value: 0, error: "Supabase is not configured." };

  const result = await supabase.from(table).select("id", { count: "exact", head: true });
  return {
    label: table,
    value: result.count ?? 0,
    error: result.error?.message,
  };
}

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin.ok) redirect(admin.status === 401 ? "/auth" : "/dashboard");

  const supabase = await createServerSupabaseClient();
  const [files, notes, summaries, chats, quizzes] = await Promise.all([
    countRows(supabase, "files"),
    countRows(supabase, "notes"),
    countRows(supabase, "ai_outputs"),
    countRows(supabase, "assistant_questions"),
    countRows(supabase, "quizzes"),
  ]);

  const stats: Stat[] = [
    { ...files, label: "Files" },
    { ...notes, label: "Notes" },
    { ...summaries, label: "Summaries" },
    { ...chats, label: "AI chats" },
    { ...quizzes, label: "Quizzes" },
  ];

  const errors = stats.filter((stat) => stat.error);

  return (
    <AppShell admin>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Admin dashboard</h1>
        <p className="mt-2 text-slate-400">Live Supabase record counts visible to the current admin session.</p>
      </div>

      <div className="mb-6 rounded-lg border border-amber-300/25 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
        Auth user totals are managed inside Supabase Auth. Platform-wide data counts require admin RLS policies or a server-only service role; this dashboard does not use fake local data.
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
            {stat.error ? <p className="mt-3 text-xs leading-5 text-red-200">{stat.error}</p> : null}
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
