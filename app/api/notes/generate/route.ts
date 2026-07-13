import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import {
  generateStudyNoteDraft,
  STUDY_NOTE_LANGUAGES,
  STUDY_NOTE_SOURCE_TYPES,
  STUDY_NOTE_STYLES,
  StudyNoteGenerationError,
  type GroundedStudyNoteSource,
  type StudyNoteLanguage,
  type StudyNoteSourceType,
  type StudyNoteStyle,
} from "@/backend/lib/aiNotes";
import {
  getAiUserMessage,
  isAiBusyError,
  isAiQuotaError,
  isAiTimeoutError,
} from "@/backend/lib/aiProvider";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

type GenerateNotesBody = {
  sourceType?: unknown;
  summaryId?: unknown;
  answerId?: unknown;
  fileId?: unknown;
  noteId?: unknown;
  topic?: unknown;
  style?: unknown;
  language?: unknown;
};

type GenerateNotesInput = {
  sourceType: StudyNoteSourceType;
  summaryId?: string;
  answerId?: string;
  fileId?: string;
  noteId?: string;
  topic?: string;
  style: StudyNoteStyle;
  language: StudyNoteLanguage;
};

type Supabase = NonNullable<Awaited<ReturnType<typeof createServerSupabaseClient>>>;

type OwnedFile = {
  id: string;
  file_name: string;
  extracted_text: string;
};

type OwnedNote = {
  id: string;
  title: string;
  topic: string;
  raw_notes: string;
  content: string;
  file_id: string | null;
};

class NotesRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NotesRouteError";
    this.status = status;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUMMARY_SELECT = [
  "id",
  "user_id",
  "file_id",
  "note_id",
  "output_type",
  "content",
  "suggested_title",
  "short_summary",
  "module_overview",
  "covered_topics",
  "key_points",
  "topic_wise_summary",
  "exam_focus_points",
  "memory_lines",
  "common_mistakes",
  "important_concepts",
  "action_items",
  "suggested_next_step",
  "source_citations",
  "created_at",
].join(", ");

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[notes/generate] ${message}`, details ?? "");
}

function databaseFailure(action: string, error: unknown): never {
  devLog("database operation failed", {
    action,
    message:
      error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "Database request failed")
        : "Database request failed",
  });
  throw new NotesRouteError("Could not prepare notes from this source. Please try again.", 500);
}

function valueString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanTopic(value: unknown) {
  return valueString(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function optionalUuid(value: unknown, field: string) {
  const id = valueString(value);
  if (!id) return undefined;
  if (!UUID_PATTERN.test(id)) {
    throw new NotesRouteError(`${field} is invalid.`, 400);
  }
  return id;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  fallback?: T[number],
): T[number] {
  const normalized = valueString(value).toLowerCase();
  if (!normalized && fallback) return fallback;
  if ((allowed as readonly string[]).includes(normalized)) return normalized as T[number];
  throw new NotesRouteError(`${field} is invalid.`, 400);
}

function validateInput(body: GenerateNotesBody): GenerateNotesInput {
  const sourceType = enumValue(body.sourceType, STUDY_NOTE_SOURCE_TYPES, "sourceType");
  const style = enumValue(body.style, STUDY_NOTE_STYLES, "style", "standard");
  const language = enumValue(body.language, STUDY_NOTE_LANGUAGES, "language", "auto");
  const summaryId = optionalUuid(body.summaryId, "summaryId");
  const answerId = optionalUuid(body.answerId, "answerId");
  const fileId = optionalUuid(body.fileId, "fileId");
  const noteId = optionalUuid(body.noteId, "noteId");
  const topic = cleanTopic(body.topic);

  if (sourceType === "summary") {
    if (!summaryId && !fileId) {
      throw new NotesRouteError("Choose a saved summary first.", 400);
    }
    if (answerId || noteId) {
      throw new NotesRouteError("Summary notes must use one saved summary source.", 400);
    }
  }

  if (sourceType === "answer") {
    if (!answerId) throw new NotesRouteError("Ask StudyPilot a question first.", 400);
    if (summaryId || noteId) {
      throw new NotesRouteError("Answer notes must use one saved answer source.", 400);
    }
  }

  if (sourceType === "file") {
    if (!fileId) throw new NotesRouteError("Choose an uploaded file first.", 400);
    if (summaryId || answerId || noteId) {
      throw new NotesRouteError("File notes must use one uploaded file source.", 400);
    }
  }

  if (sourceType === "topic") {
    if (!topic) throw new NotesRouteError("Choose a topic first.", 400);
    const explicitSources = [summaryId, answerId, noteId].filter(Boolean);
    if (explicitSources.length > 1) {
      throw new NotesRouteError("Choose only one source for this topic.", 400);
    }
    if (!explicitSources.length && !fileId) {
      throw new NotesRouteError("Choose a file, summary, answer, or note for this topic.", 400);
    }
  } else if (topic) {
    throw new NotesRouteError("Use sourceType topic when generating notes for a selected topic.", 400);
  }

  return {
    sourceType,
    style,
    language,
    ...(summaryId ? { summaryId } : {}),
    ...(answerId ? { answerId } : {}),
    ...(fileId ? { fileId } : {}),
    ...(noteId ? { noteId } : {}),
    ...(topic ? { topic } : {}),
  };
}

async function findOwnedFile(supabase: Supabase, userId: string, fileId: string): Promise<OwnedFile | null> {
  const result = await supabase
    .from("files")
    .select("id, file_name, extracted_text")
    .eq("id", fileId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) databaseFailure("read-file", result.error);
  if (!result.data) return null;
  return {
    id: String(result.data.id),
    file_name: valueString(result.data.file_name) || "Study material",
    extracted_text: valueString(result.data.extracted_text),
  };
}

async function requireOwnedFile(supabase: Supabase, userId: string, fileId: string) {
  const file = await findOwnedFile(supabase, userId, fileId);
  if (!file) throw new NotesRouteError("File not found.", 404);
  return file;
}

async function findOwnedNote(supabase: Supabase, userId: string, noteId: string): Promise<OwnedNote | null> {
  const result = await supabase
    .from("notes")
    .select("id, title, topic, raw_notes, content, file_id")
    .eq("id", noteId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) databaseFailure("read-note", result.error);
  if (!result.data) return null;
  return {
    id: String(result.data.id),
    title: valueString(result.data.title) || "Study note",
    topic: valueString(result.data.topic),
    raw_notes: valueString(result.data.raw_notes),
    content: valueString(result.data.content),
    file_id: valueString(result.data.file_id) || null,
  };
}

async function requireOwnedNote(supabase: Supabase, userId: string, noteId: string) {
  const note = await findOwnedNote(supabase, userId, noteId);
  if (!note) throw new NotesRouteError("Note not found.", 404);
  return note;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => valueString(item)).filter(Boolean).slice(0, 40);
}

function parseJsonRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rowValue(row: Record<string, unknown>, content: Record<string, unknown> | null, key: string) {
  const direct = row[key];
  return direct === null || direct === undefined ? content?.[key] : direct;
}

function topicSummaryText(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const record = item as Record<string, unknown>;
      const topic = valueString(record.topic ?? record.title ?? record.name);
      const explanation = valueString(record.explanation ?? record.summary ?? record.description);
      const points = stringList(record.important_points ?? record.importantPoints ?? record.points);
      return [topic ? `Topic: ${topic}` : "", explanation, ...points].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .slice(0, 24);
}

function summaryToSourceText(row: Record<string, unknown>) {
  const content = parseJsonRecord(row.content);
  const title = valueString(rowValue(row, content, "suggested_title"));
  const shortSummary = valueString(rowValue(row, content, "short_summary"));
  const overview = valueString(rowValue(row, content, "module_overview"));
  const coveredTopics = stringList(rowValue(row, content, "covered_topics"));
  const keyPoints = stringList(rowValue(row, content, "key_points"));
  const topics = topicSummaryText(rowValue(row, content, "topic_wise_summary"));
  const examFocus = stringList(rowValue(row, content, "exam_focus_points"));
  const memoryLines = stringList(rowValue(row, content, "memory_lines"));
  const commonMistakes = stringList(rowValue(row, content, "common_mistakes"));
  const concepts = stringList(rowValue(row, content, "important_concepts"));
  const actions = stringList(rowValue(row, content, "action_items"));
  const nextStep = valueString(rowValue(row, content, "suggested_next_step"));

  return [
    title ? `Title: ${title}` : "",
    shortSummary ? `Short summary:\n${shortSummary}` : "",
    overview ? `Module overview:\n${overview}` : "",
    coveredTopics.length ? `Covered topics:\n${coveredTopics.join("\n")}` : "",
    keyPoints.length ? `Key points:\n${keyPoints.join("\n")}` : "",
    topics.length ? `Topic-wise summary:\n${topics.join("\n\n")}` : "",
    examFocus.length ? `Exam focus:\n${examFocus.join("\n")}` : "",
    memoryLines.length ? `Memory lines:\n${memoryLines.join("\n")}` : "",
    commonMistakes.length ? `Common mistakes:\n${commonMistakes.join("\n")}` : "",
    concepts.length ? `Important concepts:\n${concepts.join("\n")}` : "",
    actions.length ? `Study actions:\n${actions.join("\n")}` : "",
    nextStep ? `Suggested next step:\n${nextStep}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function summaryCitations(row: Record<string, unknown>) {
  const direct = row.source_citations;
  if (Array.isArray(direct) && direct.length) return direct;
  return parseJsonRecord(row.content)?.source_citations ?? [];
}

