"use client";

import { DataTable } from "./DataTable";
import { StatusBadge } from "./StatusBadge";
import { IconFileText } from "../icons";

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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getStatusVariant(status: string): "ok" | "warning" | "error" | "unknown" {
  const s = status.toLowerCase();
  if (s === "completed" || s === "processed" || s === "ready" || s === "extracted") return "ok";
  if (s === "processing" || s === "uploaded" || s === "pending") return "warning";
  if (s === "failed" || s === "error") return "error";
  return "unknown";
}

function formatCreatedAt(dateString: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateString));
}

export function AdminFilesTable({ files }: { files: AdminFile[] }) {
  return (
    <DataTable
      columns={[
        {
          key: "createdAt",
          header: "Created",
          render: (row) => <span className="whitespace-nowrap text-xs font-medium text-slate-300">{formatCreatedAt(row.createdAt)}</span>,
          className: "whitespace-nowrap",
        },
        {
          key: "fileName",
          header: "File",
          render: (row) => (
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-cyan-300/15 bg-cyan-300/10 text-cyan-200">
                <IconFileText size={16} />
              </span>
              <div>
                <p className="max-w-xs truncate font-semibold text-slate-100">{row.fileName}</p>
                <p className="font-mono text-xs text-slate-500">{row.mimeType}</p>
              </div>
            </div>
          ),
        },
        {
          key: "fileSize",
          header: "Size",
          render: (row) => <span className="font-mono text-sm text-slate-300">{formatFileSize(row.fileSize)}</span>,
        },
        {
          key: "processingStatus",
          header: "Status",
          render: (row) => {
            const variant = getStatusVariant(row.processingStatus);
            return (
              <StatusBadge
                status={variant}
                customLabel={row.processingStatus}
                showDot={false}
              />
            );
          },
        },
        {
          key: "chunksCount",
          header: "Chunks",
          render: (row) => <span className="font-mono text-slate-300">{row.chunksCount}</span>,
          className: "text-right",
        },
        {
          key: "userRef",
          header: "User",
          render: (row) => <span className="font-mono text-xs text-slate-400">{row.userRef}</span>,
        },
      ]}
      data={files}
      keyAccessor={(row) => row.id}
      emptyMessage="No files found"
      emptyIcon={<IconFileText size={24} />}
      compact
    />
  );
}
