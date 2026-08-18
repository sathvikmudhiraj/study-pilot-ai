import { Suspense } from "react";
import { fetchInternalApi } from "@/backend/lib/internalApiFetch";
import { PageHeader, Card, Divider } from "@/frontend/components/ui";
import { ProviderStatusTable } from "@/frontend/components/admin/ProviderStatusTable";
import { RecentIncidents } from "@/frontend/components/admin/RecentIncidents";
import { StatusBadge, StatusDot } from "@/frontend/components/admin/StatusBadge";
import { EmptyState } from "@/frontend/components/admin/EmptyState";
import { IconActivity, IconServer, IconInfo } from "@/frontend/components/icons";

interface MonitoringData {
  live: { status: string };
  readiness: { status: string; checks: Record<string, { status: string; detail?: string }> };
  providers: {
    profile: string;
    configuredProvider: string;
    primaryProvider: string;
    primaryModel: string;
    fallbackProvider: string | null;
    fallbackModel: string | null;
    timeoutMs: number;
    fastFallbackTimeoutMs: number;
    status: "ok" | "configuration";
  }[];
  telemetry: {
    note: string;
    totalEvents: number;
    lastHourEvents: number;
    errorEvents: number;
    aiProviderEvents: number;
    fallbackCount: number;
  };
  recentIncidents: {
    id: string;
    timestamp: string;
    severity: "error" | "warning" | "info";
    category: string;
    message: string;
    requestId?: string;
  }[];
  recentJobs: {
    id: string;
    job_type: string;
    status: string;
    progress: Record<string, unknown>;
    attempt_count: number;
    max_attempts: number;
    next_run_at: string;
    last_error_category: string | null;
    created_at: string;
  }[];
}

async function fetchMonitoring(): Promise<MonitoringData> {
  const res = await fetchInternalApi("/api/admin/monitoring", {
    cache: "no-store",
    headers: { "x-request-id": `req_admin_monitoring_${crypto.randomUUID()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch monitoring data");
  return res.json();
}

function MonitoringContent({ data }: { data: MonitoringData }) {
  const { live, readiness, providers, telemetry } = data;

  return (
    <div className="space-y-8">
      <PageHeader
        badge="Durable"
        title="Monitoring"
        description="Live health, readiness, AI provider telemetry, recent incidents, and background job status."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card accent padding="md" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Liveness</p>
            <StatusDot status={live.status === "ok" ? "ok" : "error"} />
          </div>
          <p className="text-3xl font-bold tracking-tight text-white">Live</p>
          <p className="text-xs text-slate-400">Process is responding</p>
        </Card>

        <Card accent padding="md" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Readiness</p>
            <StatusDot status={readiness.status === "ready" ? "ok" : readiness.status === "not_ready" ? "warning" : "error"} />
          </div>
          <p className="text-3xl font-bold tracking-tight text-white capitalize">{readiness.status}</p>
          <p className="text-xs text-slate-400">All dependencies checked</p>
        </Card>

        <Card accent padding="md" className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">AI Profiles</p>
          <p className="text-3xl font-bold tracking-tight text-white">{providers.length}</p>
          <p className="text-xs text-slate-400">Default + Summary</p>
        </Card>
      </div>

      <Divider label="Readiness Checks" />

      <Card accent padding="md">
        <div className="grid gap-3 md:grid-cols-3">
          {Object.entries(readiness.checks).map(([key, check]) => (
            <div key={key} className="flex items-center gap-3 p-3 rounded-lg border border-white/[0.06] bg-white/[0.03]">
              <StatusDot status={check.status === "ok" ? "ok" : check.status === "configuration_error" ? "configuration" : "error"} />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-100 capitalize">{key}</p>
                <p className="text-xs text-slate-400">{check.detail ?? (check.status === "ok" ? "Healthy" : "Issue detected")}</p>
              </div>
              <StatusBadge status={check.status === "ok" ? "ok" : check.status === "configuration_error" ? "configuration" : "error"} customLabel={check.status} />
            </div>
          ))}
        </div>
      </Card>

      <Divider label="AI Provider Configuration" />

      <div className="grid gap-6 lg:grid-cols-2">
        {providers.map((provider) => (
          <Card key={provider.profile} accent padding="md">
            <h3 className="mb-4 text-lg font-semibold text-white flex items-center gap-2">
              <IconServer size={20} className="text-emerald-300" />
              {provider.profile.charAt(0).toUpperCase() + provider.profile.slice(1)} Profile
            </h3>
            <ProviderStatusTable providers={[provider]} />
          </Card>
        ))}
      </div>

      <Divider label="Provider Telemetry" />

      <Card accent padding="md">
        <div className="mb-4 flex items-center gap-2">
          <IconInfo size={20} className="text-cyan-300" />
          <h3 className="text-lg font-semibold text-white">Durable Telemetry</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Total events", telemetry.totalEvents],
            ["Last hour", telemetry.lastHourEvents],
            ["Errors", telemetry.errorEvents],
            ["AI events", telemetry.aiProviderEvents],
            ["Fallbacks", telemetry.fallbackCount],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-2 text-2xl font-bold text-white">{value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Divider label="Recent Incidents" />

      <Card accent padding="md">
        <RecentIncidents incidents={data.recentIncidents} />
      </Card>

      <Divider label="Background Jobs" />

      <Card accent padding="md">
        {data.recentJobs.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {data.recentJobs.map((job) => (
              <div key={job.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="font-mono text-xs text-slate-300">{job.job_type}</p>
                  <StatusBadge
                    status={job.status === "completed" ? "ok" : job.status === "failed" ? "error" : "configuration"}
                    customLabel={job.status}
                  />
                </div>
                <p className="text-xs text-slate-500">{job.id}</p>
                <p className="mt-3 text-sm text-slate-300">
                  Attempt {job.attempt_count} of {job.max_attempts}
                  {job.last_error_category ? ` · ${job.last_error_category}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No background jobs yet"
            description="Queued PDF extraction and summary jobs will appear here."
            icon={<IconActivity size={24} className="text-emerald-300" />}
          />
        )}
      </Card>
    </div>
  );
}

function MonitoringError() {
  return (
    <div className="space-y-8">
      <PageHeader
        badge="Read-Only"
        title="Monitoring"
        description="Live health, readiness, and AI provider configuration."
      />
      <EmptyState
        title="Unable to load monitoring data"
        description="The monitoring data could not be fetched. Check server logs for details."
        icon={<IconActivity size={24} className="text-red-300" />}
      />
    </div>
  );
}

function MonitoringSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-1/3 rounded bg-white/[0.06]" />
      <div className="grid gap-4 md:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-32 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
        ))}
      </div>
    </div>
  );
}

async function MonitoringPageInner() {
  let data: MonitoringData;
  try {
    data = await fetchMonitoring();
  } catch {
    return <MonitoringError />;
  }
  return <MonitoringContent data={data} />;
}

export default async function AdminMonitoringPage() {
  return (
    <Suspense fallback={<MonitoringSkeleton />}>
      <MonitoringPageInner />
    </Suspense>
  );
}
