"use client";

type StatusVariant = "ok" | "warning" | "error" | "configuration" | "unknown";

const variantStyles: Record<StatusVariant, string> = {
  ok: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  error: "border-red-400/20 bg-red-400/10 text-red-200",
  configuration: "border-cyan-400/20 bg-cyan-400/10 text-cyan-200",
  unknown: "border-white/10 bg-white/[0.06] text-slate-300",
};

const variantLabels: Record<StatusVariant, string> = {
  ok: "OK",
  warning: "Warning",
  error: "Error",
  configuration: "Config Error",
  unknown: "Unknown",
};

export function StatusBadge({
  status,
  customLabel,
  showDot = true,
}: {
  status: StatusVariant;
  customLabel?: string;
  showDot?: boolean;
}) {
  const label = customLabel ?? variantLabels[status];
  const style = variantStyles[status];

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${style}`}>
      {showDot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {label}
    </span>
  );
}

export function StatusDot({ status }: { status: StatusVariant }) {
  const colors: Record<StatusVariant, string> = {
    ok: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
    configuration: "bg-cyan-400",
    unknown: "bg-slate-500",
  };

  return <span className={`inline-block h-2 w-2 rounded-full ${colors[status]}`} aria-hidden="true" />;
}