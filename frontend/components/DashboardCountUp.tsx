"use client";

import { useEffect, useRef, useState } from "react";

export function DashboardCountUp({ value, durationMs = 650 }: { value: number; durationMs?: number }) {
  const [displayValue, setDisplayValue] = useState(0);
  const hasAnimatedRef = useRef(false);

  useEffect(() => {
    if (hasAnimatedRef.current) return;
    hasAnimatedRef.current = true;

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || value <= 0) {
      const timer = window.setTimeout(() => setDisplayValue(value), 0);
      return () => window.clearTimeout(timer);
    }

    let frame = 0;
    const startedAt = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - startedAt) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * eased));

      if (progress < 1) {
        frame = window.requestAnimationFrame(tick);
      }
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, value]);

  return (
    <span aria-label={String(value)}>
      <span aria-hidden="true">{displayValue}</span>
    </span>
  );
}
