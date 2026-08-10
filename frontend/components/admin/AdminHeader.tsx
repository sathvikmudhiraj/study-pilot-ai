"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { IconAdmin, IconSignOut, IconActivity, IconFileText, IconBarChart, IconClipboardList } from "../icons";

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
            Read-Only
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
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
          { label: "Monitoring", href: "/admin/monitoring", icon: <IconActivity size={14} /> },
          { label: "Files", href: "/admin/files", icon: <IconFileText size={14} /> },
          { label: "Analytics", href: "/admin/analytics", icon: <IconBarChart size={14} /> },
          { label: "Audit", href: "/admin/audit-logs", icon: <IconClipboardList size={14} /> },
        ].map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
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