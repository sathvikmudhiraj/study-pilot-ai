"use client";

import { useId } from "react";

export type VoiceOrbState =
  | "idle"
  | "listening"
  | "loading"
  | "searching"
  | "researching"
  | "visualizing"
  | "speaking"
  | "error"
  | "stopped";

type VoiceOrbProps = {
  state: VoiceOrbState;
  ariaLabel?: string;
};

const OUTER_WAVE = [
  4, 8, 5, 12, 7, 16, 9, 22, 12, 30, 18, 38, 24, 48, 30, 56, 38, 44, 29, 35, 20,
  27, 14, 20, 10, 14, 8, 11, 7, 9, 6, 8, 7, 10, 8, 12, 9, 15, 12, 20, 16, 27,
  22, 36, 28, 48, 36, 58, 45, 52, 38, 43, 30, 34, 23, 26, 17, 20, 12, 16, 9, 12,
  7, 10, 6, 8, 5, 7, 4,
];

const INNER_WAVE = [10, 18, 28, 14, 34, 20, 44, 16, 32, 24, 48, 18, 38, 14, 30, 20, 42, 16, 28, 12, 22];

const STAR_POINTS = [
  [8, 26], [16, 68], [24, 17], [31, 76], [40, 34], [47, 12], [55, 72], [63, 27],
  [71, 82], [79, 19], [87, 61], [94, 31], [12, 45], [35, 53], [67, 50], [90, 78],
] as const;

function accentFor(state: VoiceOrbState) {
  if (state === "error") return "#fbbf24";
  if (state === "visualizing") return "#f472b6";
  if (state === "researching") return "#a78bfa";
  if (state === "searching") return "#38bdf8";
  if (state === "loading") return "#67e8f9";
  if (state === "speaking") return "#5eead4";
  if (state === "listening") return "#34d399";
  return "#2dd4bf";
}

