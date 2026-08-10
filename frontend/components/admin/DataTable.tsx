"use client";

import type { ReactNode } from "react";

type Column<T> = {
  key: string;
  header: string;
  render?: (row: T, index: number) => ReactNode;
  className?: string;
  headerClassName?: string;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  keyAccessor: (row: T) => string;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
  striped?: boolean;
  hoverable?: boolean;
  compact?: boolean;
  className?: string;
};

export function DataTable<T>({
  columns,
  data,
  keyAccessor,
  emptyMessage = "No data available",
  emptyIcon,
  striped = true,
  hoverable = true,
  compact = false,
  className = "",
}: DataTableProps<T>) {
  if (!data.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center animate-fade-in">
        {emptyIcon ? (
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-500">
            {emptyIcon}
          </div>
        ) : null}
        <h3 className="text-lg font-semibold text-white">{emptyMessage}</h3>
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.03] ${className}`}>
      <table className="w-full border-collapse" role="table">
        <thead>
          <tr className="border-b border-white/[0.08]">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 ${column.headerClassName ?? ""}`}
                style={{ minWidth: column.className?.includes("w-") ? undefined : "120px" }}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {data.map((row, rowIndex) => (
            <tr
              key={keyAccessor(row)}
              className={`${hoverable ? "transition-colors hover:bg-white/[0.03]" : ""} ${striped && rowIndex % 2 === 1 ? "bg-white/[0.02]" : ""}`}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-3 text-sm text-slate-200 ${compact ? "py-2" : ""} ${column.className ?? ""}`}
                >
                  {column.render ? column.render(row, rowIndex) : String((row as Record<string, unknown>)[column.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}