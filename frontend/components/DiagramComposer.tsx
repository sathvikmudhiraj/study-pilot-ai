"use client";

import { useState } from "react";
import {
  DIAGRAM_TYPES,
  type DiagramRequest,
  type DiagramSourceOption,
  type DiagramType,
} from "@/frontend/lib/diagram";
import { IconImage, IconX } from "./icons";

type DiagramComposerProps = {
  sources: DiagramSourceOption[];
  loading: boolean;
  onClose: () => void;
  onGenerate: (request: DiagramRequest, sourceLabel: string) => void;
};

const diagramLabels: Record<DiagramType, string> = {
  flowchart: "Flowchart",
  mind_map: "Mind map",
  concept_map: "Concept map",
  sequence_diagram: "Sequence diagram",
  timeline: "Timeline",
  comparison_diagram: "Comparison diagram",
  study_process: "Study process",
};

export function DiagramComposer({ sources, loading, onClose, onGenerate }: DiagramComposerProps) {
  const [diagramType, setDiagramType] = useState<DiagramType>("concept_map");
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "custom-topic");
  const [topic, setTopic] = useState("");
  const [error, setError] = useState("");

  const selectedSource = sources.find((source) => source.id === sourceId);
  const isTopic = !selectedSource || selectedSource.sourceType === "topic";

  function submit() {
    setError("");
    if (isTopic) {
      const cleanTopic = topic.trim();
      if (cleanTopic.length < 3) {
        setError("Enter a topic with at least 3 characters.");
        return;
      }
      onGenerate({ diagramType, sourceType: "topic", topic: cleanTopic }, cleanTopic);
      return;
    }

    const request: DiagramRequest = {
      diagramType,
      sourceType: selectedSource.sourceType,
      ...(selectedSource.answerId ? { answerId: selectedSource.answerId } : {}),
      ...(selectedSource.fileId ? { fileId: selectedSource.fileId } : {}),
      ...(selectedSource.sourceText ? { sourceText: selectedSource.sourceText } : {}),
    };
    onGenerate(request, selectedSource.label);
  }

  return (
    <div className="fixed inset-0 z-[70] grid place-items-end bg-black/65 sm:place-items-center sm:p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagram-composer-title"
        className="max-h-[90svh] w-full overflow-y-auto rounded-t-2xl border border-white/10 bg-slate-950 shadow-2xl shadow-black/60 sm:max-w-xl sm:rounded-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-5">
          <div>
            <div className="flex items-center gap-2 text-pink-200">
              <IconImage size={17} />
              <h2 id="diagram-composer-title" className="font-bold text-white">Generate diagram</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">Choose a grounded source and a visual structure.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
            aria-label="Close diagram generator"
          >
            <IconX size={16} />
          </button>
        </header>

        <div className="grid gap-5 p-4 sm:p-5">
          <label className="grid gap-2 text-sm font-semibold text-slate-200">
            Diagram type
            <select
              value={diagramType}
              onChange={(event) => setDiagramType(event.target.value as DiagramType)}
              disabled={loading}
              className="h-11 rounded-md border border-white/10 bg-[#080e1c] px-3 text-sm text-white outline-none transition focus:border-pink-300/45 focus:ring-2 focus:ring-pink-300/15"
            >
              {DIAGRAM_TYPES.map((type) => <option key={type} value={type}>{diagramLabels[type]}</option>)}
            </select>
          </label>

          <label className="grid gap-2 text-sm font-semibold text-slate-200">
            Source
            <select
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={loading}
              className="h-11 rounded-md border border-white/10 bg-[#080e1c] px-3 text-sm text-white outline-none transition focus:border-pink-300/45 focus:ring-2 focus:ring-pink-300/15"
            >
              {sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
            </select>
            {selectedSource ? <span className="font-normal text-slate-500">{selectedSource.detail}</span> : null}
          </label>

          {isTopic ? (
            <label className="grid gap-2 text-sm font-semibold text-slate-200">
              Topic
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submit();
                  }
                }}
                disabled={loading}
                maxLength={500}
                autoFocus
                placeholder="Example: CIA triad"
                className="h-11 rounded-md border border-white/10 bg-[#080e1c] px-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-pink-300/45 focus:ring-2 focus:ring-pink-300/15"
              />
            </label>
          ) : null}

          {error ? <p className="rounded-md border border-red-300/25 bg-red-300/10 px-3 py-2 text-sm text-red-100">{error}</p> : null}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-white/10 px-4 py-4 sm:flex-row sm:justify-end sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="h-10 rounded-md border border-white/10 px-4 text-sm font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="h-10 rounded-md bg-pink-300 px-4 text-sm font-bold text-slate-950 transition hover:bg-pink-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate diagram"}
          </button>
        </footer>
      </section>
    </div>
  );
}
