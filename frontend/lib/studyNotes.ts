import {
  normalizeSourceCitations,
  type SourceCitationValue,
} from "@/frontend/components/SourceCitationChips";

export const MAX_STUDY_NOTE_TITLE_LENGTH = 200;
export const MAX_STUDY_NOTE_CONTENT_LENGTH = 250_000;

export type StudyNoteSource = {
  id?: string;
  type?: string;
  label?: string;
};

export type StudyNoteMetadata = {
  source?: StudyNoteSource;
  source_citations?: SourceCitationValue[];
  language?: string;
  note_style?: string;
  generated_at?: string;
};

export type StudyNoteDraft = {
  id?: string;
  title: string;
  content: string;
  topic?: string;
  sourceType: string;
  fileId?: string | null;
  sourceLabel?: string;
  citations: SourceCitationValue[];
  metadata?: StudyNoteMetadata;
  keyLink?: string;
  noteDate?: string;
  importance?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type StudyNoteRow = {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  raw_notes?: unknown;
  rawNotes?: unknown;
  topic?: unknown;
  source_type?: unknown;
  sourceType?: unknown;
  file_id?: unknown;
  fileId?: unknown;
  source_label?: unknown;
  sourceLabel?: unknown;
  source_citations?: unknown;
  sourceCitations?: unknown;
  citations?: unknown;
  metadata?: unknown;
  key_link?: unknown;
  keyLink?: unknown;
  note_date?: unknown;
  noteDate?: unknown;
  importance?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  updated_at?: unknown;
  updatedAt?: unknown;
};

export type StudyNotePayload = {
  title: string;
  content: string;
  topic?: string;
  sourceType: string;
  fileId?: string;
  metadata: StudyNoteMetadata;
  keyLink?: string;
  noteDate?: string;
  importance?: string;
};

type RequestOptions = {
  signal?: AbortSignal;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function cleanOptional(value: unknown, maxLength = 500): string | undefined {
  const clean = stringValue(value).trim();
  return clean ? clean.slice(0, maxLength) : undefined;
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
  maxLength = 500,
): string | undefined {
  for (const key of keys) {
    const value = cleanOptional(record[key], maxLength);
    if (value) return value;
  }
  return undefined;
}

export function normalizeStudyNoteMetadata(value: unknown): StudyNoteMetadata {
  const record = recordValue(value) ?? {};
  const nestedSource = recordValue(record.source) ?? {};
  const source: StudyNoteSource = {
    id:
      firstString(nestedSource, ["id", "source_id", "sourceId"]) ??
      firstString(record, ["source_id", "sourceId"]),
    type:
      firstString(nestedSource, ["type", "source_type", "sourceType"]) ??
      firstString(record, ["source_type", "sourceType"]),
    label:
      firstString(nestedSource, ["label", "name", "source_name", "sourceName"]) ??
      firstString(record, ["source_label", "sourceLabel", "source_name", "sourceName"]),
  };
  const citations = normalizeSourceCitations(
    record.source_citations ?? record.sourceCitations ?? record.citations,
  );
  const language = firstString(record, ["language", "note_language", "noteLanguage"], 200);
  const noteStyle = firstString(
    record,
    ["note_style", "noteStyle", "style", "generation_style", "generationStyle"],
    200,
  );
  const generatedAt = firstString(record, ["generated_at", "generatedAt"], 100);
  const metadata: StudyNoteMetadata = {};

  if (source.id || source.type || source.label) metadata.source = source;
  if (citations.length) metadata.source_citations = citations;
  if (language) metadata.language = language;
  if (noteStyle) metadata.note_style = noteStyle;
  if (generatedAt) metadata.generated_at = generatedAt;
  return metadata;
}

export function createStudyNoteDraft(
  values: Partial<StudyNoteDraft> = {},
): StudyNoteDraft {
  const metadata = normalizeStudyNoteMetadata(values.metadata);
  const citations = normalizeSourceCitations(
    values.citations?.length ? values.citations : metadata.source_citations,
  );

  return {
    ...values,
    title: values.title ?? "",
    content: values.content ?? "",
    sourceType: values.sourceType?.trim() || metadata.source?.type || "manual",
    sourceLabel: values.sourceLabel?.trim() || metadata.source?.label,
    citations,
    metadata: mergeApprovedMetadata({
      metadata,
      citations,
      sourceType: values.sourceType,
      sourceLabel: values.sourceLabel,
      sourceId: metadata.source?.id ?? values.fileId ?? undefined,
    }),
  };
}

export function adaptStudyNoteRow(value: unknown): StudyNoteDraft {
  const row = (recordValue(value) ?? {}) as StudyNoteRow;
  const metadata = normalizeStudyNoteMetadata(row.metadata);
  const sourceType =
    cleanOptional(row.source_type ?? row.sourceType, 100) ??
    metadata.source?.type ??
    "manual";
  const fileId = cleanOptional(row.file_id ?? row.fileId, 200) ?? null;
  const citations = normalizeSourceCitations(
    row.source_citations ?? row.sourceCitations ?? row.citations ?? metadata.source_citations,
  );
  const sourceLabel =
    cleanOptional(row.source_label ?? row.sourceLabel, 500) ?? metadata.source?.label;

  return {
    id: cleanOptional(row.id, 200),
    title: stringValue(row.title).trim() || "Untitled note",
    content: stringValue(row.content ?? row.raw_notes ?? row.rawNotes),
    topic: cleanOptional(row.topic, 500),
    sourceType,
    fileId,
    sourceLabel,
    citations,
    metadata: mergeApprovedMetadata({
      metadata,
      citations,
      sourceType,
      sourceLabel,
      sourceId: metadata.source?.id ?? fileId ?? undefined,
    }),
    keyLink: cleanOptional(row.key_link ?? row.keyLink, 2_000),
    noteDate: cleanOptional(row.note_date ?? row.noteDate, 100),
    importance: cleanOptional(row.importance, 100),
    createdAt: cleanOptional(row.created_at ?? row.createdAt, 100),
    updatedAt: cleanOptional(row.updated_at ?? row.updatedAt, 100),
  };
}

// A descriptive alias for callers that prefer the longer adapter name.
export const studyNoteDraftFromRow = adaptStudyNoteRow;

function mergeApprovedMetadata({
  metadata,
  citations,
  sourceType,
  sourceLabel,
  sourceId,
}: {
  metadata: StudyNoteMetadata | undefined;
  citations: SourceCitationValue[];
  sourceType?: string;
  sourceLabel?: string;
  sourceId?: string;
}): StudyNoteMetadata {
  const normalized = normalizeStudyNoteMetadata(metadata);
  const source: StudyNoteSource = {
    id: cleanOptional(sourceId, 200) ?? normalized.source?.id,
    type: cleanOptional(sourceType, 100) ?? normalized.source?.type,
    label: cleanOptional(sourceLabel, 500) ?? normalized.source?.label,
  };
  const merged: StudyNoteMetadata = {};

  if (source.id || source.type || source.label) merged.source = source;
  const verifiedCitations = normalizeSourceCitations(
    citations.length ? citations : normalized.source_citations,
  );
  if (verifiedCitations.length) merged.source_citations = verifiedCitations;
  if (normalized.language) merged.language = normalized.language;
  if (normalized.note_style) merged.note_style = normalized.note_style;
  if (normalized.generated_at) merged.generated_at = normalized.generated_at;
  return merged;
}

export function validateStudyNoteDraft(draft: StudyNoteDraft): string | null {
  const title = draft.title.trim();
  const content = draft.content.trim();

  if (!title) return "Add a title before saving the note.";
  if (!content) return "Add note content before saving.";
  if (title.length > MAX_STUDY_NOTE_TITLE_LENGTH) {
    return `Keep the title under ${MAX_STUDY_NOTE_TITLE_LENGTH} characters.`;
  }
  if (content.length > MAX_STUDY_NOTE_CONTENT_LENGTH) {
    return `Keep note content under ${MAX_STUDY_NOTE_CONTENT_LENGTH.toLocaleString()} characters.`;
  }
  return null;
}

export function toStudyNotePayload(draft: StudyNoteDraft): StudyNotePayload {
  const validationError = validateStudyNoteDraft(draft);
  if (validationError) throw new Error(validationError);

  const title = draft.title.trim();
  const content = draft.content.trim();
  const sourceType = draft.sourceType.trim() || "manual";
  const fileId = cleanOptional(draft.fileId, 200);
  const metadata = mergeApprovedMetadata({
    metadata: draft.metadata,
    citations: normalizeSourceCitations(draft.citations),
    sourceType,
    sourceLabel: draft.sourceLabel,
    sourceId: draft.metadata?.source?.id ?? fileId,
  });

  return {
    title,
    content,
    topic: cleanOptional(draft.topic, 200),
    sourceType,
    fileId,
    metadata,
    keyLink: cleanOptional(draft.keyLink, 2_000),
    noteDate: cleanOptional(draft.noteDate, 100),
    importance: cleanOptional(draft.importance, 100),
  };
}

async function readResponsePayload(response: Response): Promise<Record<string, unknown>> {
  try {
    const payload = await response.json();
    return recordValue(payload) ?? {};
  } catch {
    return {};
  }
}

function responseError(payload: Record<string, unknown>, fallback: string): Error {
  const message = typeof payload.error === "string" ? payload.error.trim() : "";
  return new Error(message || fallback);
}

async function requestNote(
  url: string,
  method: "POST" | "PATCH",
  draft: StudyNoteDraft,
  options: RequestOptions = {},
): Promise<StudyNoteDraft> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toStudyNotePayload(draft)),
    signal: options.signal,
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    throw responseError(
      payload,
      method === "POST" ? "Could not save the note." : "Could not update the note.",
    );
  }

  const note = recordValue(payload.note);
  if (!note) throw new Error("The note was saved, but the server returned an invalid response.");
  return adaptStudyNoteRow(note);
}

export function createStudyNote(
  draft: StudyNoteDraft,
  options?: RequestOptions,
): Promise<StudyNoteDraft> {
  return requestNote("/api/notes", "POST", draft, options);
}

export function updateStudyNote(
  id: string,
  draft: StudyNoteDraft,
  options?: RequestOptions,
): Promise<StudyNoteDraft> {
  const noteId = id.trim();
  if (!noteId) return Promise.reject(new Error("A saved note is required before updating."));
  return requestNote(`/api/notes/${encodeURIComponent(noteId)}`, "PATCH", draft, options);
}

export async function deleteStudyNote(
  id: string,
  options: RequestOptions = {},
): Promise<{ deleted: true; id: string }> {
  const noteId = id.trim();
  if (!noteId) throw new Error("A saved note is required before deleting.");

  const response = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    cache: "no-store",
    signal: options.signal,
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) throw responseError(payload, "Could not delete the note.");
  return {
    deleted: true,
    id: cleanOptional(payload.id, 200) ?? noteId,
  };
}
