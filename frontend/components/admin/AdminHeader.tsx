"use client";

import { useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { IconAdmin, IconSignOut, IconActivity, IconFileText, IconBarChart, IconClipboardList, IconUsers } from "../icons";

let adminClockTimestamp = 0;
let adminClockInterval: number | null = null;
const adminClockListeners = new Set<() => void>();

function isActiveAdminPath(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

function publishAdminClockTick() {
  adminClockTimestamp = Date.now();
  adminClockListeners.forEach((listener) => listener());
}

function subscribeToAdminClock(listener: () => void) {
  adminClockListeners.add(listener);
  publishAdminClockTick();
  adminClockInterval ??= window.setInterval(publishAdminClockTick, 60_000);

  return () => {
    adminClockListeners.delete(listener);
    if (adminClockListeners.size === 0 && adminClockInterval) {
      window.clearInterval(adminClockInterval);
      adminClockInterval = null;
    }
  };
}

function getAdminClockSnapshot() {
  if (adminClockTimestamp === 0) adminClockTimestamp = Date.now();
  return adminClockTimestamp;
}

function getServerAdminClockSnapshot() {
  return 0;
}

function AdminHeaderClock() {
  const timestamp = useSyncExternalStore(subscribeToAdminClock, getAdminClockSnapshot, getServerAdminClockSnapshot);

  const formatted = useMemo(() => {
    if (!timestamp) return { time: "--:--", date: "--", day: "Today" };
    const date = new Date(timestamp);
    const locale = typeof navigator === "undefined" ? undefined : navigator.language;

    return {
      time: new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: true }).format(date),
      date: new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short", year: "numeric" }).format(date),
      day: new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date),
    };
  }, [timestamp]);

  return (
    <div className="hidden items-center gap-3 rounded-xl border border-white/10 bg-white/[0.035] px-3 py-1.5 text-right shadow-inner shadow-black/20 xl:flex">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.75)]" aria-hidden="true" />
      <div className="leading-none">
        <p className="text-xs font-bold text-white">{formatted.time}</p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {formatted.day}, {formatted.date}
        </p>
      </div>
    </div>
  );
}

export function AdminHeader({ userName }: { userName: string }) {
  const pathname = usePathname();

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  };

  return (
    <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#070b14]/80 px-4 py-3 backdrop-blur-xl md:px-6">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/admin" className="min-w-0 truncate text-sm font-bold text-white">
            Admin Portal
          </Link>
          <span className="hidden sm:inline-flex rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            Admin
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <AdminHeaderClock />
          <span className="hidden sm:inline-flex rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-300">
            {userName}
          </span>
          <span className="hidden sm:inline-flex rounded-lg border border-emerald-400/15 bg-emerald-400/[0.08] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">
            Admin
          </span>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-300 transition hover:border-red-300/25 hover:bg-red-300/10 hover:text-red-100"
            aria-label="Sign out"
          >
            <IconSignOut size={16} />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      <nav className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-1 lg:hidden scrollbar-none" aria-label="Admin quick navigation">
        {[
          { label: "Overview", href: "/admin", icon: <IconAdmin size={14} /> },
          { label: "Users", href: "/admin/users", icon: <IconUsers size={14} /> },
          { label: "Monitoring", href: "/admin/monitoring", icon: <IconActivity size={14} /> },
          { label: "Files", href: "/admin/files", icon: <IconFileText size={14} /> },
          { label: "Analytics", href: "/admin/analytics", icon: <IconBarChart size={14} /> },
          { label: "Audit", href: "/admin/audit-logs", icon: <IconClipboardList size={14} /> },
        ].map((item) => {
          const active = isActiveAdminPath(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                  : "border-white/[0.06] bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
