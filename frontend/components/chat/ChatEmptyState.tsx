"use client";

import {
  IconBookOpen,
  IconFileText,
  IconQuiz,
  IconRevision,
  IconSparkles,
} from "../icons";

const SUGGESTIONS = [
  {
    label: "Give important notes",
    detail: "Pull key points from attached files",
    icon: IconBookOpen,
  },
  {
    label: "Explain this file simply",
    detail: "Turn dense content into plain language",
    icon: IconFileText,
  },
  {
    label: "Summarize topic-wise",
    detail: "Organize by chapter or concept",
    icon: IconSparkles,
  },
  {
    label: "Generate exam questions",
    detail: "Practice with focused revision prompts",
    icon: IconQuiz,
  },
  {
    label: "Give viva questions",
    detail: "Prepare short oral answers",
    icon: IconFileText,
  },
  {
    label: "Make memory tricks",
    detail: "Create recall lines and mnemonics",
    icon: IconRevision,
  },
  {
    label: "Explain like a beginner",
    detail: "Start from the fundamentals",
    icon: IconBookOpen,
  },
];

export function ChatEmptyState({
  onPick,
}: {
  onPick: (suggestion: string) => void;
}) {
  return (
    <div className="mx-auto flex min-h-[52svh] max-w-4xl flex-col items-center justify-center px-2 py-10 text-center sm:py-16">
      <div className="relative mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-emerald-300/25 bg-[radial-gradient(circle_at_30%_20%,rgba(110,231,183,0.32),rgba(16,185,129,0.08)_52%,rgba(15,23,42,0.78))] text-emerald-200 shadow-[0_0_45px_rgba(16,185,129,0.18)]">
        <IconSparkles size={27} />
        <span
          className="absolute -inset-4 rounded-full border border-emerald-300/10"
          aria-hidden="true"
        />
        <span
          className="absolute -inset-8 rounded-full border border-cyan-300/[0.06]"
          aria-hidden="true"
        />
      </div>
      <h2 className="text-2xl font-bold text-white sm:text-3xl">
        What would you like to study?
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
        Ask a question, attach your notes, and StudyPilot will answer from your
        own study material.
      </p>

      <div className="mt-8 grid w-full gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {SUGGESTIONS.map((suggestion) => {
          const SuggestionIcon = suggestion.icon;
          return (
            <button
              key={suggestion.label}
              type="button"
              onClick={() => onPick(suggestion.label)}
              className="group min-h-24 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:-translate-y-0.5 hover:border-emerald-300/30 hover:bg-emerald-400/[0.06] hover:shadow-[0_16px_40px_rgba(0,0,0,0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
            >
              <span className="mb-3 grid h-8 w-8 place-items-center rounded-lg border border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200 transition group-hover:border-emerald-300/35 group-hover:bg-emerald-300/[0.12]">
                <SuggestionIcon size={16} />
              </span>
              <span className="block text-sm font-semibold leading-5 text-white">
                {suggestion.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">
                {suggestion.detail}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
