"use client";

import { DataTable } from "./DataTable";
import { IconAlertTriangle, IconAlertCircle, IconInfo } from "../icons";

type Incident = {
  id: string;
  timestamp: string;
  severity: "error" | "warning" | "info";
  category: string;
  message: string;
  requestId?: string;
};

export function RecentIncidents({ incidents }: { incidents: Incident[] }) {
  const severityIcons = {
    error: <IconAlertCircle size={14} className="text-red-300" />,
    warning: <IconAlertTriangle size={14} className="text-amber-300" />,
    info: <IconInfo size={14} className="text-cyan-300" />,
  };

  return (
    <DataTable
      columns={[
        {
          key: "timestamp",
          header: "Time",
          render: (row) => <span className="font-mono text-xs text-slate-300">{new Date(row.timestamp).toLocaleString()}</span>,
          className: "whitespace-nowrap",
        },
        {
          key: "severity",
          header: "Severity",
          render: (row) => (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              {severityIcons[row.severity]}
              <span className="capitalize">{row.severity}</span>
            </span>
          ),
        },
        { key: "category", header: "Category", className: "text-slate-300 font-mono text-xs" },
        {
          key: "message",
          header: "Message",
          render: (row) => <span className="text-slate-200 max-w-xs truncate block" title={row.message}>{row.message}</span>,
        },
        {
          key: "requestId",
          header: "Request ID",
          render: (row) => (row.requestId ? <span className="font-mono text-xs text-slate-400">{row.requestId}</span> : <span className="text-slate-500">-</span>),
        },
      ]}
      data={incidents}
      keyAccessor={(row) => row.id}
      emptyMessage="No recent incidents recorded"
      emptyIcon={<IconInfo size={24} />}
    />
  );
}
