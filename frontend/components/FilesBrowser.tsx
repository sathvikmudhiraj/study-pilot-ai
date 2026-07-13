"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { EmptyState, Badge } from "./ui";
import { IconSearch, IconFiles, IconFileText } from "./icons";
import { StudyNoteEditor } from "./StudyNoteEditor";
import { adaptStudyNoteRow, type StudyNoteDraft } from "@/frontend/lib/studyNotes";

type FileItem = {
  id: string;
  file_name: string;
  file_type: string | null;
  mime_type: string | null;
  file_size: number | null;
  processing_status: string | null;
  status: string | null;
  created_at: string;
};

type NoteItem = {
  id: string;
  title: string | null;
  topic: string | null;
  raw_notes: string | null;
  content: string | null;
  importance: string | null;
  source_type: string | null;
  metadata: unknown;
  file_id: string | null;
  key_link: string | null;
  note_date: string | null;
  created_at: string;
  updated_at: string;
};

function formatSize(bytes: number | null) {
  if (!bytes) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

const selectClass =
  "h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/60 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]";

const searchClass =
  "h-11 min-w-0 w-full rounded-lg border border-white/10 bg-slate-950/70 pl-10 pr-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-emerald-300/60 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]";

export function FilesBrowser({ files, notes }: { files: FileItem[]; notes: NoteItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [importance, setImportance] = useState("all");
  const [savedNotes, setSavedNotes] = useState<StudyNoteDraft[]>(() => {
    const fileNames = new Map(files.map((file) => [file.id, file.file_name]));
    return notes.map((note) => {
      const draft = adaptStudyNoteRow(note);
      if (!draft.sourceLabel && draft.fileId) {
        return { ...draft, sourceLabel: fileNames.get(draft.fileId) ?? "Uploaded study file" };
      }
      return draft;
    });
  });
  const [selectedNote, setSelectedNote] = useState<StudyNoteDraft | null>(null);

  const filteredFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((file) => {
      const matchesKind = kind === "all" || kind === "files";
      const matchesStatus = status === "all" || (file.processing_status ?? file.status ?? "").toLowerCase() === status;
      const matchesQuery = !q || file.file_name.toLowerCase().includes(q);
      return matchesKind && matchesStatus && matchesQuery;
    });
  }, [files, query, kind, status]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return savedNotes.filter((note) => {
      const haystack = `${note.title} ${note.topic ?? ""} ${note.content} ${note.sourceLabel ?? ""}`.toLowerCase();
      const matchesKind = kind === "all" || kind === "notes";
      const matchesImportance = importance === "all" || (note.importance ?? "").toLowerCase() === importance;
      const matchesQuery = !q || haystack.includes(q);
      return matchesKind && matchesImportance && matchesQuery;
    });
  }, [savedNotes, query, kind, importance]);

  function handleSavedNote(note: StudyNoteDraft) {
    setSavedNotes((current) => {
      const exists = current.some((item) => item.id === note.id);
      return exists
        ? current.map((item) => (item.id === note.id ? note : item))
        : [note, ...current];
    });
    setSelectedNote(note);
    router.refresh();
  }

  function handleDeletedNote(id: string) {
    setSavedNotes((current) => current.filter((note) => note.id !== id));
    setSelectedNote(null);
    router.refresh();
  }

  const empty = !filteredFiles.length && !filteredNotes.length;

  return (
    <div className="grid min-w-0 gap-6">
      {/* Search + filters */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 animate-fade-in">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_160px_180px_180px]">
          <div className="relative">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search files, titles, topics..."
              className={searchClass}
              aria-label="Search study material"
            />
          </div>
          <select value={kind} onChange={(event) => setKind(event.target.value)} className={selectClass} aria-label="Filter by kind">
            <option value="all">All items</option>
            <option value="files">Files only</option>
            <option value="notes">Notes only</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={selectClass} aria-label="Filter by status">
            <option value="all">All file status</option>
            <option value="uploaded">Uploaded</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
          <select value={importance} onChange={(event) => setImportance(event.target.value)} className={selectClass} aria-label="Filter by importance">
            <option value="all">All importance</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {empty ? (
        <EmptyState
          title="No study material found"
          description="Upload a study file or add manual notes to start building your workspace."
          icon={<IconFiles size={22} />}
          action={<Link href="/upload" className="inline-flex h-10 items-center rounded-lg bg-emerald-400 px-4 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300">Add study material</Link>}
        />
      ) : null}

      {/* Files grid */}
      {filteredFiles.length ? (
        <section className="animate-fade-in">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <IconFiles size={18} className="text-slate-400" />
              Study files
            </h2>
            <span className="text-sm text-slate-500">{filteredFiles.length} found</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 stagger-children">
            {filteredFiles.map((file) => (
              <Link
                key={file.id}
                href={`/files/${file.id}`}
                className="group min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 transition-all duration-200 hover:border-emerald-400/20 hover:bg-white/[0.06] hover:-translate-y-[1px] animate-fade-in-up"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-emerald-300">
                    <IconFiles size={18} />
                  </div>
                  <Badge variant={file.processing_status === "uploaded" ? "emerald" : "amber"} className="shrink-0">
                    {file.processing_status ?? file.status ?? "uploaded"}
                  </Badge>
                </div>
                <h3 className="mt-4 line-clamp-2 font-semibold text-white text-sm">{file.file_name}</h3>
                <p className="mt-1 text-xs font-semibold uppercase text-slate-500">{file.file_type ?? file.mime_type ?? "Study file"}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm border-t border-white/[0.06] pt-4">
                  <div>
                    <div className="text-xs uppercase text-slate-500">Size</div>
                    <div className="mt-1 text-slate-200">{formatSize(file.file_size)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase text-slate-500">Uploaded</div>
                    <div className="mt-1 text-slate-200">{new Date(file.created_at).toLocaleDateString()}</div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {/* Notes grid */}
      {filteredNotes.length ? (
        <section className="animate-fade-in">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
              <IconFileText size={18} className="text-slate-400" />
              Saved notes
            </h2>
            <span className="text-sm text-slate-500">{filteredNotes.length} found</span>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 stagger-children">
            {filteredNotes.map((note) => (
              <article key={note.id} className="group min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 transition-all duration-200 hover:border-white/[0.15] hover:bg-white/[0.06] animate-fade-in-up">
                <div className="flex items-start justify-between gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-cyan-300">
                    <IconFileText size={18} />
                  </div>
                  {note.importance ? (
                    <Badge
                      variant={note.importance === "high" ? "amber" : note.importance === "medium" ? "cyan" : "default"}
                      className="shrink-0 capitalize"
                    >
                      {note.importance}
                    </Badge>
                  ) : null}
                </div>
                <h3 className="mt-4 line-clamp-2 font-semibold text-white text-sm">{note.title || "Untitled note"}</h3>
                <p className="mt-1 text-xs font-semibold uppercase text-slate-500">{note.topic || (note.sourceType === "manual" ? "Manual note" : "AI study note")}</p>
                <p className="mt-3 line-clamp-3 whitespace-pre-line text-sm leading-6 text-slate-400">{note.content}</p>
                {note.sourceLabel ? <p className="mt-3 line-clamp-1 text-xs text-cyan-200">Source: {note.sourceLabel}</p> : null}
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
                  <span className="text-xs text-slate-500">{note.createdAt ? new Date(note.createdAt).toLocaleDateString() : "Saved note"}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedNote(note)}
                    className="rounded-md border border-cyan-300/25 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
                    aria-label={`Open ${note.title || "Untitled note"}`}
                    data-testid={`open-note-${note.id ?? "draft"}`}
                  >
                    Open note
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {selectedNote ? (
        <StudyNoteEditor
          key={selectedNote.id ?? selectedNote.metadata?.generated_at ?? "new-note"}
          draft={selectedNote}
          onChange={setSelectedNote}
          onClose={() => setSelectedNote(null)}
          onSaved={handleSavedNote}
          onDeleted={handleDeletedNote}
        />
      ) : null}
    </div>
  );
}
