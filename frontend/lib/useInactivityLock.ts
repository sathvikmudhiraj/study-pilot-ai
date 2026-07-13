"use client";

import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_IDLE_MINUTES = 30;
const STORAGE_KEY = "studypilot_idle_minutes";

function getStoredMinutes(): number {
  if (typeof window === "undefined") return DEFAULT_IDLE_MINUTES;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const parsed = parseInt(stored, 10);
      if (!Number.isNaN(parsed) && parsed >= 1 && parsed <= 480) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable — use default
  }
  return DEFAULT_IDLE_MINUTES;
}

export function useInactivityLock(enabled = true) {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleMinutes = getStoredMinutes();

  const lock = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    router.push("/auth?mode=login");
  }, [router]);

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(lock, idleMinutes * 60_000);
  }, [enabled, idleMinutes, lock]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const events: (keyof WindowEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "wheel",
      "pointermove",
      "pointerdown",
    ];

    for (const event of events) {
      window.addEventListener(event, resetTimer, { passive: true });
    }

    resetTimer();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      for (const event of events) {
        window.removeEventListener(event, resetTimer);
      }
    };
  }, [enabled, resetTimer]);

  return idleMinutes;
}