"use client";

import { useEffect, useMemo, useState } from "react";

function getGreeting(hour: number) {
  if (hour < 5) return "Late study session";
  if (hour < 12) return "Morning focus";
  if (hour < 17) return "Afternoon study";
  if (hour < 21) return "Evening revision";
  return "Night revision";
}

export function DashboardDateTime() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const firstTick = window.setTimeout(() => setNow(new Date()), 0);
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(interval);
    };
  }, []);

  const formatted = useMemo(() => {
    if (!now) {
      return {
        greeting: "Study session",
        time: "--:--",
        date: "Loading local date",
        day: "Today",
      };
    }

    return {
      greeting: getGreeting(now.getHours()),
      time: new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(now),
      date: new Intl.DateTimeFormat(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(now),
      day: new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now),
    };
  }, [now]);

  return (
    <section className="relative overflow-hidden rounded-lg border border-emerald-300/20 bg-slate-950/70 p-5 shadow-2xl shadow-emerald-950/20">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.15),rgba(6,78,59,0.12))]" />
      <div className="relative flex items-start justify-between gap-5">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
            {formatted.greeting}
          </div>
          <p className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">{formatted.time}</p>
          <p className="mt-2 text-sm font-medium text-slate-300">{formatted.day}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Local date</p>
          <p className="mt-2 max-w-36 text-sm font-semibold leading-5 text-slate-100">{formatted.date}</p>
        </div>
      </div>
    </section>
  );
}
