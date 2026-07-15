"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  normalizeSourceCitations,
  SourceCitationChips,
  type SourceCitationValue,
} from "./SourceCitationChips";
import { StudyNoteEditor } from "./StudyNoteEditor";
import { adaptStudyNoteRow, type StudyNoteDraft } from "@/frontend/lib/studyNotes";

type Summary = {
  id?: string;
  content?: string | null;
  short_summary: string | null;
  module_overview?: string | null;
  covered_topics?: string[] | null;
  key_points: string[] | null;
  topic_wise_summary?: TopicSummary[] | null;
  exam_focus_points?: string[] | null;
  memory_lines?: string[] | null;
  common_mistakes?: string[] | null;
  action_items: string[] | null;
  important_concepts: string[] | null;
  suggested_tags: string[] | null;
  suggested_title: string | null;
  suggested_next_step: string | null;
  source_citations?: SourceCitationValue[] | null;
  generation_metadata?: GenerationMetadata | null;
};

type GenerationMetadata = {
  attemptedChunks: number;
  successfulChunks: number[];
  failedChunks: number[];
  failureCategories: string[];
  partialCoverage: boolean;
  sourceTextLength: number;
};

type TopicSummary = {
  topic: string;
  explanation: string;
  important_points: string[];
};

const FULL_EXTRACTION_INCOMPLETE_MESSAGE =
  "Full file extraction is incomplete. Re-extract the file or upload the original PPTX/DOCX.";
const STALE_SUMMARY_NOTICE =
  "Summary regeneration failed. The displayed summary is an older saved version.";
const SUMMARY_IN_PROGRESS_NOTICE =
  "A summary is already being generated for this file. Please wait for it to finish, then check the result.";

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function stringList(value: unknown) {
  return list(value).map((item) => String(item));
}

function topicList(value: unknown): TopicSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const topic = String(record.topic ?? "").trim();
      const explanation = String(record.explanation ?? "").trim();
      const importantPoints = stringList(record.important_points);

      if (!topic && !explanation) return null;
      return {
        topic: topic || "Topic",
        explanation,
        important_points: importantPoints,
      };
    })
    .filter((item): item is TopicSummary => Boolean(item));
}

