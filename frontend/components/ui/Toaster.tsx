"use client";

/**
 * Minimal dependency-free toast system.
 *
 * Exposes `toast(message, { tone })` to call from anywhere in client code,
 * and a `<Toaster />` mounted once at the root to render the stack.
 * Designed for enterprise-grade cross-page feedback without adding a library.
 */

import { useEffect, useState } from "react";

export type ToastTone = "default" | "success" | "error" | "info";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type Listener = (items: ToastItem[]) => void;

let nextId = 1;
let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function notify() {
  for (const listener of listeners) listener(items);
}

function push(message: string, tone: ToastTone, duration = 4000) {
  const id = nextId++;
  items = [...items, { id, message, tone }];
  notify();
  if (duration > 0) {
    window.setTimeout(() => dismiss(id), duration);
  }
  return id;
}

function dismiss(id: number) {
  items = items.filter((item) => item.id !== id);
  notify();
}

export const toast = {
  show: (message: string, opts?: { tone?: ToastTone; duration?: number }) =>
    push(message, opts?.tone ?? "default", opts?.duration),
  success: (message: string, duration?: number) => push(message, "success", duration),
  error: (message: string, duration?: number) => push(message, "error", duration ?? 6000),
  info: (message: string, duration?: number) => push(message, "info", duration),
  dismiss,
};

const toneStyles: Record<ToastTone, { border: string; text: string; dot: string }> = {
  default: { border: "border-white/10", text: "text-slate-100", dot: "bg-slate-300" },
  success: { border: "border-emerald-400/30", text: "text-emerald-100", dot: "bg-emerald-400" },
  error: { border: "border-red-400/30", text: "text-red-100", dot: "bg-red-400" },
  info: { border: "border-cyan-400/30", text: "text-cyan-100", dot: "bg-cyan-400" },
};

export function Toaster() {
  const [currentItems, setCurrentItems] = useState<ToastItem[]>(items);

  useEffect(() => {
    const listener: Listener = (next) => setCurrentItems(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (!currentItems.length) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[120] flex flex-col items-center gap-2 px-3 sm:items-end sm:px-5"
      aria-live="assertive"
      aria-atomic="true"
    >
      {currentItems.map((item) => {
        const style = toneStyles[item.tone];
        return (
          <div
            key={item.id}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border ${style.border} bg-slate-950/90 p-3 shadow-2xl shadow-black/40 backdrop-blur-xl animate-slide-in-right`}
            role="status"
          >
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
            <p className={`min-w-0 break-words text-sm leading-6 ${style.text}`}>{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="ml-auto -mt-0.5 -mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 transition hover:bg-white/[0.08] hover:text-white"
              aria-label="Dismiss notification"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
