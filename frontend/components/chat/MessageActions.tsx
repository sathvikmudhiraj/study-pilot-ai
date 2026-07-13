"use client";

import { useEffect, useState } from "react";
import { IconCopy, IconCheck, IconRefresh, IconVolume, IconVolumeOff, IconThumbsUp, IconThumbsDown } from "../icons";
import type { ChatAnswer } from "./AssistantAnswer";

type MessageActionsProps = {
  answer: ChatAnswer;
  speaking: boolean;
  onCopy: (answer: ChatAnswer) => string;
  onRegenerate: () => void;
  onReadAloud: () => void;
  onStopSpeaking: () => void;
  regenerating?: boolean;
};

const actionButton =
  "inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 text-xs font-medium text-slate-300 transition hover:bg-white/[0.08] hover:text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] disabled:cursor-not-allowed disabled:opacity-50";

export function MessageActions({
  answer,
  speaking,
  onCopy,
  onRegenerate,
  onReadAloud,
  onStopSpeaking,
  regenerating = false,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [vote, setVote] = useState<"up" | "down" | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  function handleCopy() {
    const text = onCopy(answer);
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Message actions">
      <button type="button" onClick={handleCopy} className={actionButton} aria-label={copied ? "Copied" : "Copy answer"}>
        {copied ? <IconCheck size={14} className="text-emerald-300" /> : <IconCopy size={14} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        className={actionButton}
        aria-label="Regenerate answer"
      >
        <IconRefresh size={14} className={regenerating ? "animate-spin" : ""} />
        {regenerating ? "Regenerating" : "Regenerate"}
      </button>
      {speaking ? (
        <button
          type="button"
          onClick={onStopSpeaking}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-300/25 bg-red-300/10 px-2 text-xs font-medium text-red-100 transition hover:bg-red-300/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14]"
          aria-label="Stop speaking"
        >
          <IconVolumeOff size={14} />
          Stop
        </button>
      ) : (
        <button type="button" onClick={onReadAloud} className={actionButton} aria-label="Read answer aloud">
          <IconVolume size={14} />
          Read aloud
        </button>
      )}

      <span className="mx-1 h-4 w-px bg-white/10" aria-hidden="true" />

      <button
        type="button"
        onClick={() => setVote((current) => (current === "up" ? null : "up"))}
        className={`grid h-7 w-7 place-items-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] ${
          vote === "up"
            ? "border-emerald-400/30 bg-emerald-400/15 text-emerald-200"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
        }`}
        aria-label="Good response"
        aria-pressed={vote === "up"}
        title="Good response"
      >
        <IconThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => setVote((current) => (current === "down" ? null : "down"))}
        className={`grid h-7 w-7 place-items-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070b14] ${
          vote === "down"
            ? "border-red-400/30 bg-red-400/15 text-red-200"
            : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.08] hover:text-slate-100"
        }`}
        aria-label="Bad response"
        aria-pressed={vote === "down"}
        title="Bad response"
      >
        <IconThumbsDown size={14} />
      </button>
    </div>
  );
}