async function resolveSummarySource(
  supabase: Supabase,
  userId: string,
  input: GenerateNotesInput,
): Promise<Omit<GroundedStudyNoteSource, "sourceType" | "style" | "language" | "topic">> {
  let row: Record<string, unknown> | null = null;
  let requestedFile: OwnedFile | null = null;

  if (input.fileId) requestedFile = await requireOwnedFile(supabase, userId, input.fileId);

  if (input.summaryId) {
    const result = await supabase
      .from("ai_outputs")
      .select(SUMMARY_SELECT)
      .eq("id", input.summaryId)
      .eq("user_id", userId)
      .maybeSingle();
    if (result.error) databaseFailure("read-summary", result.error);
    row = result.data ? (result.data as unknown as Record<string, unknown>) : null;
  } else if (requestedFile) {
    const result = await supabase
      .from("ai_outputs")
      .select(SUMMARY_SELECT)
      .eq("file_id", requestedFile.id)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (result.error) databaseFailure("read-latest-summary", result.error);
    row = ((result.data ?? []) as unknown as Record<string, unknown>[]).find((item) => {
      const outputType = valueString(item.output_type);
      return !outputType || outputType === "summary";
    }) ?? null;
  }

  if (!row) throw new NotesRouteError("Saved summary not found.", 404);
  const outputType = valueString(row.output_type);
  if (outputType && outputType !== "summary") {
    throw new NotesRouteError("Saved summary not found.", 404);
  }

  const summaryFileId = valueString(row.file_id);
  if (requestedFile && summaryFileId !== requestedFile.id) {
    throw new NotesRouteError("This summary is not associated with the selected file.", 400);
  }

  const associatedFile = summaryFileId
    ? requestedFile?.id === summaryFileId
      ? requestedFile
      : await findOwnedFile(supabase, userId, summaryFileId)
    : null;
  const summaryNoteId = valueString(row.note_id);
  const associatedNote = !associatedFile && summaryNoteId
    ? await findOwnedNote(supabase, userId, summaryNoteId)
    : null;
  const sourceText = summaryToSourceText(row);
  if (!sourceText.trim()) {
    throw new NotesRouteError("This saved summary does not contain readable content.", 400);
  }

  return {
    sourceId: valueString(row.id),
    sourceLabel:
      associatedFile?.file_name ||
      associatedNote?.title ||
      valueString(row.suggested_title) ||
      "Saved summary",
    sourceText,
    fileId: associatedFile?.id ?? null,
    citationStrategy: "stored",
    storedCitations: summaryCitations(row),
  };
}

