"use client";

import type { ReactNode } from "react";

export function MetricCard({
  label,
  value,
  hint,
  icon,
  trend,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  trend?: { value: string; positive: boolean };
}) {
  return (
    <div className="admin-surface-motion group rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 truncate">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{value}</p>
          {hint ? <p className="mt-2 text-xs text-slate-400">{hint}</p> : null}
          {trend ? (
            <p className="mt-2 flex items-center gap-1 text-xs font-medium">
              <span className={trend.positive ? "text-emerald-300" : "text-red-300"}>{trend.value}</span>
              <span className="text-slate-500">vs previous period</span>
            </p>
          ) : null}
        </div>
        {icon ? (
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-emerald-300 transition-colors duration-200 group-hover:border-emerald-300/20 group-hover:bg-emerald-300/10"
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>
    </div>
  );
}
