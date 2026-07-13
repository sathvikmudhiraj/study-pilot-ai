"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/frontend/lib/supabase/browser";
import { isMissingSupabaseSchema } from "@/frontend/lib/supabase/errors";
import { Field, inputClass, textareaClass } from "./ui";
import { IconUpload, IconFileText, IconCheck } from "./icons";

const bucketName = "study-files";
const allowedExtensions = [".pdf", ".pptx", ".docx", ".txt", ".md", ".jpg", ".jpeg", ".png", ".webp", ".zip"];
const blockedExtensions = [".exe", ".bat", ".cmd", ".sh", ".js", ".ts", ".msi", ".dll"];
const extensionMimeTypes: Record<string, string> = {
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".zip": "application/zip",
};
const compatibleMimeTypes: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".pptx": ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain", "text/x-markdown"],
  ".jpg": ["image/jpeg", "image/pjpeg"],
  ".jpeg": ["image/jpeg", "image/pjpeg"],
  ".png": ["image/png"],
  ".webp": ["image/webp"],
  ".zip": ["application/zip", "application/x-zip-compressed"],
};
const acceptTypes = [
  ".pdf",
  ".pptx",
  ".docx",
  ".txt",
  ".md",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".zip",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/zip",
].join(",");

function cleanStorageName(name: string) {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);
}

function friendlyError(message: string) {
  const lower = message.toLowerCase();
  if (lower.includes("bucket") || lower.includes("not found")) {
    return "Storage bucket missing. Create the study-files bucket and run the storage policies.";
  }
  if (isMissingSupabaseSchema(message)) {
    return "Supabase database tables are missing. Run supabase/schema.sql in the Supabase SQL Editor, then try again.";
  }
  if (lower.includes("payload") || lower.includes("too large") || lower.includes("exceeded")) {
    return "Upload failed because the file exceeds a browser or Supabase limit for this project.";
  }
  if (lower.includes("row-level security") || lower.includes("policy")) {
    return "Upload failed because storage or database policies are not configured for this user.";
  }
  return message || "Upload failed. Please try again.";
}

function isMissingColumnError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("column") || lower.includes("schema cache") || lower.includes("could not find");
}

function extensionOf(name: string) {
  const lower = name.toLowerCase();
  const index = lower.lastIndexOf(".");
  return index === -1 ? "" : lower.slice(index);
}

function normalizeMimeType(mimeType: string) {
  return mimeType.split(";")[0].trim().toLowerCase();
}

function detectContentType(name: string, mimeType: string) {
  const ext = extensionOf(name);
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (ext === ".pdf" || normalizedMimeType === "application/pdf") return "pdf";
  if (ext === ".pptx" || normalizedMimeType.includes("presentationml")) return "pptx";
  if (ext === ".docx" || normalizedMimeType.includes("wordprocessingml")) return "docx";
  if (ext === ".txt" || ext === ".md" || normalizedMimeType.startsWith("text/")) return "text";
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext) || normalizedMimeType.startsWith("image/")) return "image";
  if (ext === ".zip" || normalizedMimeType.includes("zip")) return "zip";
  return "unknown";
}

function inferMimeType(name: string, mimeType: string) {
  const ext = extensionOf(name);
  return extensionMimeTypes[ext] ?? (normalizeMimeType(mimeType) || "application/octet-stream");
}

function validateStudyFile(file: File) {
  const ext = extensionOf(file.name);
  const normalizedMimeType = normalizeMimeType(file.type);
  if (blockedExtensions.includes(ext)) return "Unsupported file type.";
  if (!allowedExtensions.includes(ext)) return "Unsupported file type.";
  if (
    normalizedMimeType &&
    normalizedMimeType !== "application/octet-stream" &&
    !compatibleMimeTypes[ext]?.includes(normalizedMimeType)
  ) {
    return "File type does not match the selected study format.";
  }
  return "";
}

