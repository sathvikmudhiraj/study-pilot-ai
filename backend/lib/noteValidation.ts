import type { SourceCitation } from "./sourceCitations";

export const MAX_NOTE_TITLE_CHARS = 200;
export const MAX_NOTE_CONTENT_CHARS = 250_000;

const MAX_TOPIC_CHARS = 200;
const MAX_SOURCE_TYPE_CHARS = 64;
const MAX_KEY_LINK_CHARS = 2_048;
const MAX_SOURCE_LABEL_CHARS = 300;
const MAX_SOURCE_ID_CHARS = 160;
const MAX_CITATION_ID_CHARS = 160;
const MAX_LANGUAGE_CHARS = 64;
const MAX_STYLE_CHARS = 64;
const MAX_CITATIONS = 12;
const MAX_LOCATOR = 1_000_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_TYPE_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

type NoteImportance = "low" | "medium" | "high";

export type SanitizedNoteMetadata = {
  source?: {
    type: string;
    label: string;
    id?: string;
  };
  source_citations?: SourceCitation[];
  language?: string;
  note_style?: string;
  generated_at?: string;
};

export type NoteWriteValues = {
  title?: string;
  content?: string;
  topic?: string;
  sourceType?: string;
  keyLink?: string | null;
  noteDate?: string | null;
  importance?: NoteImportance | null;
  fileId?: string | null;
  metadata?: SanitizedNoteMetadata;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstDefined(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function optionalTrimmedString(
  value: unknown,
  label: string,
  maxLength: number,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
): ValidationResult<string> {
  if ((value === undefined || value === null) && !allowEmpty) {
    return { ok: false, error: `${label} is required.` };
  }
  if (typeof value !== "string") {
    return { ok: false, error: `${label} must be text.` };
  }

  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) {
    return { ok: false, error: `${label} is required.` };
  }
  if (trimmed.length > maxLength) {
    return { ok: false, error: `${label} must be ${maxLength.toLocaleString("en-US")} characters or fewer.` };
  }
  return { ok: true, value: trimmed };
}

function sanitizeShortMetadataString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function sanitizeSourceType(value: unknown) {
  const sourceType = sanitizeShortMetadataString(value, MAX_SOURCE_TYPE_CHARS);
  if (!sourceType || !SOURCE_TYPE_PATTERN.test(sourceType)) return undefined;
  return sourceType.toLowerCase();
}

function sanitizeCitationSourceType(value: unknown): SourceCitation["source_type"] | undefined {
  const sourceType = sanitizeSourceType(value);
  if (!sourceType || !["file", "note", "summary", "previous_answer"].includes(sourceType)) return undefined;
  return sourceType as SourceCitation["source_type"];
}

function sanitizeLocator(value: unknown) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return undefined;
  if (value < 1 || value > MAX_LOCATOR) return undefined;
  return value;
}

function sanitizeCitations(value: unknown): SourceCitation[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const citations: SourceCitation[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isRecord(item)) continue;

    const sourceName = sanitizeShortMetadataString(
      firstDefined(item, ["source_name", "sourceName", "label"]),
      MAX_SOURCE_LABEL_CHARS,
    );
    const sourceType = sanitizeCitationSourceType(firstDefined(item, ["source_type", "sourceType"]));
    if (!sourceName || !sourceType) continue;

    const locatorTypeValue = sanitizeShortMetadataString(
      firstDefined(item, ["locator_type", "locatorType"]),
      16,
    )?.toLowerCase();
    const locatorType = locatorTypeValue && ["page", "slide", "chunk"].includes(locatorTypeValue)
      ? locatorTypeValue as SourceCitation["locator_type"]
      : undefined;
    const locatorStart = locatorType
      ? sanitizeLocator(firstDefined(item, ["locator_start", "locatorStart"]))
      : undefined;
    const rawLocatorEnd = locatorType
      ? sanitizeLocator(firstDefined(item, ["locator_end", "locatorEnd"]))
      : undefined;
    const locatorEnd = locatorStart && rawLocatorEnd && rawLocatorEnd >= locatorStart
      ? rawLocatorEnd
      : locatorStart;
    const sourceId = sanitizeShortMetadataString(
      firstDefined(item, ["source_id", "sourceId"]),
      MAX_SOURCE_ID_CHARS,
    );
    const suppliedId = sanitizeShortMetadataString(item.id, MAX_CITATION_ID_CHARS);
    const key = [sourceType, sourceId ?? sourceName, locatorType ?? "source", locatorStart ?? "", locatorEnd ?? ""].join(":");
    if (seen.has(key)) continue;

    seen.add(key);
    citations.push({
      id: suppliedId ?? `source-${citations.length + 1}`,
      ...(sourceId ? { source_id: sourceId } : {}),
      source_type: sourceType,
      source_name: sourceName,
      ...(locatorType && locatorStart
        ? {
            locator_type: locatorType,
            locator_start: locatorStart,
            locator_end: locatorEnd,
          }
        : {}),
    });

    if (citations.length >= MAX_CITATIONS) break;
  }

  return citations.length ? citations : undefined;
}