function answerToSourceText(question: unknown, answer: unknown) {
  const questionText = valueString(question);
  if (typeof answer === "string") {
    return [questionText ? `Question: ${questionText}` : "", answer.trim()].filter(Boolean).join("\n\n");
  }
  if (!answer || typeof answer !== "object") return "";

  const record = answer as Record<string, unknown>;
  return [
    questionText ? `Question: ${questionText}` : "",
    valueString(record.short_answer ?? record.shortAnswer),
    valueString(record.simple_explanation ?? record.simpleExplanation),
    ...stringList(record.step_by_step ?? record.stepByStep),
    valueString(record.example),
    valueString(record.memory_line ?? record.memoryLine),
    valueString(record.common_mistake ?? record.commonMistake),
    valueString(record.exam_viva_answer ?? record.examVivaAnswer),
    valueString(record.practice_question ?? record.practiceQuestion),
    ...stringList(record.related_files_notes ?? record.relatedFilesNotes),
    valueString(record.next_step ?? record.nextStep),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function answerCitations(answer: unknown) {
  if (!answer || typeof answer !== "object") return [];
  const record = answer as Record<string, unknown>;
  return record.source_citations ?? record.sourceCitations ?? [];
}

function uuidList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(valueString).filter((id) => UUID_PATTERN.test(id))),
  ).slice(0, 12);
}

async function ownedFilesByIds(supabase: Supabase, userId: string, fileIds: string[]) {
  if (!fileIds.length) return [];
  const result = await supabase
    .from("files")
    .select("id, file_name, extracted_text")
    .eq("user_id", userId)
    .in("id", fileIds);
  if (result.error) databaseFailure("read-answer-files", result.error);
  return (result.data ?? []).map((file) => ({
    id: String(file.id),
    file_name: valueString(file.file_name) || "Study material",
    extracted_text: valueString(file.extracted_text),
  }));
}

async function resolveAnswerSource(
  supabase: Supabase,
  userId: string,
  input: GenerateNotesInput,
): Promise<Omit<GroundedStudyNoteSource, "sourceType" | "style" | "language" | "topic">> {
  if (!input.answerId) throw new NotesRouteError("Ask StudyPilot a question first.", 400);
  const result = await supabase
    .from("assistant_questions")
    .select("id, question, answer, related_file_ids, related_note_ids")
    .eq("id", input.answerId)
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) databaseFailure("read-answer", result.error);
  if (!result.data) throw new NotesRouteError("Saved answer not found.", 404);

  const relatedFileIds = uuidList(result.data.related_file_ids);
  const ownedFiles = await ownedFilesByIds(supabase, userId, relatedFileIds);
  let associatedFile: OwnedFile | null = null;

  if (input.fileId) {
    const requestedFile = await requireOwnedFile(supabase, userId, input.fileId);
    if (!relatedFileIds.includes(requestedFile.id)) {
      throw new NotesRouteError("This answer is not associated with the selected file.", 400);
    }
    associatedFile = requestedFile;
  } else if (ownedFiles.length === 1) {
    associatedFile = ownedFiles[0];
  }

  const sourceText = answerToSourceText(result.data.question, result.data.answer);
  if (!sourceText.trim()) {
    throw new NotesRouteError("This saved answer does not contain readable content.", 400);
  }
  const questionLabel = valueString(result.data.question).slice(0, 100);

  return {
    sourceId: String(result.data.id),
    sourceLabel: associatedFile?.file_name || (questionLabel ? `StudyPilot answer: ${questionLabel}` : "StudyPilot answer"),
    sourceText,
    fileId: associatedFile?.id ?? null,
    citationStrategy: "stored",
    storedCitations: answerCitations(result.data.answer),
  };
}

