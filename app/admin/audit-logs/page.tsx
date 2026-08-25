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
  const totalLogs = data?.pagination.total ?? 0;
  const resultLabel = totalLogs === 1 ? "1 log" : `${totalLogs} logs`;

  return (
    <div className="space-y-6">
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

      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-5 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.16)]">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">Audit filters</p>
            <p className="text-xs text-slate-500">Review admin actions by category, target, result, request, or date.</p>
          </div>
          <span className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
            {resultLabel}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-3 2xl:justify-center 2xl:grid-cols-[190px_170px_150px_360px_150px_150px]">
          <div>
            <label htmlFor="action" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Action
            </label>
            <Select
              id="action"
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); handleFilterChange(); }}
              className="h-10 rounded-lg border-white/[0.08] bg-slate-950/75 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 hover:border-white/[0.14]"
            >
              <option value="" className="bg-slate-950 text-slate-100">All actions</option>
              {ACTIONS.map((a) => <option key={a} value={a} className="bg-slate-950 text-slate-100">{a.replace(/_/g, " ")}</option>)}
            </Select>
          </div>

          <div>
            <label htmlFor="targetType" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Target
            </label>
            <Select
              id="targetType"
              value={targetTypeFilter}
              onChange={(e) => { setTargetTypeFilter(e.target.value); handleFilterChange(); }}
              className="h-10 rounded-lg border-white/[0.08] bg-slate-950/75 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 hover:border-white/[0.14]"
            >
              <option value="" className="bg-slate-950 text-slate-100">All targets</option>
              {TARGET_TYPES.map((t) => <option key={t} value={t} className="bg-slate-950 text-slate-100">{t}</option>)}
            </Select>
          </div>

          <div>
            <label htmlFor="result" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Result
            </label>
            <Select
              id="result"
              value={resultFilter}
              onChange={(e) => { setResultFilter(e.target.value); handleFilterChange(); }}
              className="h-10 rounded-lg border-white/[0.08] bg-slate-950/75 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 hover:border-white/[0.14]"
            >
              <option value="" className="bg-slate-950 text-slate-100">All results</option>
              {RESULTS.map((r) => <option key={r} value={r} className="bg-slate-950 text-slate-100">{r}</option>)}
            </Select>
          </div>

          <div className="min-w-0">
            <label htmlFor="requestId" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Request ID
            </label>
            <input
              id="requestId"
              type="text"
              value={requestIdFilter}
              onChange={(e) => { setRequestIdFilter(e.target.value); handleFilterChange(); }}
              placeholder="Filter by request ID..."
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-slate-950/75 px-3 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 outline-none transition placeholder:text-slate-600 hover:border-white/[0.14] focus:border-emerald-300/60"
            />
          </div>

          <div>
            <label htmlFor="since" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Since
            </label>
            <input
              id="since"
              type="date"
              value={sinceFilter}
              onChange={(e) => { setSinceFilter(e.target.value); handleFilterChange(); }}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-slate-950/75 px-3 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 outline-none transition hover:border-white/[0.14] focus:border-emerald-300/60"
            />
          </div>

          <div>
            <label htmlFor="until" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Until
            </label>
            <input
              id="until"
              type="date"
              value={untilFilter}
              onChange={(e) => { setUntilFilter(e.target.value); handleFilterChange(); }}
              className="h-10 w-full rounded-lg border border-white/[0.08] bg-slate-950/75 px-3 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 outline-none transition hover:border-white/[0.14] focus:border-emerald-300/60"
            />
          </div>
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
