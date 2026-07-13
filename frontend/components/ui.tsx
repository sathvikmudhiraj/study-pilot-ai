import Link from "next/link";
import type { ReactNode } from "react";
import type { AnchorHTMLAttributes } from "react";

/* ─── Card ───────────────────────────────────────────────────────────── */

type CardVariant = "default" | "subtle" | "glass";
type CardPadding = "none" | "md" | "lg";

const cardVariants: Record<CardVariant, string> = {
  default: "border-white/[0.08] bg-white/[0.04]",
  subtle: "border-white/[0.06] bg-white/[0.03]",
  glass: "glass",
};

const cardPaddings: Record<CardPadding, string> = {
  none: "",
  md: "p-5",
  lg: "p-6 sm:p-7",
};

export function Card({
  children,
  className = "",
  hover = true,
  glass = false,
  variant,
  padding = "none",
  accent = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glass?: boolean;
  variant?: CardVariant;
  padding?: CardPadding;
  accent?: boolean;
}) {
  const resolvedVariant = variant ?? (glass ? "glass" : "default");
  return (
    <div
      className={`relative rounded-xl border ${cardVariants[resolvedVariant]} ${cardPaddings[padding]} ${
        accent ? "overflow-hidden" : ""
      } ${hover ? "transition-all duration-200 hover:border-white/[0.15] hover:bg-white/[0.06]" : ""} ${className}`}
    >
      {accent ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent"
        />
      ) : null}
      {children}
    </div>
  );
}

/* ─── Button variants ─────────────────────────────────────────────────── */

export type ButtonSize = "sm" | "md" | "lg";

const baseButton =
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] disabled:cursor-not-allowed disabled:opacity-50";

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3",
  md: "h-10 px-4",
  lg: "h-11 px-5",
};

export const buttonPrimary = `${baseButton} ${buttonSizes.md} bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950/20 hover:bg-emerald-300 hover:shadow-emerald-900/30 hover:-translate-y-[1px] active:translate-y-0`;

export const buttonSecondary = `${baseButton} ${buttonSizes.md} border border-white/10 bg-white/5 text-slate-100 hover:bg-white/10 hover:border-white/[0.15]`;

export const buttonGhost = `${baseButton} ${buttonSizes.md} text-slate-300 hover:bg-white/[0.06] hover:text-white`;

export const buttonDanger = `${baseButton} ${buttonSizes.md} border border-red-300/20 bg-red-400/10 text-red-200 hover:bg-red-400/15 hover:border-red-300/30`;

function withSize(base: string, size?: ButtonSize, fullWidth?: boolean, className?: string) {
  const sizeClass = size ? `${buttonSizes[size]}` : "";
  const widthClass = fullWidth ? "w-full" : "";
  return `${base} ${sizeClass} ${widthClass} ${className ?? ""}`.replace(/\s+/g, " ").trim();
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  ...rest
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    variant === "primary"
      ? buttonPrimary
      : variant === "secondary"
        ? buttonSecondary
        : variant === "danger"
          ? buttonDanger
          : buttonGhost;
  return (
    <button type="button" className={withSize(base, size, fullWidth, className)} {...rest}>
      {children}
    </button>
  );
}

/* ─── ButtonLink ─────────────────────────────────────────────────────── */

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "md",
  fullWidth = false,
  className = "",
  ...rest
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const cls =
    variant === "primary"
      ? buttonPrimary
      : variant === "secondary"
        ? buttonSecondary
        : variant === "danger"
          ? buttonDanger
          : buttonGhost;
  return (
    <Link href={href} className={withSize(cls, size, fullWidth, className)} {...rest}>
      {children}
    </Link>
  );
}

/* ─── Badge ──────────────────────────────────────────────────────────── */

