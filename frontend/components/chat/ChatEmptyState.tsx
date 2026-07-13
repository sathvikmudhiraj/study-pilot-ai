"use client";

import { IconSparkles } from "../icons";

const SUGGESTIONS = [
  "Give important notes",
  "Explain this file simply",
  "Summarize topic-wise",
  "Generate exam questions",
  "Give viva questions",
  "Make memory tricks",
  "Explain like a beginner",
];

export function ChatEmptyState({ onPick }: { onPick: (suggestion: string) => void }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-2 py-10 text-center sm:py-16">
      <div className="relative mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300 shadow-lg shadow-emerald-950/30">
        <IconSparkles size={26} />
        <span className="absolute inset-0 rounded-2xl animate-pulse-glow" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-bold text-white sm:text-2xl">What would you like to study?</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
        Ask a question, attach your notes, and StudyPilot will answer from your own study material.
      </p>

      <div className="mt-7 grid w-full gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onPick(suggestion)}
            className="group rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-left text-sm font-medium leading-5 text-slate-200 transition hover:border-emerald-300/30 hover:bg-emerald-400/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
