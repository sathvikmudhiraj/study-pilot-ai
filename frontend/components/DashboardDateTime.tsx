"use client";

import { useMemo, useSyncExternalStore } from "react";

type LocalDateTime = {
  greeting: string;
  time: string;
  date: string;
  day: string;
  timeZone: string;
};

const fallbackLocalDateTime: LocalDateTime = {
  greeting: "Study session",
  time: "--:--",
  date: "--",
  day: "Today",
  timeZone: "",
};

let currentTimestamp = 0;
let clockInterval: number | null = null;
const clockListeners = new Set<() => void>();

function getGreeting(hour: number) {
  if (hour < 5) return "Late study session";
  if (hour < 12) return "Morning focus";
  if (hour < 17) return "Afternoon study";
  if (hour < 21) return "Evening revision";
  return "Night revision";
}

function publishClockTick() {
  currentTimestamp = Date.now();
  clockListeners.forEach((listener) => listener());
}

function subscribeToLocalClock(listener: () => void) {
  clockListeners.add(listener);
  publishClockTick();
  clockInterval ??= window.setInterval(publishClockTick, 60_000);

  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && clockInterval) {
      window.clearInterval(clockInterval);
      clockInterval = null;
    }
  };
}

function getLocalClockSnapshot() {
  if (currentTimestamp === 0) {
    currentTimestamp = Date.now();
  }
  return currentTimestamp;
}

function getServerLocalClockSnapshot() {
  return 0;
}

function formatLocalDateTime(date = new Date()): LocalDateTime {
  const locale = typeof navigator === "undefined" ? undefined : navigator.language;
  let timeZone = "";

  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    timeZone = "";
  }

  try {
    return {
      greeting: getGreeting(date.getHours()),
      time: new Intl.DateTimeFormat(locale, {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: timeZone || undefined,
      }).format(date),
      date: new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: timeZone || undefined,
      }).format(date),
      day: new Intl.DateTimeFormat(locale, {
        weekday: "long",
        timeZone: timeZone || undefined,
      }).format(date),
      timeZone,
    };
  } catch {
    return {
      greeting: getGreeting(date.getHours()),
      time: date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit", hour12: true }),
      date: date.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" }),
      day: date.toLocaleDateString(locale, { weekday: "long" }),
      timeZone: "",
    };
  }
}

export function DashboardDateTime() {
  const timestamp = useSyncExternalStore(subscribeToLocalClock, getLocalClockSnapshot, getServerLocalClockSnapshot);

  const formatted = useMemo(() => {
    if (!timestamp) return fallbackLocalDateTime;
    return formatLocalDateTime(new Date(timestamp));
  }, [timestamp]);

  return (
    <section className="relative overflow-hidden rounded-lg border border-emerald-300/20 bg-slate-950/70 p-5 shadow-2xl shadow-emerald-950/20" aria-label="Local date and time">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(52,211,153,0.18),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.15),rgba(6,78,59,0.12))]" />
      <div className="relative flex items-start justify-between gap-5">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.9)] animate-dashboard-status-dot motion-reduce:animate-none" />
            {formatted.greeting}
          </div>
          <p className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">{formatted.time}</p>
          <p className="mt-2 text-sm font-medium text-slate-300">{formatted.day}</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Local date</p>
          <p className="mt-2 max-w-36 text-sm font-semibold leading-5 text-slate-100" title={formatted.timeZone ? `Timezone: ${formatted.timeZone}` : undefined}>
            {formatted.date}
          </p>
        </div>
      </div>
    </section>
  );
}
