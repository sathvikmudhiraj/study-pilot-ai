import { Suspense } from "react";
import { PageHeader, Divider } from "@/frontend/components/ui";
import { LearningMetrics } from "@/frontend/components/admin/LearningMetrics";
import { EmptyState } from "@/frontend/components/admin/EmptyState";
import { IconBarChart } from "@/frontend/components/icons";

interface AnalyticsData {
  scope: string;
  totalAttempts: number;
  averagePercentage: number;
  completionRate: number;
  topicPerformance: { topicId: string; label: string; correct: number; total: number; percentage: number }[];
  languageUsage: { language: string; count: number }[];
  revisionPlans: { total: number; active: number };
  repeatQuizUsage: number;
}

async function fetchAnalytics(): Promise<AnalyticsData> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/admin/analytics`, {
    cache: "no-store",
    headers: { "x-request-id": `req_admin_analytics_${crypto.randomUUID()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

function AnalyticsContent({ data }: { data: AnalyticsData }) {
  const learningAnalytics = {
    quizAttempts: {
      total: data.totalAttempts,
      averagePercentage: data.averagePercentage,
      completionRate: data.completionRate,
    },
    topicPerformance: data.topicPerformance,
    languageUsage: data.languageUsage,
    revisionPlans: data.revisionPlans,
    repeatQuizUsage: data.repeatQuizUsage,
  };

  return (
    <div className="space-y-8">
      <PageHeader
        badge="Read-Only"
        title="Learning Analytics"
        description="Platform-wide aggregated learning metrics. No per-student private history or raw answers exposed."
      />

      <LearningMetrics analytics={learningAnalytics} />

      <Divider label="Data Quality Notes" />

      <div className="grid gap-4 md:grid-cols-3 text-sm">
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="font-semibold text-slate-100 mb-2">Aggregation Scope</p>
          <p className="text-slate-400">All metrics are platform-wide aggregates. No individual student data is returned.</p>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="font-semibold text-slate-100 mb-2">Topic Canonicalization</p>
          <p className="text-slate-400">Topics merged by canonical ID across languages. Labels shown in original language of first occurrence.</p>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] p-4">
          <p className="font-semibold text-slate-100 mb-2">Percentages</p>
          <p className="text-slate-400">Clamped 0–100. Malformed or legacy rows ignored safely.</p>
        </div>
      </div>
    </div>
  );
}

function AnalyticsError() {
  return (
    <div className="space-y-8">
      <PageHeader
        badge="Read-Only"
        title="Learning Analytics"
        description="Platform-wide aggregated learning metrics."
      />
      <EmptyState
        title="Unable to load analytics"
        description="The learning analytics data could not be fetched. Check server logs for details."
        icon={<IconBarChart size={24} className="text-red-300" />}
      />
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-1/3 rounded bg-white/[0.06]" />
      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}

async function AnalyticsPageInner() {
  let data: AnalyticsData;
  try {
    data = await fetchAnalytics();
  } catch {
    return <AnalyticsError />;
  }
  return <AnalyticsContent data={data} />;
}

export default async function AdminAnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsSkeleton />}>
      <AnalyticsPageInner />
    </Suspense>
  );
}