"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/frontend/components/ui";
import { AuditLogTable } from "@/frontend/components/admin/AuditLogTable";
import { EmptyState } from "@/frontend/components/admin/EmptyState";
import { ErrorState } from "@/frontend/components/admin/ErrorState";
import { Select } from "@/frontend/components/ui";
import { IconClipboardList, IconChevronLeft, IconChevronRight } from "@/frontend/components/icons";

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

type AuditLogsResponse = {
  logs: AuditLogRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  filters: { action: string | null; targetType: string | null; result: string | null; requestId: string | null; since: string | null; until: string | null };
};

const ACTIONS = [
  "user_suspend", "user_unsuspend", "user_role_change",
  "file_admin_delete", "settings_change", "support_retry", "admin_action",
] as const;

const TARGET_TYPES = ["user", "file", "settings", "system", "support"] as const;
const RESULTS = ["success", "failure", "error"] as const;

export default function AdminAuditLogsPage() {
  const [data, setData] = useState<AuditLogsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [actionFilter, setActionFilter] = useState("");
  const [targetTypeFilter, setTargetTypeFilter] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [requestIdFilter, setRequestIdFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [untilFilter, setUntilFilter] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (actionFilter) params.set("action", actionFilter);
    if (targetTypeFilter) params.set("targetType", targetTypeFilter);
    if (resultFilter) params.set("result", resultFilter);
    if (requestIdFilter) params.set("requestId", requestIdFilter);
    if (sinceFilter) params.set("since", sinceFilter);
    if (untilFilter) params.set("until", untilFilter);

    try {
      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`, {
        headers: { "x-request-id": `req_admin_audit_${crypto.randomUUID()}` },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Failed to fetch audit logs");
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, limit, actionFilter, targetTypeFilter, resultFilter, requestIdFilter, sinceFilter, untilFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchLogs();
  }, [fetchLogs]);

  const handleFilterChange = () => {
    setPage(1);
  };

  if (loading && !data) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-8 w-1/3 rounded bg-white/[0.06]" />
        <div className="h-64 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-8">
        <PageHeader badge="Read-Only" title="Audit Logs" description="Append-only admin action log. No mutation controls." />
        <ErrorState title="Failed to load audit logs" description={error} action={fetchLogs} />
      </div>
    );
  }

  const notConfigured = data?.logs.length === 0 && data?.pagination.total === 0 && error === "Audit log storage is not configured.";

  return (
    <div className="space-y-8">
      <PageHeader
        badge="Read-Only"
        title="Audit Logs"
        description="Append-only admin action log. No mutation controls."
      />

      {notConfigured && (
        <EmptyState
          title="Audit log storage not configured"
          description="The audit_logs table has not been created in the database. Run the Phase 1 audit_logs.sql migration to enable this feature."
          icon={<IconClipboardList size={24} className="text-amber-300" />}
        />
      )}

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <Select
          id="action"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); handleFilterChange(); }}
          className="w-[200px]"
        >
          <option value="">All Actions</option>
          {ACTIONS.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </Select>

        <Select
          id="targetType"
          value={targetTypeFilter}
          onChange={(e) => { setTargetTypeFilter(e.target.value); handleFilterChange(); }}
          className="w-[160px]"
        >
          <option value="">All Target Types</option>
          {TARGET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>

        <Select
          id="result"
          value={resultFilter}
          onChange={(e) => { setResultFilter(e.target.value); handleFilterChange(); }}
          className="w-[140px]"
        >
          <option value="">All Results</option>
          {RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>

        <div className="flex-1 min-w-[200px]">
          <label htmlFor="requestId" className="sr-only">Request ID</label>
          <input
            id="requestId"
            type="text"
            value={requestIdFilter}
            onChange={(e) => { setRequestIdFilter(e.target.value); handleFilterChange(); }}
            placeholder="Filter by Request ID..."
            className="h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-300/60"
          />
        </div>

        <div className="flex gap-2">
          <label htmlFor="since" className="sr-only">Since</label>
          <input
            id="since"
            type="date"
            value={sinceFilter}
            onChange={(e) => { setSinceFilter(e.target.value); handleFilterChange(); }}
            className="h-11 w-[160px] rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/60"
          />
          <label htmlFor="until" className="sr-only">Until</label>
          <input
            id="until"
            type="date"
            value={untilFilter}
            onChange={(e) => { setUntilFilter(e.target.value); handleFilterChange(); }}
            className="h-11 w-[160px] rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/60"
          />
        </div>
      </div>

      {data?.logs.length ? (
        <AuditLogTable logs={data.logs} />
      ) : (
        !notConfigured && <EmptyState title="No audit logs found" description="No logs match the current filters." icon={<IconClipboardList size={24} />} />
      )}

      {data && data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="h-10 px-4 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-medium text-slate-300 transition disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/[0.08]"
            aria-label="Previous page"
          >
            <IconChevronLeft size={18} />
          </button>
          <span className="text-sm text-slate-300 px-3">
            Page {page} of {data.pagination.totalPages} ({data.pagination.total} total)
          </span>
          <button
            onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
            disabled={page === data.pagination.totalPages}
            className="h-10 px-4 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-medium text-slate-300 transition disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/[0.08]"
            aria-label="Next page"
          >
            <IconChevronRight size={18} />
          </button>
        </div>
      )}
    </div>
  );
}