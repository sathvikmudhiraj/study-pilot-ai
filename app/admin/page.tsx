import { Suspense } from "react";
import { PageHeader, Card, Divider } from "@/frontend/components/ui";
import { MetricCard } from "@/frontend/components/admin/MetricCard";
import { ProviderStatusTable } from "@/frontend/components/admin/ProviderStatusTable";
import { StatusBadge } from "@/frontend/components/admin/StatusBadge";
import { EmptyState } from "@/frontend/components/admin/EmptyState";
import { IconTarget, IconTrendingUp, IconBookOpen, IconAward, IconDatabase, IconServer, IconActivity } from "@/frontend/components/icons";

interface OverviewData {
  scope: string;
  stats: {
    files: number;
    notes: number;
    summaries: number;
    chats: number;
    quizzes: number;
  };
  learning: {
    totalAttempts: number;
    averagePercentage: number;
    completionRate: number;
    topicPerformance: { topicId: string; label: string; correct: number; total: number; percentage: number }[];
    languageUsage: { language: string; count: number }[];
    revisionPlans: { total: number; active: number };
    repeatQuizUsage: number;
  };
  ai: {
    default: { provider: string; primaryProvider: string; primaryModel: string; fallbackProvider: string | null; fallbackModel: string | null; timeoutMs: number };
    summary: { provider: string; primaryProvider: string; primaryModel: string; fallbackProvider: string | null; fallbackModel: string | null; timeoutMs: number };
  };
  readiness: { status: string; checks: Record<string, { status: string; detail?: string }> };
}

async function fetchOverview(): Promise<OverviewData> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/admin/overview`, {
    cache: "no-store",
    headers: { "x-request-id": `req_admin_overview_${crypto.randomUUID()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch overview");
  return res.json();
}

function OverviewContent({ data }: { data: OverviewData }) {
  const { stats, learning, ai, readiness } = data;

  return (
    <div className="space-y-8">
      <PageHeader
        badge="Read-Only"
        title="Admin Overview"
        description="Platform-wide aggregate activity and system health. No student records or private content are exposed."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <MetricCard label="Files" value={stats.files} icon={<IconDatabase size={20} />} />
        <MetricCard label="Notes" value={stats.notes} icon={<IconBookOpen size={20} />} />
        <MetricCard label="Summaries" value={stats.summaries} icon={<IconActivity size={20} />} />
        <MetricCard label="AI Chats" value={stats.chats} icon={<IconServer size={20} />} />
        <MetricCard label="Quizzes" value={stats.quizzes} icon={<IconTarget size={20} />} />
      </div>

      <Divider label="Learning Analytics" />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Quiz Attempts"
          value={learning.totalAttempts}
          icon={<IconTarget size={20} />}
          hint={`Avg: ${learning.averagePercentage.toFixed(1)}%`}
        />
        <MetricCard
          label="Completion Rate"
          value={`${learning.completionRate.toFixed(1)}%`}
          icon={<IconTrendingUp size={20} />}
        />
        <MetricCard
          label="Revision Plans"
          value={learning.revisionPlans.total}
          icon={<IconBookOpen size={20} />}
          hint={`${learning.revisionPlans.active} active`}
        />
        <MetricCard
          label="Repeat Quiz Usage"
          value={learning.repeatQuizUsage}
          icon={<IconAward size={20} />}
        />
      </div>

      <Divider label="AI Provider Configuration" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card accent padding="md">
          <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
            <IconServer size={20} className="text-emerald-300" />
            Default Profile
          </h3>
          <ProviderStatusTable providers={[
            {
              profile: "default",
              configuredProvider: ai.default.provider,
              primaryProvider: ai.default.primaryProvider,
              primaryModel: ai.default.primaryModel,
              fallbackProvider: ai.default.fallbackProvider,
              fallbackModel: ai.default.fallbackModel,
              timeoutMs: ai.default.timeoutMs,
              status: "ok",
            },
          ]} />
        </Card>

        <Card accent padding="md">
          <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
            <IconServer size={20} className="text-emerald-300" />
            Summary Profile
          </h3>
          <ProviderStatusTable providers={[
            {
              profile: "summary",
              configuredProvider: ai.summary.provider,
              primaryProvider: ai.summary.primaryProvider,
              primaryModel: ai.summary.primaryModel,
              fallbackProvider: ai.summary.fallbackProvider,
              fallbackModel: ai.summary.fallbackModel,
              timeoutMs: ai.summary.timeoutMs,
              status: "ok",
            },
          ]} />
        </Card>
      </div>

      <Divider label="System Readiness" />

      <Card accent padding="md">
        <div className="flex items-center justify-between gap-4 mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <IconActivity size={20} className="text-emerald-300" />
            Readiness Checks
          </h3>
          <StatusBadge status={readiness.status === "ready" ? "ok" : readiness.status === "not_ready" ? "warning" : "error"} customLabel={readiness.status} />
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {Object.entries(readiness.checks).map(([key, check]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.03]">
              <StatusBadge status={check.status === "ok" ? "ok" : check.status === "configuration_error" ? "configuration" : "error"} customLabel={check.status} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-100 capitalize">{key}</p>
                {check.detail && <p className="text-xs text-slate-400 truncate">{check.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function OverviewError() {
  return (
    <div className="space-y-8">
      <PageHeader
        badge="Read-Only"
        title="Admin Overview"
        description="Platform-wide aggregate activity and system health."
      />
      <EmptyState
        title="Unable to load overview"
        description="The admin overview data could not be fetched. Check server logs for details."
        icon={<IconServer size={24} className="text-red-300" />}
      />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-1/3 rounded bg-white/[0.06]" />
      <div className="grid gap-4 md:grid-cols-5">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
        ))}
      </div>
      <div className="h-4 w-1/4 rounded bg-white/[0.06]" />
      <div className="grid gap-4 md:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}

async function OverviewPageInner() {
  let data: OverviewData;
  try {
    data = await fetchOverview();
  } catch {
    return <OverviewError />;
  }
  return <OverviewContent data={data} />;
}

export default async function AdminOverviewPage() {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <OverviewPageInner />
    </Suspense>
  );
}