export function VoiceOrb({ state, ariaLabel }: VoiceOrbProps) {
  const visualState = state === "stopped" ? "idle" : state;
  const accent = accentFor(visualState);
  const activeWave = visualState === "listening" || visualState === "speaking";
  const busy = ["loading", "searching", "researching", "visualizing"].includes(visualState);

  // Unique IDs prevent gradient/filter collisions when multiple orbs exist.
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `vwf-${rawId}`;
  const filterId = `vwg-${rawId}`;

  return (
    <div
      className="relative h-[270px] min-h-[220px] w-full max-w-[650px] [overflow:clip]"
      role="img"
      aria-label={ariaLabel ?? `Voice tutor is ${visualState}`}
      style={{ color: accent }}
    >
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {STAR_POINTS.map(([left, top], index) => (
          <span
            key={`${left}:${top}`}
            className={`absolute rounded-full ${index % 3 === 0 ? "h-1 w-1" : "h-0.5 w-0.5"}`}
            style={{ left: `${left}%`, top: `${top}%`, background: accent, opacity: 0.18 + (index % 4) * 0.09 }}
          />
        ))}
      </div>

      <svg
        viewBox="0 0 640 90"
        preserveAspectRatio="none"
        className="pointer-events-none absolute left-0 top-[43%] h-24 w-full -translate-y-1/2 opacity-80"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="1">
            <stop offset="0" stopColor={accent} stopOpacity="0" />
            <stop offset="0.18" stopColor={accent} stopOpacity="0.5" />
            <stop offset="0.5" stopColor={accent} stopOpacity="0.95" />
            <stop offset="0.82" stopColor={accent} stopOpacity="0.5" />
            <stop offset="1" stopColor={accent} stopOpacity="0" />
          </linearGradient>
          <filter id={filterId} x="-20%" y="-80%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <line x1="0" y1="45" x2="640" y2="45" stroke={accent} strokeOpacity="0.18" />
        <g stroke={`url(#${gradientId})`} strokeWidth="2" strokeLinecap="round" filter={`url(#${filterId})`}>
          {OUTER_WAVE.map((height, index) => {
            const x = (index / (OUTER_WAVE.length - 1)) * 640;
            const displayedHeight = activeWave ? height : busy ? height * 0.72 : height * 0.42;
            return (
              <line
                key={`${height}:${index}`}
                x1={x}
                x2={x}
                y1={45 - displayedHeight / 2}
                y2={45 + displayedHeight / 2}
                style={activeWave ? { "--_delay": `${index * 0.025}s`, animation: "var(--anim-voice-orb-bar-outer)" } as React.CSSProperties : undefined}
              />
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
        <span
          className={`absolute h-56 w-56 rounded-full border ${busy ? "animate-gentle-spin" : "animate-breathe"}`}
          style={{ borderColor: `${accent}28`, borderStyle: "dashed" }}
        />
        <span
          className={`absolute h-64 w-64 rounded-full border ${busy ? "animate-gentle-spin" : ""}`}
          style={{ borderColor: `${accent}1c`, borderStyle: "dotted", animationDirection: "reverse" }}
        />
        <span className="absolute h-48 w-72 rounded-[50%] border" style={{ borderColor: `${accent}25`, transform: "rotate(-12deg)" }} />
        <span className="absolute h-48 w-72 rounded-[50%] border" style={{ borderColor: `${accent}1f`, transform: "rotate(58deg)" }} />
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 h-16 w-72 -translate-x-1/2" aria-hidden="true">
        <span className="absolute inset-x-0 bottom-0 h-14 rounded-[50%] border" style={{ borderColor: `${accent}90`, boxShadow: `0 0 22px ${accent}33, inset 0 0 18px ${accent}18` }} />
        <span className="absolute inset-x-10 bottom-3 h-9 rounded-[50%] border" style={{ borderColor: `${accent}80` }} />
        <span className="absolute inset-x-20 bottom-5 h-5 rounded-[50%]" style={{ background: `${accent}18`, boxShadow: `0 0 30px ${accent}55` }} />
      </div>

      <div className={`absolute left-1/2 top-1/2 grid h-44 w-44 -translate-x-1/2 -translate-y-[56%] place-items-center rounded-full sm:h-48 sm:w-48 ${busy || visualState === "idle" ? "animate-orb-float" : ""}`}>
        {visualState === "listening" ? (
          <span className="absolute inset-0 animate-voice-ring rounded-full border" style={{ borderColor: `${accent}70` }} />
        ) : null}
        <span className="absolute -inset-4 rounded-full blur-2xl" style={{ background: `radial-gradient(circle, ${accent}45, transparent 68%)` }} />
        <span
          className="absolute inset-0 rounded-full p-[3px]"
          style={{
            background: `conic-gradient(from 210deg, ${accent}40, rgba(230,247,255,0.95), ${accent}80, rgba(14,45,58,0.95), rgba(225,250,255,0.9), ${accent}45)`,
            boxShadow: `0 0 24px ${accent}45, 0 0 70px ${accent}22`,
          }}
        >
          <span
            className="relative block h-full w-full overflow-hidden rounded-full border border-white/25"
            style={{
              background: `radial-gradient(circle at 38% 32%, rgba(232,255,255,0.78) 0%, ${accent}65 12%, rgba(6,57,67,0.88) 42%, rgba(2,13,24,0.98) 75%), linear-gradient(145deg, rgba(255,255,255,0.22), transparent 36%)`,
              boxShadow: `inset 0 0 38px rgba(255,255,255,0.18), inset -18px -22px 34px rgba(0,0,0,0.72), inset 15px 10px 26px ${accent}20`,
            }}
          >
            <span className="absolute left-[17%] top-[9%] h-[36%] w-[42%] rotate-[-22deg] rounded-[50%] bg-white/35 blur-md" />
            <span className="absolute inset-[16%] rounded-full border" style={{ borderColor: `${accent}60`, boxShadow: `inset 0 0 25px ${accent}40` }} />
            <span className="absolute inset-[28%] rounded-full border" style={{ borderColor: `${accent}80` }} />
            <span className="absolute left-1/2 top-1/2 h-px w-[82%] -translate-x-1/2 -translate-y-1/2" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, boxShadow: `0 0 9px ${accent}` }} />

            <svg viewBox="0 0 180 80" preserveAspectRatio="none" className="absolute left-[5%] top-1/2 h-20 w-[90%] -translate-y-1/2" aria-hidden="true">
              <g stroke={accent} strokeWidth="1.8" strokeLinecap="round">
                {INNER_WAVE.map((height, index) => {
                  const x = 8 + (index / (INNER_WAVE.length - 1)) * 164;
                  const displayedHeight = activeWave ? height : busy ? height * 0.75 : height * 0.48;
                  return (
                    <line
                      key={`${height}:${index}`}
                      x1={x}
                      x2={x}
                      y1={40 - displayedHeight / 2}
                      y2={40 + displayedHeight / 2}
                      style={activeWave ? { "--_delay": `${index * 0.055}s`, animation: "var(--anim-voice-orb-bar-inner)" } as React.CSSProperties : undefined}
                    />
                  );
                })}
              </g>
            </svg>

            <span className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" style={{ boxShadow: `0 0 7px white, 0 0 18px ${accent}, 0 0 32px ${accent}` }} />

            {visualState === "searching" ? (
              <svg viewBox="0 0 24 24" className="absolute bottom-5 right-6 h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <circle cx="10" cy="10" r="5" /><path d="m14 14 5 5" />
              </svg>
            ) : null}
            {visualState === "researching" ? (
              <svg viewBox="0 0 24 24" className="absolute bottom-5 right-6 h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="6" cy="7" r="2" /><circle cx="18" cy="7" r="2" /><circle cx="12" cy="17" r="2" /><path d="m7.5 8.5 3.2 6.5m5.8-6.5-3.2 6.5M8 7h8" />
              </svg>
            ) : null}
            {visualState === "visualizing" ? (
              <svg viewBox="0 0 24 24" className="absolute bottom-5 right-6 h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <rect x="8" y="3" width="8" height="4" rx="1" /><rect x="3" y="17" width="7" height="4" rx="1" /><rect x="14" y="17" width="7" height="4" rx="1" /><path d="M12 7v5M6.5 17v-3h11v3" />
              </svg>
            ) : null}
          </span>
        </span>
      </div>
    </div>
  );
}
