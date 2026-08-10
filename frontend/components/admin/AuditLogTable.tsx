"use client";

import { DataTable } from "./DataTable";
import { StatusBadge } from "./StatusBadge";
import { IconClipboardList, IconUsers, IconFileText, IconSettings, IconServer, IconHelpCircle } from "../icons";

type AuditLogRecord = {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: string;
  reason: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const actionIcons: Record<string, React.ReactNode> = {
  user_suspend: <IconUsers size={14} className="text-red-300" />,
  user_unsuspend: <IconUsers size={14} className="text-emerald-300" />,
  user_role_change: <IconUsers size={14} className="text-cyan-300" />,
  file_admin_delete: <IconFileText size={14} className="text-amber-300" />,
  settings_change: <IconSettings size={14} className="text-slate-300" />,
  support_retry: <IconHelpCircle size={14} className="text-emerald-300" />,
  admin_action: <IconServer size={14} className="text-slate-300" />,
};

const targetTypeIcons: Record<string, React.ReactNode> = {
  user: <IconUsers size={12} />,
  file: <IconFileText size={12} />,
  settings: <IconSettings size={12} />,
  system: <IconServer size={12} />,
  support: <IconHelpCircle size={12} />,
};

function formatAction(action: string): string {
  return action
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatTargetType(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function AuditLogTable({ logs }: { logs: AuditLogRecord[] }) {
  return (
    <DataTable
      columns={[
        {
          key: "createdAt",
          header: "Time",
          render: (row) => <span className="font-mono text-xs text-slate-300">{new Date(row.createdAt).toLocaleString()}</span>,
          className: "whitespace-nowrap",
        },
        {
          key: "action",
          header: "Action",
          render: (row) => (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-100">
              {actionIcons[row.action] ?? <IconClipboardList size={14} className="text-slate-400" />}
              {formatAction(row.action)}
            </span>
          ),
        },
        {
          key: "targetType",
          header: "Target",
          render: (row) => (
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              {targetTypeIcons[row.targetType] ?? <IconHelpCircle size={12} />}
              {formatTargetType(row.targetType)}
              {row.targetId && <span className="font-mono text-xs text-slate-500">({row.targetId.slice(0, 8)}…)</span>}
            </span>
          ),
        },
        {
          key: "result",
          header: "Result",
          render: (row) => {
            const status = row.result as "success" | "failure" | "error";
            return <StatusBadge status={status === "success" ? "ok" : status === "failure" ? "warning" : "error"} />;
          },
        },
        {
          key: "actorUserId",
          header: "Actor",
          render: (row) => <span className="font-mono text-xs text-slate-400">{row.actorUserId.slice(0, 8)}…</span>,
        },
        {
          key: "requestId",
          header: "Request ID",
          render: (row) => (row.requestId ? <span className="font-mono text-xs text-slate-400">{row.requestId}</span> : <span className="text-slate-500">—</span>),
        },
        {
          key: "reason",
          header: "Reason",
          render: (row) => (row.reason ? <span className="text-slate-300 max-w-xs truncate block" title={row.reason}>{row.reason}</span> : <span className="text-slate-500">—</span>),
        },
      ]}
      data={logs}
      keyAccessor={(row) => row.id}
      emptyMessage="No audit logs found"
      emptyIcon={<IconClipboardList size={24} />}
    />
  );
}