function parseContentSummary(summary: Summary | null) {
  if (!summary?.content) return null;
  try {
    const parsed = JSON.parse(summary.content) as Partial<Summary>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeGenerationMetadata(value: unknown): GenerationMetadata | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const attempted = Number(record.attemptedChunks ?? record.attempted_chunks ?? 0);
  const successful = Array.isArray(record.successfulChunks ?? record.successful_chunks)
    ? (record.successfulChunks as unknown[] ?? record.successful_chunks as unknown[])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    : [];
  const failed = Array.isArray(record.failedChunks ?? record.failed_chunks)
    ? (record.failedChunks as unknown[] ?? record.failed_chunks as unknown[])
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
    : [];
  const categories = Array.isArray(record.failureCategories ?? record.failure_categories)
    ? (record.failureCategories as unknown[] ?? record.failure_categories as unknown[])
        .map((c) => String(c ?? "").trim())
        .filter(Boolean)
    : [];
  const partial = Boolean(record.partialCoverage ?? record.partial_coverage);
  const sourceLen = Number(record.sourceTextLength ?? record.source_text_length ?? 0);

  if (!attempted && !successful.length && !failed.length && !partial) return null;
  return {
    attemptedChunks: attempted,
    successfulChunks: successful,
    failedChunks: failed,
    failureCategories: categories,
    partialCoverage: partial,
    sourceTextLength: Number.isFinite(sourceLen) ? sourceLen : 0,
  };
}

function normalizeSummary(summary: Summary | null): Summary | null {
  if (!summary) return null;
  const content = parseContentSummary(summary);
  const merged = { ...(content ?? {}), ...summary } as Summary;

  return {
    ...merged,
    module_overview: merged.module_overview ?? content?.module_overview ?? null,
    covered_topics: stringList(merged.covered_topics ?? content?.covered_topics),
    topic_wise_summary: topicList(merged.topic_wise_summary ?? content?.topic_wise_summary),
    exam_focus_points: stringList(merged.exam_focus_points ?? content?.exam_focus_points),
    memory_lines: stringList(merged.memory_lines ?? content?.memory_lines),
    common_mistakes: stringList(merged.common_mistakes ?? content?.common_mistakes),
    source_citations: normalizeSourceCitations(merged.source_citations ?? content?.source_citations),
    generation_metadata: normalizeGenerationMetadata(merged.generation_metadata ?? content?.generation_metadata),
  };
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase text-emerald-200">{title}</h3>
      <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-300">
        {items.map((item) => (
          <li key={item} className="rounded-md border border-white/10 bg-slate-950/60 p-3">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SummaryPanel({
  fileId,
  noteId,
  initialSummary,
  canCreateStudyActions = false,
}: {
  fileId?: string;
  noteId?: string;
  initialSummary: Summary | null;
  canCreateStudyActions?: boolean;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(() => normalizeSummary(initialSummary));
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState<StudyNoteDraft | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [staleSummary, setStaleSummary] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [finalElapsedMs, setFinalElapsedMs] = useState<number | null>(null);
  const summaryStartedAtRef = useRef<number | null>(null);

  // Mounted state is initialised from the latest initialSummary prop, so when
  // the parent (file-detail RSC) re-mounts the panel via a `key` change after
  // router.refresh(), the freshly-loaded DB summary is shown. We deliberately
  // do NOT sync prop changes into useState from an effect or in render: the
  // parent passes a stable key that changes precisely when the displayed
  // summary row changes, causing a clean remount with the new prop.

  const readText = useMemo(() => {
    if (!summary) return "";
    return [
      summary.suggested_title,
      summary.short_summary,
      summary.module_overview,
      ...stringList(summary.covered_topics),
      ...stringList(summary.key_points),
      ...stringList(summary.exam_focus_points),
      ...stringList(summary.memory_lines),
      ...stringList(summary.important_concepts),
      summary.suggested_next_step,
    ]
      .filter(Boolean)
      .join(". ");
  }, [summary]);

  // User-visible progress: tick an elapsed-time counter every second while a
  // summary job is running. Cleared on settle (success/loading-end). This gives
  // the user concrete feedback that the job is progressing rather than hung.
  useEffect(() => {
    if (!loading) return;
    summaryStartedAtRef.current = Date.now();
    const interval = window.setInterval(() => {
      if (summaryStartedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - summaryStartedAtRef.current) / 1000));
      }
    }, 1000);
    return () => {
      window.clearInterval(interval);
      summaryStartedAtRef.current = null;
    };
  }, [loading]);

  async function generateSummary() {
    setFinalElapsedMs(null);
    setElapsedSeconds(0);
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, noteId }),
      });
      const data: Record<string, unknown> = await response.json();

      const staleFlag = data.staleSummary === true;
      const regenerationSucceeded = data.regenerationSucceeded !== false && response.ok;
      const partialFlag = data.partialCoverage === true;
      const dataNotice = typeof data.notice === "string" ? data.notice : "";

      // Failure or stale-summary response.
      if (!regenerationSucceeded || staleFlag) {
        const serverError = typeof data.error === "string" ? data.error : "";
        const isAlreadyInProgress =
          response.status === 409 || serverError.toLowerCase().includes("already being generated");
        if (isAlreadyInProgress) {
          setNotice(SUMMARY_IN_PROGRESS_NOTICE);
          return;
        }
        const message = serverError || (staleFlag ? STALE_SUMMARY_NOTICE : "Summary regeneration failed.");

        if (message === FULL_EXTRACTION_INCOMPLETE_MESSAGE) {
          setNotice(message);
        } else {
          // The displayed summary is now known to be a stale saved row.
          setStaleSummary(true);
          setNotice(dataNotice || (staleFlag ? STALE_SUMMARY_NOTICE : `Could not refresh the summary. ${message}`));
        }
        return;
      }

      // Success (full or partial). Replace the displayed summary from the
      // response body and clear the stale flag.
      setSummary(normalizeSummary((data.summary as Summary) ?? null));
      setStaleSummary(false);
      setError("");
      if (typeof data.elapsedMs === "number" && data.elapsedMs > 0) {
        setFinalElapsedMs(data.elapsedMs);
      }
      if (partialFlag) {
        const meta = (data.summary as Summary | undefined)?.generation_metadata;
        const succeeded = meta?.successfulChunks?.length ?? 0;
        const attempted = meta?.attemptedChunks ?? 0;
        setNotice(
          dataNotice ||
            `Partial summary saved: ${succeeded} of ${attempted} source sections processed. Some source sections were unavailable. Regenerate to retry the full module.`,
        );
      } else {
        setNotice(dataNotice);
      }
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Network or AI request failed.";
      if (message === FULL_EXTRACTION_INCOMPLETE_MESSAGE) {
        setNotice(message);
      } else if (summary) {
        setStaleSummary(true);
        setNotice(`Could not refresh the summary. Your saved summary is still shown. ${message}`);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function reextractFile() {
    if (!fileId) return;
    setExtracting(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId, reextractOnly: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "File re-extraction failed.");

      setStaleSummary(false);
      setNotice(
        typeof data.notice === "string"
          ? data.notice
          : "Full file extraction completed. You can now regenerate the full-module summary.",
      );
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "File re-extraction failed.";
      setNotice(message === FULL_EXTRACTION_INCOMPLETE_MESSAGE
        ? message
        : `Could not re-extract the file. ${message}`);
    } finally {
      setExtracting(false);
    }
  }

  function readAloud() {
    if (!readText || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(readText));
  }

  function sourceQuery() {
    if (fileId) return `fileId=${encodeURIComponent(fileId)}`;
    if (noteId) return `noteId=${encodeURIComponent(noteId)}`;
    return "";
  }

  function goToQuiz() {
    const query = sourceQuery();
    if (!query || (!summary && !canCreateStudyActions)) {
      setNotice("Generate a summary or extract readable text before creating a quiz from this material.");
      return;
    }
    router.push(`/quiz?${query}`);
  }

  function goToRevisionPlan() {
    const query = sourceQuery();
    if (!query || (!summary && !canCreateStudyActions)) {
      setNotice("Generate a summary or extract readable text before creating a revision plan from this material.");
      return;
    }
    router.push(`/revision?${query}`);
  }

  async function createNotes(selectedTopic?: string) {
    if (!summary?.id) {
      setNotice("A saved summary is required before creating notes. Generate the summary first, then try again.");
      return;
    }

    setNotesLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/notes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: selectedTopic ? "topic" : "summary",
          summaryId: summary.id,
          ...(fileId ? { fileId } : {}),
          ...(noteId ? { noteId } : {}),
          ...(selectedTopic ? { topic: selectedTopic } : {}),
          style: "standard",
          language: "auto",
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create notes from this summary.");
      const generatedDraft = data.draft ?? data.note;
      if (!generatedDraft) throw new Error("StudyPilot returned an invalid notes preview.");

      setNoteDraft(adaptStudyNoteRow(generatedDraft));
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Could not create notes from this summary.");
    } finally {
      setNotesLoading(false);
    }
  }

  const showStudyActions = Boolean(fileId || noteId);

  return (
    <aside className="min-w-0 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold uppercase text-emerald-300">AI Summary</div>
          <h2 className="mt-3 break-words text-xl font-bold text-white sm:text-2xl">{summary?.suggested_title || "Study summary"}</h2>
        </div>
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
          {fileId ? (
            <button
              type="button"
              onClick={reextractFile}
              disabled={loading || extracting || notesLoading}
              className="min-h-10 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {extracting ? "Re-extracting..." : "Re-extract file"}
            </button>
          ) : null}
          <button
            type="button"
            onClick={generateSummary}
            disabled={loading || extracting || notesLoading}
            className="min-h-10 rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Summarizing..." : summary ? "Regenerate Summary" : "Generate Summary"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-200">
          {error}
        </div>
      ) : null}

      {staleSummary && !loading ? (
        <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/15 p-4 text-sm leading-6 text-amber-100">
          <p className="font-semibold">Older summary shown</p>
          <p className="mt-1">{STALE_SUMMARY_NOTICE} Click <span className="font-semibold">Regenerate Summary</span> to retry, or <span className="font-semibold">Re-extract file</span> if the extracted text itself may be stale.</p>
        </div>
      ) : null}

      {summary?.generation_metadata?.partialCoverage ? (
        <div className="mt-5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 p-4 text-sm leading-6 text-cyan-100">
          <p className="font-semibold">Partial coverage saved</p>
          <p className="mt-1">
            This summary was produced from {summary.generation_metadata.successfulChunks.length} of {summary.generation_metadata.attemptedChunks} source sections.
            Some source sections were unavailable.
            Regenerate to retry the full module.
          </p>
        </div>
      ) : null}

      {notice ? (
        <div className="mt-5 rounded-lg border border-amber-300/30 bg-amber-300/10 p-4 text-sm leading-6 text-amber-100">
          {notice}
        </div>
      ) : null}

      {!summary && !loading && !extracting ? (
        <div className="mt-5 rounded-lg border border-dashed border-white/15 bg-slate-950/70 p-6 text-sm leading-6 text-slate-400">
          Generate a structured summary from this material. StudyPilot will extract readable file text if needed, process large files safely, and save the result here.
        </div>
      ) : null}

      {loading ? (
        <div
          className="mt-5 rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-5 text-sm text-emerald-100"
          role="status"
          aria-live="polite"
        >
          <p>Extracting and summarizing your study material...</p>
          <p className="mt-2 text-xs text-emerald-200/80">
            Elapsed {formatElapsed(elapsedSeconds * 1000)}
            {elapsedSeconds >= 60 ? " — this is taking longer than usual; please keep this page open." : ""}
          </p>
        </div>
      ) : null}

      {finalElapsedMs !== null && !loading ? (
        <div className="mt-3 text-xs text-slate-500" aria-live="polite">
          Last summary generated in {formatElapsed(finalElapsedMs)}.
        </div>
      ) : null}

      {extracting ? (
        <div className="mt-5 rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-5 text-sm text-cyan-100">
          Re-extracting the PDF page by page and validating full-module coverage...
        </div>
      ) : null}

      {notesLoading ? (
        <div className="mt-5 rounded-lg border border-violet-300/20 bg-violet-300/10 p-5 text-sm text-violet-100" role="status">
          Creating a grounded notes preview from the saved summary...
        </div>
      ) : null}

      {summary ? (
        <div className="mt-6 grid gap-5">
          {normalizeSourceCitations(summary.source_citations).length ? (
            <section>
              <h3 className="text-sm font-semibold uppercase text-cyan-200">Sources</h3>
              <div className="mt-3">
                <SourceCitationChips citations={normalizeSourceCitations(summary.source_citations)} />
              </div>
            </section>
          ) : null}

          <section className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4">
            <h3 className="text-sm font-semibold uppercase text-cyan-100">Short summary</h3>
            <p className="mt-3 text-sm leading-6 text-slate-200">{summary.short_summary}</p>
          </section>

          {summary.module_overview ? (
            <section className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
              <h3 className="text-sm font-semibold uppercase text-emerald-200">Module overview</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{summary.module_overview}</p>
            </section>
          ) : null}

          <SectionList title="Covered topics" items={stringList(summary.covered_topics)} />

          {topicList(summary.topic_wise_summary).length ? (
            <section>
              <h3 className="text-sm font-semibold uppercase text-emerald-200">Topic-wise summary</h3>
              <div className="mt-3 grid gap-3">
                {topicList(summary.topic_wise_summary).map((topic) => (
                  <article key={topic.topic} className="rounded-md border border-white/10 bg-slate-950/60 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h4 className="break-words font-semibold text-white">{topic.topic}</h4>
                      {summary.id ? (
                        <button
                          type="button"
                          onClick={() => void createNotes(topic.topic)}
                          disabled={notesLoading}
                          className="rounded-md border border-violet-300/25 bg-violet-300/10 px-2.5 py-1.5 text-xs font-semibold text-violet-100 transition hover:bg-violet-300/15 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label={`Create notes for ${topic.topic}`}
                        >
                          Create topic notes
                        </button>
                      ) : null}
                    </div>
                    {topic.explanation ? <p className="mt-2 text-sm leading-6 text-slate-300">{topic.explanation}</p> : null}
                    {topic.important_points.length ? (
                      <ul className="mt-3 grid list-disc gap-1 pl-4 text-sm leading-6 text-slate-400">
                        {topic.important_points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <SectionList title="Key points" items={stringList(summary.key_points)} />
          <SectionList title="Exam focus points" items={stringList(summary.exam_focus_points)} />
          <SectionList title="Memory lines" items={stringList(summary.memory_lines)} />
          <SectionList title="Common mistakes" items={stringList(summary.common_mistakes)} />
          <SectionList title="Action items" items={stringList(summary.action_items)} />
          <SectionList title="Important concepts" items={stringList(summary.important_concepts)} />

          {stringList(summary.suggested_tags).length ? (
            <section>
              <h3 className="text-sm font-semibold uppercase text-emerald-200">Suggested tags</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {stringList(summary.suggested_tags).map((tag) => (
                  <span key={tag} className="rounded-md border border-white/10 bg-slate-950/70 px-2 py-1 text-xs text-slate-300">
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {summary.suggested_next_step ? (
            <section className="rounded-lg border border-white/10 bg-slate-950/70 p-4">
              <h3 className="text-sm font-semibold uppercase text-emerald-200">Suggested next step</h3>
              <p className="mt-3 text-sm leading-6 text-slate-300">{summary.suggested_next_step}</p>
            </section>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void createNotes()}
              disabled={notesLoading}
              className="min-h-11 rounded-md border border-violet-300/30 bg-violet-300/10 px-3 py-2.5 text-center text-sm font-semibold leading-5 text-violet-100 transition hover:bg-violet-300/15 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="create-notes-from-summary"
            >
              {notesLoading ? "Creating Notes..." : "Create Notes"}
            </button>
            <button type="button" onClick={readAloud} className="min-h-11 rounded-md border border-white/15 bg-white/5 px-3 py-2.5 text-center text-sm font-semibold leading-5 text-white transition hover:bg-white/10">
              Read Aloud
            </button>
            <button type="button" onClick={goToQuiz} className="min-h-11 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-3 py-2.5 text-center text-sm font-semibold leading-5 text-emerald-100 transition hover:bg-emerald-300/15">
              Generate Quiz
            </button>
            <button type="button" onClick={goToRevisionPlan} className="min-h-11 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2.5 text-center text-sm font-semibold leading-5 text-cyan-100 transition hover:bg-cyan-300/15">
              Create Revision Plan
            </button>
          </div>
        </div>
      ) : null}

      {!summary && showStudyActions ? (
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={goToQuiz} className="min-h-11 rounded-md border border-emerald-300/30 bg-emerald-300/10 px-3 py-2.5 text-center text-sm font-semibold leading-5 text-emerald-100 transition hover:bg-emerald-300/15">
            Generate Quiz
          </button>
          <button type="button" onClick={goToRevisionPlan} className="min-h-11 rounded-md border border-cyan-300/30 bg-cyan-300/10 px-3 py-2.5 text-center text-sm font-semibold leading-5 text-cyan-100 transition hover:bg-cyan-300/15">
            Create Revision Plan
          </button>
        </div>
      ) : null}

      {noteDraft ? (
        <StudyNoteEditor
          key={noteDraft.id ?? noteDraft.metadata?.generated_at ?? "summary-note"}
          draft={noteDraft}
          onChange={setNoteDraft}
          onClose={() => setNoteDraft(null)}
          onSaved={() => router.refresh()}
          onDeleted={() => {
            setNoteDraft(null);
            router.refresh();
          }}
        />
      ) : null}
    </aside>
  );
}