async function resolveFileSource(
  supabase: Supabase,
  userId: string,
  fileId: string | undefined,
): Promise<Omit<GroundedStudyNoteSource, "sourceType" | "style" | "language" | "topic">> {
  if (!fileId) throw new NotesRouteError("Choose an uploaded file first.", 400);
  const file = await requireOwnedFile(supabase, userId, fileId);
  if (!file.extracted_text.trim()) {
    throw new NotesRouteError(
      "No readable extracted text is available for this file. Generate its summary or re-extract it first.",
      400,
    );
  }
  return {
    sourceId: file.id,
    sourceLabel: file.file_name,
    sourceText: file.extracted_text,
    fileId: file.id,
    citationStrategy: "derived",
    citationSourceType: "file",
  };
}

async function resolveNoteSource(
  supabase: Supabase,
  userId: string,
  input: GenerateNotesInput,
): Promise<Omit<GroundedStudyNoteSource, "sourceType" | "style" | "language" | "topic">> {
  if (!input.noteId) throw new NotesRouteError("Choose a saved note first.", 400);
  const note = await requireOwnedNote(supabase, userId, input.noteId);
  let associatedFile: OwnedFile | null = null;
  if (note.file_id) associatedFile = await findOwnedFile(supabase, userId, note.file_id);
  if (input.fileId) {
    const requestedFile = await requireOwnedFile(supabase, userId, input.fileId);
    if (note.file_id !== requestedFile.id) {
      throw new NotesRouteError("This note is not associated with the selected file.", 400);
    }
    associatedFile = requestedFile;
  }

  const sourceText = note.raw_notes || note.content;
  if (!sourceText.trim()) throw new NotesRouteError("This note does not contain readable content.", 400);
  return {
    sourceId: note.id,
    sourceLabel: note.title || note.topic || "Study note",
    sourceText,
    fileId: associatedFile?.id ?? null,
    citationStrategy: "derived",
    citationSourceType: "note",
  };
}

async function resolveSource(
  supabase: Supabase,
  userId: string,
  input: GenerateNotesInput,
): Promise<GroundedStudyNoteSource> {
  let resolved: Omit<GroundedStudyNoteSource, "sourceType" | "style" | "language" | "topic">;

  if (input.sourceType === "summary") {
    resolved = await resolveSummarySource(supabase, userId, input);
  } else if (input.sourceType === "answer") {
    resolved = await resolveAnswerSource(supabase, userId, input);
  } else if (input.sourceType === "file") {
    resolved = await resolveFileSource(supabase, userId, input.fileId);
  } else if (input.summaryId) {
    resolved = await resolveSummarySource(supabase, userId, input);
  } else if (input.answerId) {
    resolved = await resolveAnswerSource(supabase, userId, input);
  } else if (input.noteId) {
    resolved = await resolveNoteSource(supabase, userId, input);
  } else {
    resolved = await resolveFileSource(supabase, userId, input.fileId);
  }

  return {
    ...resolved,
    sourceType: input.sourceType,
    style: input.style,
    language: input.language,
    ...(input.topic ? { topic: input.topic } : {}),
  };
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("StudyPilot storage is not configured.", 500);

  let body: GenerateNotesBody;
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return apiError("Invalid request body.", 400);
    }
    body = value as GenerateNotesBody;
  } catch {
    return apiError("Invalid request body.", 400);
  }

  try {
    const input = validateInput(body);
    const source = await resolveSource(supabase, user.id, input);
    const draft = await generateStudyNoteDraft(source);
    return NextResponse.json({ draft });
  } catch (error) {
    if (error instanceof NotesRouteError) return apiError(error.message, error.status);
    if (error instanceof StudyNoteGenerationError) {
      const status = error.code === "empty_source" ? 400 : 422;
      return apiError(error.message, status);
    }

    const userMessage = getAiUserMessage(error);
    const busy = isAiBusyError(error) || isAiTimeoutError(error);
    const quota = isAiQuotaError(error);
    devLog("generation failed", {
      busy,
      quota,
      providerMessage: userMessage,
    });
    if (quota) return apiError(userMessage, 429);
    if (busy) return apiError(userMessage, 503);
    if (userMessage !== "AI request failed. Please try again.") {
      return apiError(userMessage, 500);
    }
    return apiError("Could not generate notes. Please try again.", 500);
  }
}
