import { Suspense } from "react";
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
  telemetry: { note: string; availableFields: string[] };
}

async function fetchMonitoring(): Promise<MonitoringData> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/admin/monitoring`, {
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
        badge="Read-Only"
        title="Monitoring"
        description="Live health, readiness, and AI provider configuration. Historical telemetry requires durable monitoring store (future phase)."
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
          <h3 className="text-lg font-semibold text-white">Telemetry Availability</h3>
        </div>
        <p className="text-sm text-slate-400 mb-4">{telemetry.note}</p>
        <div className="flex flex-wrap gap-2">
          {telemetry.availableFields.map((field) => (
            <span key={field} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-mono text-slate-300">
              {field}
            </span>
          ))}
        </div>
      </Card>

      <Divider label="Recent Incidents (In-Memory Only)" />

      <Card accent padding="md">
        <p className="text-sm text-slate-400 mb-4">
          Historical incidents require a durable monitoring store. Current in-memory telemetry is available via structured logs only.
        </p>
        <RecentIncidents incidents={[]} />
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