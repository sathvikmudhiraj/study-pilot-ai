"use client";

import { DataTable } from "./DataTable";
import { StatusBadge, StatusDot } from "./StatusBadge";

type ProviderStatus = {
  profile: string;
  configuredProvider: string;
  primaryProvider: string;
  primaryModel: string;
  fallbackProvider: string | null;
  fallbackModel: string | null;
  timeoutMs: number;
  status: "ok" | "configuration";
  detail?: string;
};

export function ProviderStatusTable({ providers }: { providers: ProviderStatus[] }) {
  return (
    <DataTable
      columns={[
        { key: "profile", header: "Profile", className: "font-mono text-slate-100" },
        { key: "configuredProvider", header: "Configured", render: (row) => <span className="text-slate-300">{row.configuredProvider}</span> },
        {
          key: "primaryProvider",
          header: "Primary",
          render: (row) => (
            <div className="flex items-center gap-2">
              <StatusDot status={row.status === "ok" ? "ok" : "error"} />
              <span className="font-mono text-slate-100">{row.primaryProvider}</span>
              <span className="text-xs text-slate-400">({row.primaryModel})</span>
            </div>
          ),
        },
        {
          key: "fallbackProvider",
          header: "Fallback",
          render: (row) =>
            row.fallbackProvider ? (
              <div className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" aria-hidden="true" />
                <span className="font-mono text-slate-300">{row.fallbackProvider}</span>
                <span className="text-xs text-slate-500">({row.fallbackModel})</span>
              </div>
            ) : (
              <span className="text-slate-500">None</span>
            ),
        },
        {
          key: "timeoutMs",
          header: "Timeout",
          render: (row) => <span className="font-mono text-slate-300">{Math.round(row.timeoutMs / 1000)}s</span>,
        },
        {
          key: "status",
          header: "Status",
          render: (row) => (
            <StatusBadge
              status={row.status}
              customLabel={row.detail ?? (row.status === "ok" ? "Configured" : "Misconfigured")}
            />
          ),
        },
      ]}
      data={providers}
      keyAccessor={(row) => row.profile}
      emptyMessage="No provider configuration available"
    />
  );
}