function sanitizeMetadata(value: unknown): ValidationResult<SanitizedNoteMetadata> {
  if (value === null) return { ok: true, value: {} };
  if (!isRecord(value)) return { ok: false, error: "Metadata must be an object." };

  const nestedSource = isRecord(value.source) ? value.source : {};
  const sourceLabel = sanitizeShortMetadataString(
    firstDefined(value, ["source_label", "sourceLabel"])
      ?? firstDefined(nestedSource, ["label", "name", "source_label", "sourceLabel"]),
    MAX_SOURCE_LABEL_CHARS,
  );
  const sourceType = sanitizeSourceType(
    firstDefined(value, ["source_type", "sourceType"])
      ?? firstDefined(nestedSource, ["type", "source_type", "sourceType"]),
  );
  const sourceId = sanitizeShortMetadataString(
    firstDefined(value, ["source_id", "sourceId"])
      ?? firstDefined(nestedSource, ["id", "source_id", "sourceId"]),
    MAX_SOURCE_ID_CHARS,
  );
  const citations = sanitizeCitations(firstDefined(value, ["source_citations", "sourceCitations", "citations"]));
  const language = sanitizeShortMetadataString(value.language, MAX_LANGUAGE_CHARS);
  const style = sanitizeShortMetadataString(
    firstDefined(value, ["style", "note_style", "noteStyle"]),
    MAX_STYLE_CHARS,
  );
  const generatedAtValue = firstDefined(value, ["generated_at", "generatedAt"]);
  let generatedAt: string | undefined;
  if (generatedAtValue !== undefined && generatedAtValue !== null && generatedAtValue !== "") {
    if (
      typeof generatedAtValue !== "string"
      || !ISO_TIMESTAMP_PATTERN.test(generatedAtValue)
      || !Number.isFinite(Date.parse(generatedAtValue))
    ) {
      return { ok: false, error: "Generated date must be a valid ISO date." };
    }
    generatedAt = new Date(generatedAtValue).toISOString();
  }

  return {
    ok: true,
    value: {
      ...(sourceLabel && sourceType
        ? {
            source: {
              type: sourceType,
              label: sourceLabel,
              ...(sourceId ? { id: sourceId } : {}),
            },
          }
        : {}),
      ...(citations ? { source_citations: citations } : {}),
      ...(language ? { language } : {}),
      ...(style ? { note_style: style } : {}),
      ...(generatedAt ? { generated_at: generatedAt } : {}),
    },
  };
}

function validateDate(value: unknown): ValidationResult<string | null> {
  if (value === null || (typeof value === "string" && !value.trim())) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Note date must use YYYY-MM-DD format." };

  const match = value.match(DATE_PATTERN);
  if (!match) return { ok: false, error: "Note date must use YYYY-MM-DD format." };

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { ok: false, error: "Note date is not valid." };
  }
  return { ok: true, value };
}

function validateKeyLink(value: unknown): ValidationResult<string | null> {
  if (value === null || (typeof value === "string" && !value.trim())) return { ok: true, value: null };
  const text = optionalTrimmedString(value, "Key link", MAX_KEY_LINK_CHARS, { allowEmpty: false });
  if (!text.ok) return text;

  try {
    const url = new URL(text.value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("unsafe protocol");
  } catch {
    return { ok: false, error: "Key link must be a valid HTTP or HTTPS URL." };
  }

  return { ok: true, value: text.value };
}

function validateImportance(value: unknown): ValidationResult<NoteImportance | null> {
  if (value === null || (typeof value === "string" && !value.trim())) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "Importance must be low, medium, or high." };
  const importance = value.trim().toLowerCase();
  if (importance !== "low" && importance !== "medium" && importance !== "high") {
    return { ok: false, error: "Importance must be low, medium, or high." };
  }
  return { ok: true, value: importance };
}

