import { createHash } from "node:crypto";

export type DocumentChunk = {
  id: string;
  index: number;
  text: string;
  textLength: number;
  startPage: number | null;
  endPage: number | null;
  hash: string;
};

export type DocumentChunkManifestEntry = Omit<DocumentChunk, "text">;

export type DocumentProcessingStage =
  | "uploaded"
  | "extracting"
  | "extracted"
  | "chunking"
  | "chunked"
  | "generating"
  | "partially_complete"
  | "complete"
  | "failed";

export type DocumentProcessingProgress = {
  stage: DocumentProcessingStage;
  startedAt: string;
  elapsedMs: number;
  pagesProcessed: number | null;
  totalPages: number | null;
  chunksProcessed: number;
  totalChunks: number;
  retryCount: number;
  cache: "hit" | "miss" | "skipped";
  fallbackUsed: boolean;
  partialFailures: string[];
};

export type DocumentProcessingMetadata = {
  pipelineVersion: string;
  contentHash: string;
  normalizedTextLength: number;
  chunksCount: number;
  chunks: DocumentChunkManifestEntry[];
  budgets: typeof DOCUMENT_PROCESSING_BUDGETS;
  progress: DocumentProcessingProgress;
};

export type GenerationCacheKeyInput = {
  fileId?: string | null;
  noteId?: string | null;
  contentHash: string;
  generationType: "summary" | "quiz" | "revision" | "chat";
  provider?: string;
  model?: string;
  promptVersion: string;
  personalizationHash?: string;
  options?: Record<string, unknown>;
};

export const DOCUMENT_PIPELINE_VERSION = "document-pipeline-v1";

export const DOCUMENT_PROCESSING_BUDGETS = {
  maxFileBytes: 60 * 1024 * 1024,
  maxPdfPages: 250,
  maxExtractedCharacters: 900_000,
  maxChunksPerAiOperation: 80,
  maxAiRequestsPerOperation: 90,
  maxRetryAttempts: 2,
  maxTotalProcessingMs: 110_000,
  maxOutputTokens: 8192,
  defaultChunkCharacters: 10_000,
  overlapCharacters: 450,
} as const;

type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
  sourceId?: string;
  dedupe?: boolean;
};

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function stableHash(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function normalizeDocumentText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function removeRepeatedHeadersFooters(text: string) {
  const normalized = normalizeDocumentText(text);
  const pageBlocks = normalized.split(/(?=\[Page\s+\d+\])/gi);
  if (pageBlocks.length < 4) return normalized;

  const lineCounts = new Map<string, number>();
  const perPageLines = pageBlocks.map((block) =>
    block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length >= 4 && line.length <= 120),
  );

  for (const lines of perPageLines) {
    const candidates = [...lines.slice(0, 3), ...lines.slice(-3)];
    for (const line of new Set(candidates)) {
      if (/^\[Page\s+\d+\]/i.test(line)) continue;
      lineCounts.set(line.toLowerCase(), (lineCounts.get(line.toLowerCase()) ?? 0) + 1);
    }
  }

  const threshold = Math.max(3, Math.ceil(pageBlocks.length * 0.55));
  const repeated = new Set([...lineCounts.entries()].filter(([, count]) => count >= threshold).map(([line]) => line));
  if (!repeated.size) return normalized;

  return normalizeDocumentText(
    pageBlocks
      .map((block) =>
        block
          .split("\n")
          .filter((line) => !repeated.has(line.trim().toLowerCase()))
          .join("\n"),
      )
      .join("\n\n"),
  );
}

function pageForOffset(markers: { offset: number; page: number }[], offset: number) {
  let current: number | null = null;
  for (const marker of markers) {
    if (marker.offset > offset) break;
    current = marker.page;
  }
  return current;
}

function collectPageMarkers(text: string) {
  return [...text.matchAll(/\[Page\s+(\d+)\]/gi)]
    .map((match) => ({ offset: match.index ?? 0, page: Number(match[1]) }))
    .filter((marker) => Number.isFinite(marker.page))
    .sort((a, b) => a.offset - b.offset);
}

function findChunkBoundary(text: string, start: number, target: number) {
  if (target >= text.length) return text.length;
  const minimum = start + Math.floor((target - start) * 0.55);
  const paragraph = text.lastIndexOf("\n\n", target);
  if (paragraph > minimum) return paragraph + 2;
  const sentenceMatches = [". ", "? ", "! "]
    .map((needle) => text.lastIndexOf(needle, target))
    .filter((index) => index > minimum);
  if (sentenceMatches.length) return Math.max(...sentenceMatches) + 1;
  const newline = text.lastIndexOf("\n", target);
  if (newline > minimum) return newline + 1;
  return target;
}

function dedupeKey(text: string) {
  return normalizeDocumentText(text).toLowerCase().slice(0, 1000);
}

