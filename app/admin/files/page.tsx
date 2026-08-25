"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/frontend/components/ui";
import { AdminFilesTable } from "@/frontend/components/admin/AdminFilesTable";
import { EmptyState } from "@/frontend/components/admin/EmptyState";
import { ErrorState } from "@/frontend/components/admin/ErrorState";
import { Select } from "@/frontend/components/ui";
import { IconFileText, IconSearch, IconChevronLeft, IconChevronRight } from "@/frontend/components/icons";

type AdminFile = {
  id: string;
  createdAt: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  mimeType: string;
  processingStatus: string;
  chunksCount: number;
  userRef: string;
};

type FilesResponse = {
  files: AdminFile[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
  filters: { status: string | null; type: string | null; search: string | null };
};

export default function AdminFilesPage() {
  const [data, setData] = useState<FilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
    });
    if (statusFilter) params.set("status", statusFilter);
    if (typeFilter) params.set("type", typeFilter);
    if (search) params.set("search", search);

    try {
      const res = await fetch(`/api/admin/files?${params.toString()}`, {
        headers: { "x-request-id": `req_admin_files_${crypto.randomUUID()}` },
      });
      if (!res.ok) throw new Error("Failed to fetch files");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [page, limit, statusFilter, typeFilter, search]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFiles();
  }, [fetchFiles]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const statuses = data?.files.map((f) => f.processingStatus).filter(Boolean) ?? [];
  const uniqueStatuses = [...new Set(statuses)];
  const types = data?.files.map((f) => f.fileType).filter(Boolean) ?? [];
  const uniqueTypes = [...new Set(types)];
  const totalFiles = data?.pagination.total ?? 0;
  const resultLabel = totalFiles === 1 ? "1 file" : `${totalFiles} files`;

  if (loading && !data) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="h-8 w-1/3 rounded bg-white/[0.06]" />
        <div className="h-32 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-8">
        <PageHeader badge="Read-Only" title="File Operations" description="Inspect file metadata across the platform. No extracted text, private URLs, or raw content." />
        <ErrorState title="Failed to load files" description={error} action={fetchFiles} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        badge="Read-Only"
        title="File Operations"
        description="Inspect file metadata across the platform. No extracted text, private URLs, or raw content."
      />

      <form
        onSubmit={handleSearch}
        className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,0.18)]"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-white">File inventory</p>
            <p className="text-xs text-slate-500">Filter uploaded study files by name, status, or type.</p>
          </div>
          <span className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-300">
            {resultLabel}
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-[minmax(260px,1fr)_190px_190px]">
          <div className="min-w-0 flex-1">
            <label htmlFor="search" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Search
            </label>
            <div className="relative">
              <IconSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                id="search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by file name..."
                className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/70 pl-10 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-300/60"
              />
            </div>
          </div>

          <div className="w-full">
            <label htmlFor="status" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Status
            </label>
            <Select
              id="status"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="h-10 rounded-xl border-white/[0.08] bg-slate-950/80 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 hover:border-white/[0.14]"
            >
              <option value="" className="bg-slate-950 text-slate-100">All statuses</option>
              {uniqueStatuses.map((s) => <option key={s} value={s} className="bg-slate-950 text-slate-100">{s}</option>)}
            </Select>
          </div>

          <div className="w-full">
            <label htmlFor="type" className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Type
            </label>
            <Select
              id="type"
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
              className="h-10 rounded-xl border-white/[0.08] bg-slate-950/80 text-sm font-medium text-slate-200 shadow-inner shadow-black/20 hover:border-white/[0.14]"
            >
              <option value="" className="bg-slate-950 text-slate-100">All types</option>
              {uniqueTypes.map((t) => <option key={t} value={t} className="bg-slate-950 text-slate-100">{t}</option>)}
            </Select>
          </div>
        </div>
      </form>

      {data?.files.length ? (
        <AdminFilesTable files={data.files} />
      ) : (
        <EmptyState title="No files found" description="No files match the current filters." icon={<IconFileText size={24} />} />
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
