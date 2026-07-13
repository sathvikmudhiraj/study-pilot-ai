"use client";

import { useEffect, useRef, useState } from "react";
import {
  createStudyNote,
  deleteStudyNote,
  updateStudyNote,
  validateStudyNoteDraft,
  type StudyNoteDraft,
} from "@/frontend/lib/studyNotes";
import { exportStudyNote, type NoteExportFormat } from "@/frontend/lib/noteExport";
import { useFocusTrap } from "@/frontend/lib/useFocusTrap";
import { IconChevronDown, IconTrash, IconX } from "./icons";
import { SourceCitationChips } from "./SourceCitationChips";
import {
  buttonDanger,
  buttonGhost,
  buttonPrimary,
  buttonSecondary,
  inputClass,
  textareaClass,
} from "./ui";

export type StudyNoteSaveMode = "save" | "copy";

export type StudyNoteEditorProps = {
  draft: StudyNoteDraft;
  onChange: (draft: StudyNoteDraft) => void;
  onClose: () => void;
  onSaved?: (note: StudyNoteDraft, mode: StudyNoteSaveMode) => void;
  onDeleted?: (id: string) => void;
  /**
   * Renders the full editor inside its parent instead of as a modal overlay.
   * Useful when voice controls must remain reachable while a draft is open.
   */
  inline?: boolean;
};

type Operation = "save" | "copy" | "delete" | NoteExportFormat | null;

const downloadOptions: { format: NoteExportFormat; label: string }[] = [
  { format: "pdf", label: "PDF (.pdf)" },
  { format: "docx", label: "Word document (.docx)" },
  { format: "markdown", label: "Markdown (.md)" },
  { format: "txt", label: "Plain text (.txt)" },
];

function operationLabel(operation: Operation) {
  if (operation === "save") return "Saving note...";
  if (operation === "copy") return "Saving a copy...";
  if (operation === "delete") return "Deleting note...";
  if (operation) return `Preparing ${operation === "markdown" ? "Markdown" : operation.toUpperCase()}...`;
  return "";
}