function validateFileId(value: unknown): ValidationResult<string | null> {
  if (value === null || (typeof value === "string" && !value.trim())) return { ok: true, value: null };
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    return { ok: false, error: "Source file id is not valid." };
  }
  return { ok: true, value: value.trim().toLowerCase() };
}

function validateSourceType(value: unknown): ValidationResult<string> {
  const result = optionalTrimmedString(value, "Source type", MAX_SOURCE_TYPE_CHARS, { allowEmpty: false });
  if (!result.ok) return result;
  if (!SOURCE_TYPE_PATTERN.test(result.value)) {
    return { ok: false, error: "Source type may contain only letters, numbers, underscores, and hyphens." };
  }
  return { ok: true, value: result.value.toLowerCase() };
}

export function validateNoteId(value: string): ValidationResult<string> {
  const id = value.trim();
  if (!UUID_PATTERN.test(id)) return { ok: false, error: "Note id is not valid." };
  return { ok: true, value: id.toLowerCase() };
}

export function validateNoteBody(value: unknown, mode: "create" | "update"): ValidationResult<NoteWriteValues> {
  if (!isRecord(value)) return { ok: false, error: "Invalid request body." };
  if ("user_id" in value || "userId" in value) {
    return { ok: false, error: "User ownership is assigned by the server." };
  }

  const output: NoteWriteValues = {};

  if (mode === "create" || value.title !== undefined) {
    const title = optionalTrimmedString(value.title, "Title", MAX_NOTE_TITLE_CHARS, { allowEmpty: false });
    if (!title.ok) return title;
    output.title = title.value;
  }

  if (mode === "create" || value.content !== undefined) {
    const content = optionalTrimmedString(value.content, "Content", MAX_NOTE_CONTENT_CHARS, { allowEmpty: false });
    if (!content.ok) return content;
    output.content = content.value;
  }

  if (value.topic !== undefined) {
    if (value.topic === null) {
      output.topic = "";
    } else {
      const topic = optionalTrimmedString(value.topic, "Topic", MAX_TOPIC_CHARS);
      if (!topic.ok) return topic;
      output.topic = topic.value;
    }
  } else if (mode === "create") {
    output.topic = "";
  }

  if (value.sourceType !== undefined) {
    if (value.sourceType === null || (typeof value.sourceType === "string" && !value.sourceType.trim())) {
      output.sourceType = "manual";
    } else {
      const sourceType = validateSourceType(value.sourceType);
      if (!sourceType.ok) return sourceType;
      output.sourceType = sourceType.value;
    }
  } else if (mode === "create") {
    output.sourceType = "manual";
  }

  if (value.keyLink !== undefined) {
    const keyLink = validateKeyLink(value.keyLink);
    if (!keyLink.ok) return keyLink;
    output.keyLink = keyLink.value;
  } else if (mode === "create") {
    output.keyLink = null;
  }

  if (value.noteDate !== undefined) {
    const noteDate = validateDate(value.noteDate);
    if (!noteDate.ok) return noteDate;
    output.noteDate = noteDate.value;
  } else if (mode === "create") {
    output.noteDate = null;
  }

  if (value.importance !== undefined) {
    const importance = validateImportance(value.importance);
    if (!importance.ok) return importance;
    output.importance = importance.value;
  } else if (mode === "create") {
    output.importance = null;
  }

  if (value.fileId !== undefined) {
    const fileId = validateFileId(value.fileId);
    if (!fileId.ok) return fileId;
    output.fileId = fileId.value;
  } else if (mode === "create") {
    output.fileId = null;
  }

  if (value.metadata !== undefined) {
    const metadata = sanitizeMetadata(value.metadata);
    if (!metadata.ok) return metadata;
    output.metadata = metadata.value;
  } else if (mode === "create") {
    output.metadata = {};
  }

  if (mode === "update" && !Object.keys(output).length) {
    return { ok: false, error: "Provide at least one note field to update." };
  }

  return { ok: true, value: output };
}