export function Badge({ children, variant = "default", className = "" }: { children: ReactNode; variant?: "default" | "emerald" | "amber" | "cyan" | "red"; className?: string }) {
  const variants = {
    default: "border-white/10 bg-white/[0.06] text-slate-300",
    emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    amber: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    cyan: "border-cyan-400/20 bg-cyan-400/10 text-cyan-200",
    red: "border-red-400/20 bg-red-400/10 text-red-200",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}

/* ─── Field / inputs ────────────────────────────────────────────────── */

export function Field({ label, children, hint, htmlFor }: { label: string; children: ReactNode; hint?: string; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="grid gap-2 text-sm font-medium text-slate-200">
      {label}
      {children}
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </label>
  );
}

export const inputClass =
  "h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-emerald-300/60 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-50";

export const textareaClass =
  "min-h-36 w-full rounded-lg border border-white/10 bg-slate-950/70 p-3 text-sm text-slate-100 outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-emerald-300/60 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-50";

export const selectClass =
  "h-11 w-full appearance-none rounded-lg border border-white/10 bg-slate-950/70 bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%2394a3b8%22%20stroke-width=%222%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22><polyline%20points=%226%209%2012%2015%2018%209%22/></svg>')] bg-[length:16px_16px] bg-[right_0.75rem_center] bg-no-repeat pr-9 text-sm text-slate-100 outline-none transition-all duration-200 focus:border-emerald-300/60 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)] disabled:cursor-not-allowed disabled:opacity-50";

export function Select({
  children,
  className = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${selectClass} ${className}`} {...rest}>
      {children}
    </select>
  );
}

const shimmerWidths = [92, 84, 76, 88, 80, 96];

/* ─── LoadingDots ────────────────────────────────────────────────────── */

export function LoadingDots({ text = "" }: { text?: string }) {
  return (
    <div className="flex items-center gap-2" role="status" aria-label={text || "Loading"}>
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-emerald-400"
            style={{
              animation: `dotPulse 1.4s ease-in-out infinite`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </span>
      {text ? <span className="text-sm text-slate-400">{text}</span> : null}
    </div>
  );
}

/* ─── LoadingShimmer ────────────────────────────────────────────────── */

export function LoadingShimmer({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 rounded-md animate-shimmer"
          style={{ width: `${shimmerWidths[i % shimmerWidths.length]}%` }}
        />
      ))}
    </div>
  );
}

/* ─── EmptyState ─────────────────────────────────────────────────────── */

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center sm:p-10 animate-fade-in">
      {icon ? (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-emerald-300">
          {icon}
        </div>
      ) : null}
      <h3 className="text-lg font-semibold text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ─── PageHeader ─────────────────────────────────────────────────────── */

export function PageHeader({
  badge,
  title,
  description,
  actions,
}: {
  badge?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex min-w-0 flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {badge ? (
          <p className="mb-3 inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            {badge}
          </p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl md:text-4xl animate-fade-in-up">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-slate-400 animate-fade-in-up" style={{ animationDelay: "60ms" }}>{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
    </div>
  );
}

/* ─── StatusDot ───────────────────────────────────────────────────────── */

export function StatusDot({ color = "green", pulse = false }: { color?: "green" | "amber" | "red" | "slate"; pulse?: boolean }) {
  const colors = {
    green: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]",
    amber: "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]",
    red: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]",
    slate: "bg-slate-500",
  };
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${colors[color]} ${pulse ? "animate-pulse" : ""}`} aria-hidden="true" />
  );
}

/* ─── ProgressRing (for voice orb / loading) ─────────────────────────── */

export function ProgressRing({ size = 96, strokeWidth = 4, progress = 0, color = "emerald" }: { size?: number; strokeWidth?: number; progress: number; color?: "emerald" | "cyan" }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(Math.max(progress, 0), 100) / 100) * circumference;
  const strokeColor = color === "cyan" ? "#22d3ee" : "#34d399";

  return (
    <svg width={size} height={size} className="transform -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={strokeWidth} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-500 ease-out"
      />
    </svg>
  );
}

/* ─── MetricCard (dashboard KPIs) ─────────────────────────────────────── */

export function MetricCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card accent padding="md" hover={false} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        {icon ? (
          <span
            className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-emerald-300"
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{value}</p>
      {hint ? <p className="text-xs text-slate-400">{hint}</p> : null}
    </Card>
  );
}

/* ─── SkeletonCard (per-route loading.tsx) ─────────────────────────────── */

export function SkeletonCard({ className = "", height = "h-32" }: { className?: string; height?: string }) {
  return (
    <div className={`rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 ${height} ${className}`}>
      <div className="space-y-3">
        <div className="h-4 w-1/3 rounded-md animate-shimmer" />
        <div className="h-4 w-2/3 rounded-md animate-shimmer" />
        <div className="h-4 w-1/2 rounded-md animate-shimmer" />
      </div>
    </div>
  );
}

/* ─── SectionDivider ──────────────────────────────────────────────────── */

export function Divider({ className = "", label }: { className?: string; label?: string }) {
  if (label) {
    return (
      <div className={`flex items-center gap-3 ${className}`} role="separator" aria-label={label}>
        <span className="h-px flex-1 bg-white/[0.06]" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</span>
        <span className="h-px flex-1 bg-white/[0.06]" aria-hidden="true" />
      </div>
    );
  }
  return <div className={`h-px w-full bg-white/[0.06] ${className}`} role="separator" aria-orientation="horizontal" />;
}