export function StudyNoteEditor({
  draft,
  onChange,
  onClose,
  onSaved,
  onDeleted,
  inline = false,
}: StudyNoteEditorProps) {
  const [operation, setOperation] = useState<Operation>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const busy = operation !== null;

  // Trap keyboard focus inside the modal section while it is mounted as an
  // overlay (skipped for the inline variant used by voice/chat). The existing
  // Escape listener below this is intentionally kept; the trap's own Escape
  // handler is left as a no-op so we can preserve the `busy` guard there.
  useFocusTrap(sectionRef, !inline, undefined);

  useEffect(() => {
    if (inline) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [inline]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  function updateDraft(values: Partial<StudyNoteDraft>) {
    setError("");
    setSuccess("");
    onChange({ ...draft, ...values });
  }

  async function save(mode: StudyNoteSaveMode) {
    const validationError = validateStudyNoteDraft(draft);
    if (validationError) {
      setSuccess("");
      setError(validationError);
      return;
    }

    if (
      mode === "save" &&
      draft.id &&
      !window.confirm(
        "Save these changes to the existing note? This will overwrite its current title and content.",
      )
    ) {
      return;
    }

    setOperation(mode);
    setError("");
    setSuccess("");

    try {
      const saved =
        mode === "copy" || !draft.id
          ? await createStudyNote({
              ...draft,
              id: undefined,
              createdAt: undefined,
              updatedAt: undefined,
            })
          : await updateStudyNote(draft.id, draft);
      onChange(saved);
      setSuccess(mode === "copy" ? "A new copy was saved." : "Note saved successfully.");
      onSaved?.(saved, mode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the note.");
    } finally {
      setOperation(null);
    }
  }

  async function remove() {
    if (!draft.id || busy) return;
    if (
      !window.confirm(
        `Delete “${draft.title.trim() || "Untitled note"}”? This action cannot be undone.`,
      )
    ) {
      return;
    }

    setOperation("delete");
    setError("");
    setSuccess("");

    try {
      const deleted = await deleteStudyNote(draft.id);
      setSuccess("Note deleted.");
      onDeleted?.(deleted.id);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the note.");
    } finally {
      setOperation(null);
    }
  }

  async function download(format: NoteExportFormat) {
    if (busy) return;
    setDownloadOpen(false);
    setOperation(format);
    setError("");
    setSuccess("");

    try {
      const filename = await exportStudyNote(draft, format);
      setSuccess(`${filename} is ready.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not download the note.");
    } finally {
      setOperation(null);
    }
  }

  return (
    <div
      className={
        inline
          ? "min-w-0"
          : "fixed inset-0 z-[70] grid place-items-end bg-black/65 p-0 backdrop-blur-sm sm:place-items-center sm:p-4"
      }
      data-testid="study-note-editor-backdrop"
      data-variant={inline ? "inline" : "modal"}
      onMouseDown={(event) => {
        if (!inline && event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={sectionRef}
        tabIndex={-1}
        role={inline ? "region" : "dialog"}
        aria-modal={inline ? undefined : true}
        aria-labelledby="study-note-editor-title"
        aria-describedby="study-note-editor-description"
        className={`flex w-full min-w-0 flex-col overflow-hidden border border-white/10 bg-slate-950 shadow-2xl shadow-black/60 outline-none ${
          inline
            ? "rounded-xl"
            : "max-h-[94dvh] rounded-t-2xl sm:max-h-[90vh] sm:max-w-4xl sm:rounded-2xl"
        }`}
        data-testid="study-note-editor"
      >
        <header className="flex min-w-0 items-start justify-between gap-4 border-b border-white/10 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              {draft.id ? "Saved study note" : "Notes preview"}
            </p>
            <h2 id="study-note-editor-title" className="mt-1 text-lg font-bold text-white sm:text-xl">
              Preview, edit, save, and download
            </h2>
            <p id="study-note-editor-description" className="mt-1 text-xs leading-5 text-slate-400">
              Review the generated content before saving it to your StudyPilot workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close notes editor"
            className={`${buttonGhost} h-9 w-9 shrink-0 px-0`}
            data-testid="close-note-editor"
          >
            <IconX size={18} />
          </button>
        </header>

        <div
          className={`px-4 py-5 sm:px-6 ${inline ? "min-w-0" : "min-h-0 flex-1 overflow-y-auto"}`}
        >
          <div className="grid gap-5">
            {(draft.sourceLabel || draft.topic) ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {draft.sourceLabel ? (
                  <span className="inline-flex max-w-full rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-1 text-xs font-semibold text-cyan-100">
                    <span className="mr-1 text-slate-400">Source:</span>
                    <span className="truncate">{draft.sourceLabel}</span>
                  </span>
                ) : null}
                {draft.topic ? (
                  <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-semibold text-slate-300">
                    {draft.topic}
                  </span>
                ) : null}
              </div>
            ) : null}

            {draft.citations.length ? (
              <div className="rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] p-3">
                <SourceCitationChips citations={draft.citations} />
              </div>
            ) : null}

            <label className="grid gap-2 text-sm font-medium text-slate-200">
              Note title
              <input
                ref={titleRef}
                value={draft.title}
                onChange={(event) => updateDraft({ title: event.target.value })}
                disabled={busy}
                className={inputClass}
                placeholder="Study note title"
                aria-label="Note title"
                data-testid="note-title-input"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium text-slate-200">
              Note content
              <textarea
                value={draft.content}
                onChange={(event) => updateDraft({ content: event.target.value })}
                disabled={busy}
                className={`${textareaClass} resize-y font-[inherit] leading-7 ${
                  inline ? "min-h-72 sm:min-h-96" : "min-h-[44vh]"
                }`}
                placeholder="Review and edit your study notes..."
                aria-label="Note content"
                data-testid="note-content-input"
              />
              <span className="text-right text-xs font-normal text-slate-400">
                {draft.content.length.toLocaleString()} characters
              </span>
            </label>

            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-red-400/25 bg-red-400/10 p-3 text-sm leading-6 text-red-200"
                data-testid="note-editor-error"
              >
                {error}
              </div>
            ) : null}

            {success ? (
              <div
                role="status"
                className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm leading-6 text-emerald-100"
                data-testid="note-editor-success"
              >
                {success}
              </div>
            ) : null}

            {busy ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] p-3 text-sm text-cyan-100"
              >
                {operationLabel(operation)}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-col gap-3 border-t border-white/10 bg-slate-950/95 px-4 py-4 sm:px-6">
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className={`${buttonGhost} px-4`}
              >
                Cancel
              </button>
              {draft.id ? (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className={`${buttonDanger} px-4`}
                  aria-label="Delete saved note"
                  data-testid="delete-note-button"
                >
                  <IconTrash size={16} />
                  Delete
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setDownloadOpen((open) => !open)}
                  disabled={busy}
                  className={`${buttonSecondary} w-full px-4 sm:w-auto`}
                  aria-haspopup="menu"
                  aria-expanded={downloadOpen}
                  aria-controls="study-note-download-menu"
                  data-testid="note-download-menu-button"
                >
                  Download
                  <IconChevronDown size={15} />
                </button>
                {downloadOpen ? (
                  <div
                    id="study-note-download-menu"
                    role="menu"
                    className="absolute bottom-[calc(100%+0.5rem)] right-0 z-10 grid w-full min-w-56 gap-1 rounded-xl border border-white/10 bg-slate-900 p-2 shadow-2xl shadow-black/50 sm:w-64"
                    data-testid="note-download-menu"
                  >
                    {downloadOptions.map((option) => (
                      <button
                        key={option.format}
                        type="button"
                        role="menuitem"
                        onClick={() => download(option.format)}
                        className="focus-ring rounded-lg px-3 py-2.5 text-left text-sm font-medium text-slate-200 transition hover:bg-white/[0.08]"
                        data-testid={`download-note-${option.format}`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => save("copy")}
                disabled={busy}
                className={`${buttonSecondary} px-4`}
                data-testid="save-note-copy-button"
              >
                Save copy
              </button>
              <button
                type="button"
                onClick={() => save("save")}
                disabled={busy}
                className={`${buttonPrimary} px-5`}
                data-testid="save-note-button"
              >
                {draft.id ? "Save changes" : "Save note"}
              </button>
            </div>
          </div>
        </footer>
      </section>
    </div>
  );
}
