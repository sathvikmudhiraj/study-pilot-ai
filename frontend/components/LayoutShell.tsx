"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useInactivityLock } from "@/frontend/lib/useInactivityLock";
import {
  IconDashboard,
  IconUpload,
  IconFiles,
  IconChat,
  IconMic,
  IconSummarize,
  IconQuiz,
  IconRevision,
  IconSignOut,
  IconMenu,
  IconX,
  IconAdmin,
} from "./icons";

type NavItem = {
  label: string;
  href: string;
  icon: ReactNode;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: <IconDashboard size={18} /> },
  { label: "Upload Notes", href: "/upload", icon: <IconUpload size={18} /> },
  { label: "My Files", href: "/files", icon: <IconFiles size={18} /> },
  { label: "AI Chat", href: "/chat", icon: <IconChat size={18} /> },
  { label: "Voice Tutor", href: "/voice", icon: <IconMic size={18} /> },
  { label: "Summaries", href: "/summary", icon: <IconSummarize size={18} /> },
  { label: "Quizzes", href: "/quiz", icon: <IconQuiz size={18} /> },
  { label: "Revision", href: "/revision", icon: <IconRevision size={18} /> },
];

const adminNavItem: NavItem = { label: "Admin", href: "/admin", icon: <IconAdmin size={18} /> };

function NavItemLink({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
        active
          ? "bg-emerald-400/10 text-emerald-200 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.15)]"
          : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
      }`}
      aria-current={active ? "page" : undefined}
    >
      <span className={`shrink-0 ${active ? "text-emerald-300" : "text-slate-500 group-hover:text-slate-300"}`}>
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

export function LayoutShell({
  children,
  userName,
  userRole,
  isAdmin,
  onSignOut,
}: {
  children: ReactNode;
  userName: string;
  userRole: string;
  isAdmin?: boolean;
  onSignOut?: () => void;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const activeHref = navItems.find((item) => pathname.startsWith(item.href))?.href ?? "";

  useInactivityLock();

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const signOut = useCallback(async () => {
    if (onSignOut) {
      onSignOut();
      return;
    }

    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/");
  }, [onSignOut]);

  // Close drawer on escape
  useEffect(() => {
    if (!drawerOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeDrawer();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [drawerOpen, closeDrawer]);

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#070b14]">
      {/* ─── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 hidden w-[260px] border-r border-white/[0.06] bg-slate-950/90 p-4 lg:flex lg:flex-col backdrop-blur-xl">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-3 px-2 py-2 group">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-xs font-bold text-emerald-300 shadow-lg shadow-emerald-950/20 transition group-hover:border-emerald-400/35 group-hover:bg-emerald-400/15">
            SP
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">StudyPilot AI</div>
            <div className="text-xs text-slate-400">Learning workspace</div>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="mt-6 flex-1 grid gap-1 overflow-y-auto px-1" aria-label="Main navigation">
          {navItems.map((item) => (
            <NavItemLink key={item.href} item={item} active={activeHref === item.href} />
          ))}
          {isAdmin ? <NavItemLink item={adminNavItem} active={activeHref === "/admin"} /> : null}
        </nav>

        {/* User info */}
        <div className="mt-auto border-t border-white/[0.06] pt-4 px-1">
          <div className="flex items-center gap-3 px-2">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-xs font-bold text-emerald-300 border border-emerald-400/15">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-white">{userName}</div>
              <div className="text-xs text-slate-400 capitalize">{userRole}</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ─── Mobile drawer overlay ────────────────────────────────────── */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
            onClick={closeDrawer}
            aria-hidden="true"
          />

          {/* Drawer */}
          <div
            ref={drawerRef}
            className="absolute inset-y-0 left-0 w-[280px] border-r border-white/[0.06] bg-slate-950 p-4 shadow-2xl shadow-black/50 animate-slide-in-left"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            {/* Drawer header */}
            <div className="flex items-center justify-between px-2 mb-6">
              <Link href="/dashboard" onClick={closeDrawer} className="flex items-center gap-3 group">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-xs font-bold text-emerald-300">
                  SP
                </div>
                <div className="text-sm font-bold text-white">StudyPilot AI</div>
              </Link>
              <button
                onClick={closeDrawer}
                className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
                aria-label="Close menu"
              >
                <IconX size={18} />
              </button>
            </div>

            {/* Drawer nav */}
            <nav className="grid gap-1 px-1" aria-label="Main navigation">
              {navItems.map((item) => (
                <NavItemLink key={item.href} item={item} active={activeHref === item.href} onClick={closeDrawer} />
              ))}
              {isAdmin ? (
                <NavItemLink item={adminNavItem} active={activeHref === "/admin"} onClick={closeDrawer} />
              ) : null}
            </nav>

            {/* Drawer footer */}
            <div className="mt-6 border-t border-white/[0.06] pt-4 px-1">
              <div className="flex items-center gap-3 px-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-400/10 text-xs font-bold text-emerald-300 border border-emerald-400/15">
                  {userName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{userName}</div>
                  <div className="text-xs text-slate-400 capitalize">{userRole}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Main content area ───────────────────────────────────────── */}
      <main className="min-w-0 lg:pl-[260px]">
        {/* Top header bar */}
        <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#070b14]/80 px-4 py-3 backdrop-blur-xl md:px-6">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile menu button */}
              <button
                onClick={() => setDrawerOpen(true)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white lg:hidden"
                aria-label="Open navigation menu"
              >
                <IconMenu size={20} />
              </button>

              {/* Mobile logo */}
              <Link href="/dashboard" className="min-w-0 truncate text-sm font-bold text-white lg:hidden">
                StudyPilot AI
              </Link>

              {/* Desktop welcome */}
              <div className="hidden text-sm text-slate-400 lg:block">
                Welcome back, <span className="text-slate-100 font-medium">{userName}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <span className="hidden sm:inline-flex rounded-lg border border-emerald-400/15 bg-emerald-400/[0.08] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-300">
                {userRole}
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

          {/* Mobile bottom nav bar */}
          <nav className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-1 lg:hidden scrollbar-none" aria-label="Quick navigation">
            {navItems.map((item) => {
              const active = activeHref === item.href;
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

        {/* Page content */}
        <div className="min-w-0 px-4 py-6 sm:py-8 md:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  );
}
