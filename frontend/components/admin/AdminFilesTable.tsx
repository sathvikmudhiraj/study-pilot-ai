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
  if (s === "completed" || s === "processed" || s === "ready") return "ok";
  if (s === "processing" || s === "uploaded" || s === "pending") return "warning";
  if (s === "failed" || s === "error") return "error";
  return "unknown";
}

export function AdminFilesTable({ files }: { files: AdminFile[] }) {
  return (
    <DataTable
      columns={[
        {
          key: "createdAt",
          header: "Created",
          render: (row) => <span className="font-mono text-xs text-slate-300">{new Date(row.createdAt).toLocaleString()}</span>,
          className: "whitespace-nowrap",
        },
        {
          key: "fileName",
          header: "File",
          render: (row) => (
            <div className="flex items-center gap-2">
              <IconFileText size={16} className="text-slate-400" />
              <div>
                <p className="text-slate-100 truncate max-w-xs">{row.fileName}</p>
                <p className="text-xs text-slate-500 font-mono">{row.mimeType}</p>
              </div>
            </div>
          ),
        },
        {
          key: "fileSize",
          header: "Size",
          render: (row) => <span className="font-mono text-slate-300">{formatFileSize(row.fileSize)}</span>,
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
    />
  );
}