"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconDashboard, IconActivity, IconFileText, IconBarChart, IconClipboardList } from "../icons";

type AdminNavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
};

const adminNavItems: AdminNavItem[] = [
  { label: "Overview", href: "/admin", icon: <IconDashboard size={18} /> },
  { label: "Monitoring", href: "/admin/monitoring", icon: <IconActivity size={18} /> },
  { label: "File Operations", href: "/admin/files", icon: <IconFileText size={18} /> },
  { label: "Learning Analytics", href: "/admin/analytics", icon: <IconBarChart size={18} /> },
  { label: "Audit Logs", href: "/admin/audit-logs", icon: <IconClipboardList size={18} /> },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 border-r border-white/[0.06] bg-slate-950/90 p-4 flex flex-col">
      <Link href="/admin" className="flex items-center gap-3 px-2 py-2 mb-6">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-xs font-bold text-emerald-300">
          AD
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-white">Admin Portal</div>
          <div className="text-xs text-slate-400">StudyPilot AI</div>
        </div>
      </Link>

      <nav className="flex-1 grid gap-1 overflow-y-auto px-1" aria-label="Admin navigation">
        {adminNavItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                active
                  ? "bg-emerald-400/10 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.15)]"
                  : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
              }`}
              aria-current={active ? "page" : undefined}
            >
              <span className={`shrink-0 ${active ? "text-emerald-300" : "text-slate-500"}`}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/[0.06] pt-4 px-1 text-xs text-slate-500">
        <p>Read-only visibility layer. No mutating controls.</p>
      </div>
    </aside>
  );
}