export function UploadWorkspace() {
  const router = useRouter();
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [rawNotes, setRawNotes] = useState("");
  const [keyLink, setKeyLink] = useState("");
  const [noteDate, setNoteDate] = useState("");
  const [importance, setImportance] = useState("");

  async function uploadPdf(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!pdfFile) {
      setError("Choose a study file first.");
      return;
    }

    const validationError = validateStudyFile(pdfFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setProgress(8);

    try {
      const supabase = createBrowserSupabaseClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("Not authenticated. Please log in again.");

      const storagePath = `${user.id}/${Date.now()}-${cleanStorageName(pdfFile.name)}`;
      const safeMimeType = inferMimeType(pdfFile.name, pdfFile.type);
      const safeContentType = detectContentType(pdfFile.name, safeMimeType);
      setProgress(25);

      const upload = await supabase.storage.from(bucketName).upload(storagePath, pdfFile, {
        contentType: safeMimeType,
        upsert: false,
      });

      if (upload.error) throw upload.error;
      setProgress(72);

      const fullPayload = {
        user_id: user.id,
        file_name: pdfFile.name,
        original_file_name: pdfFile.name,
        file_type: safeContentType,
        content_type: safeContentType,
        mime_type: safeMimeType,
        file_size: pdfFile.size,
        storage_path: storagePath,
        processing_status: "uploaded",
        status: "uploaded",
        chunks_count: 0,
        processing_notes: [],
        extracted_metadata: {},
      };

      const legacyPayload = {
        user_id: user.id,
        file_name: pdfFile.name,
        file_type: safeContentType,
        mime_type: safeMimeType,
        file_size: pdfFile.size,
        storage_path: storagePath,
        processing_status: "uploaded",
        status: "uploaded",
        chunks_count: 0,
      };

      let insert = await supabase.from("files").insert(fullPayload);

      if (insert.error && isMissingColumnError(insert.error.message)) {
        insert = await supabase.from("files").insert(legacyPayload);
      }

      if (insert.error) throw insert.error;

      setProgress(100);
      setPdfFile(null);
      setMessage("Study material uploaded successfully.");
      router.refresh();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "Upload failed."));
    } finally {
      setBusy(false);
    }
  }

  async function saveManualNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!noteTitle.trim() || !rawNotes.trim()) {
      setError("Title and notes are required.");
      return;
    }

    setBusy(true);
    setProgress(20);

    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: noteTitle.trim(),
          content: rawNotes.trim(),
          sourceType: "manual",
          topic: topic.trim(),
          keyLink: keyLink.trim() || null,
          noteDate: noteDate || null,
          importance: importance || null,
        }),
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error || "Could not save manual notes.");

      setProgress(100);
      setNoteTitle("");
      setTopic("");
      setRawNotes("");
      setKeyLink("");
      setNoteDate("");
      setImportance("");
      setMessage("Manual notes saved successfully.");
      router.refresh();
    } catch (err) {
      setError(friendlyError(err instanceof Error ? err.message : "Could not save manual notes."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
      {/* ─── Upload study material ─────────────────────────────────────── */}
      <form onSubmit={uploadPdf} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 sm:p-6 animate-fade-in-up">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-emerald-400/15 bg-emerald-400/10">
            <IconUpload size={18} className="text-emerald-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Upload study material</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Store PDFs, slides, documents, text notes, images, and ZIP study packs securely in Supabase Storage under your account.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Field label="Study file">
            <label className="group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-white/10 bg-slate-950/50 p-8 text-center transition-all duration-200 hover:border-emerald-400/30 hover:bg-slate-950/70">
              <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition group-hover:border-emerald-400/20 group-hover:text-emerald-300">
                <IconUpload size={22} />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">Click to choose a file</p>
                <p className="mt-1 text-xs text-slate-500">PDF, PPTX, DOCX, TXT, MD, JPG, PNG, WEBP, or ZIP</p>
              </div>
              <input
                type="file"
                accept={acceptTypes}
                onChange={(event) => setPdfFile(event.target.files?.[0] ?? null)}
                className="hidden"
              />
            </label>
          </Field>
        </div>

        {pdfFile ? (
          <div className="mt-4 min-w-0 rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] p-4 text-sm text-slate-200 animate-scale-in">
            <div className="flex items-center gap-2">
              <IconFileText size={16} className="shrink-0 text-emerald-300" />
              <span className="min-w-0 break-words font-medium text-white">{pdfFile.name}</span>
            </div>
            <div className="mt-2 text-xs text-slate-400">{(pdfFile.size / (1024 * 1024)).toFixed(2)} MB</div>
          </div>
        ) : null}

        <button
          disabled={busy}
          className="mt-6 h-11 rounded-lg bg-emerald-400 px-5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-300 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
        >
          {busy ? "Working..." : "Upload file"}
        </button>
      </form>

      {/* ─── Manual notes ─────────────────────────────────────────────── */}
      <form onSubmit={saveManualNote} className="min-w-0 rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 sm:p-6 animate-fade-in-up" style={{ animationDelay: "60ms" }}>
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-cyan-400/15 bg-cyan-400/10">
            <IconFileText size={18} className="text-cyan-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Add manual notes</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">Save typed notes directly to your Supabase database.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <Field label="Title">
            <input className={inputClass} value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="Thermodynamics chapter 2" />
          </Field>
          <Field label="Topic">
            <input className={inputClass} value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="Physics" />
          </Field>
          <Field label="Key link">
            <input className={inputClass} value={keyLink} onChange={(event) => setKeyLink(event.target.value)} placeholder="https://..." />
          </Field>
          <Field label="Note date">
            <input className={inputClass} type="date" value={noteDate} onChange={(event) => setNoteDate(event.target.value)} />
          </Field>
          <Field label="Importance">
            <select className={inputClass} value={importance} onChange={(event) => setImportance(event.target.value)}>
              <option value="">Not set</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <textarea className={textareaClass} value={rawNotes} onChange={(event) => setRawNotes(event.target.value)} placeholder="Paste or type your study notes..." />
            </Field>
          </div>
        </div>

        <button
          disabled={busy}
          className="mt-6 h-11 rounded-lg bg-emerald-400 px-5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-300 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
        >
          {busy ? "Saving..." : "Save manual notes"}
        </button>
      </form>

      {/* ─── Status / progress ────────────────────────────────────────── */}
      {(busy || message || error) ? (
        <div className="xl:col-span-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4 animate-fade-in">
            {busy ? (
              <div>
                <div className="mb-2 flex justify-between text-sm text-slate-300">
                  <span>Progress</span>
                  <span className="font-semibold text-emerald-200">{progress}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all duration-500 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            ) : null}
            {message ? (
              <p className="flex items-center gap-2 text-sm text-emerald-200">
                <IconCheck size={16} className="shrink-0" />
                {message}
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