export function chunkDocument(text: string, options: ChunkOptions = {}): DocumentChunk[] {
  const cleaned = removeRepeatedHeadersFooters(text);
  if (!cleaned) return [];

  const maxChars = Math.max(800, options.maxChars ?? DOCUMENT_PROCESSING_BUDGETS.defaultChunkCharacters);
  const overlapChars = Math.max(0, Math.min(options.overlapChars ?? 0, Math.floor(maxChars * 0.2)));
  const markers = collectPageMarkers(cleaned);
  const chunks: DocumentChunk[] = [];
  const seen = new Set<string>();
  let cursor = 0;

  while (cursor < cleaned.length) {
    const target = Math.min(cursor + maxChars, cleaned.length);
    const end = findChunkBoundary(cleaned, cursor, target);
    const chunkText = cleaned.slice(cursor, end).trim();

    if (chunkText) {
      const key = dedupeKey(chunkText);
      if (!options.dedupe || !seen.has(key)) {
        seen.add(key);
        const index = chunks.length;
        const startPage = pageForOffset(markers, cursor);
        const endPage = pageForOffset(markers, Math.max(cursor, end - 1)) ?? startPage;
        const hash = stableHash(chunkText);
        chunks.push({
          id: `${options.sourceId ?? "doc"}-${index + 1}-${shortHash(hash)}`,
          index,
          text: chunkText,
          textLength: chunkText.length,
          startPage,
          endPage,
          hash,
        });
      }
    }

    if (end >= cleaned.length) break;
    cursor = overlapChars ? Math.max(end - overlapChars, cursor + 1) : end;
  }

  return chunks;
}

export function createProcessingProgress(
  stage: DocumentProcessingStage,
  values: Partial<Omit<DocumentProcessingProgress, "stage" | "startedAt" | "elapsedMs">> & { startedAt?: string } = {},
): DocumentProcessingProgress {
  const startedAt = values.startedAt ?? new Date().toISOString();
  return {
    stage,
    startedAt,
    elapsedMs: Math.max(0, Date.now() - Date.parse(startedAt || new Date().toISOString())),
    pagesProcessed: values.pagesProcessed ?? null,
    totalPages: values.totalPages ?? null,
    chunksProcessed: values.chunksProcessed ?? 0,
    totalChunks: values.totalChunks ?? 0,
    retryCount: values.retryCount ?? 0,
    cache: values.cache ?? "skipped",
    fallbackUsed: values.fallbackUsed ?? false,
    partialFailures: values.partialFailures ?? [],
  };
}

export function buildDocumentProcessingMetadata({
  text,
  chunks,
  progress,
}: {
  text: string;
  chunks: DocumentChunk[];
  progress?: DocumentProcessingProgress;
}): DocumentProcessingMetadata {
  const normalized = removeRepeatedHeadersFooters(text);
  return {
    pipelineVersion: DOCUMENT_PIPELINE_VERSION,
    contentHash: stableHash(normalized),
    normalizedTextLength: normalized.length,
    chunksCount: chunks.length,
    chunks: chunks.map(({ id, index, textLength, startPage, endPage, hash }) => ({ id, index, textLength, startPage, endPage, hash })),
    budgets: DOCUMENT_PROCESSING_BUDGETS,
    progress: progress ?? createProcessingProgress("chunked", { chunksProcessed: chunks.length, totalChunks: chunks.length }),
  };
}

export function buildGenerationCacheKey(input: GenerationCacheKeyInput) {
  return stableHash({
    fileId: input.fileId ?? null,
    noteId: input.noteId ?? null,
    contentHash: input.contentHash,
    generationType: input.generationType,
    provider: input.provider ?? "default",
    model: input.model ?? "default",
    promptVersion: input.promptVersion,
    personalizationHash: input.personalizationHash ?? "none",
    options: input.options ?? {},
  });
}

export function hasFreshCache({
  expectedCacheKey,
  cachedCacheKey,
  cachedContentHash,
  contentHash,
}: {
  expectedCacheKey: string;
  cachedCacheKey?: string | null;
  cachedContentHash?: string | null;
  contentHash: string;
}) {
  return Boolean(expectedCacheKey && cachedCacheKey === expectedCacheKey && cachedContentHash === contentHash);
}

export async function runWithBoundedRetries<T>(
  task: (attempt: number) => Promise<T>,
  {
    maxAttempts = DOCUMENT_PROCESSING_BUDGETS.maxRetryAttempts + 1,
    classifyFailure,
  }: {
    maxAttempts?: number;
    classifyFailure?: (error: unknown) => string;
  } = {},
) {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        ok: true as const,
        value: await task(attempt),
        attempts: attempt,
        failures,
      };
    } catch (error) {
      failures.push(classifyFailure?.(error) ?? (error instanceof Error ? error.message : "unknown"));
      if (attempt === maxAttempts) {
        return {
          ok: false as const,
          attempts: attempt,
          failures,
          error,
        };
      }
    }
  }

  return { ok: false as const, attempts: maxAttempts, failures, error: new Error("Retry budget exhausted.") };
}

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

export function selectRelevantChunks({
  chunks,
  query,
  maxChunks = 6,
  preserveOrder = false,
}: {
  chunks: DocumentChunk[];
  query: string;
  maxChunks?: number;
  preserveOrder?: boolean;
}) {
  if (!query.trim()) return chunks.slice(0, maxChunks);
  const queryTokens = tokenSet(query);
  const ranked = chunks.map((chunk) => {
    const text = chunk.text.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      if (text.includes(token)) score += 1;
    }
    return { chunk, score };
  });

  const selected = ranked
    .sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index)
    .slice(0, maxChunks)
    .map((item) => item.chunk);

  return preserveOrder ? selected.sort((a, b) => a.index - b.index) : selected;
}

export function isOversizedForAi(text: string) {
  const chunks = chunkDocument(text);
  return text.length > DOCUMENT_PROCESSING_BUDGETS.maxExtractedCharacters || chunks.length > DOCUMENT_PROCESSING_BUDGETS.maxChunksPerAiOperation;
}
