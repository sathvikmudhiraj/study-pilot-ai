import type { NoteFile } from "./types";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_TYPES = ["text/plain", "text/markdown", "text/x-markdown", "application/pdf"];

export function validateUpload(file: File) {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return "Only TXT, MD, and PDF notes are supported.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return "File is too large. Upload notes up to 5MB.";
  }
  return null;
}

export async function extractText(file: File) {
  if (file.type.startsWith("text/")) {
    return file.text();
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const raw = buffer.toString("latin1");
  const matches = raw.match(/\(([^()]{3,})\)\s*Tj/g) ?? [];
  const extracted = matches
    .map((match) => match.replace(/\)\s*Tj$/, "").slice(1))
    .join(" ")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .trim();

  return extracted || `File uploaded: ${file.name}. Text extraction was limited for this file, so add text notes for best AI answers.`;
}

export function userNotesContext(files: NoteFile[]) {
  if (!files.length) return "The student has not uploaded notes yet.";
  return files
    .map((file) => `FILE: ${file.filename}\n${file.text.slice(0, 6000)}`)
    .join("\n\n---\n\n")
    .slice(0, 18000);
}
