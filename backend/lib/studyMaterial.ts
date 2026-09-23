import "server-only";

import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import {
  buildDocumentProcessingMetadata,
  chunkDocument,
  createProcessingProgress,
  type DocumentProcessingMetadata,
} from "./documentProcessing";
import { askGeminiWithInlineData, getGeminiErrorCategory } from "./gemini";
import { extractPdfText, type PdfPageExtraction } from "./pdfText";
import { extractWithVision, isVisionAvailable, getVisionUserMessage } from "./aiProvider";
import { STUDYPILOT_TUTOR_INSTRUCTION } from "./tutorPrompt";

export type StudyContentType = "pdf" | "pptx" | "docx" | "text" | "image" | "zip";

export type ProcessedChildFile = {
  fileName: string;
  contentType: StudyContentType;
  extractedTextLength: number;
  processingNotes: string[];
};

export type StudyMaterialResult = {
  extractedText: string;
  contentType: StudyContentType;
  chunksCount: number;
  processingNotes: string[];
  pageMetadata?: StudyPageMetadata;
  documentMetadata?: DocumentProcessingMetadata;
  extractionFailure?: {
    code: "quota" | "model" | "timeout" | "insufficient" | "unavailable";
    message: string;
  };
  childFiles?: ProcessedChildFile[];
};

export type StudyPageRangeMetadata = {
  startPage: number;
  endPage: number;
  textLength: number;
  status: "extracted" | "empty" | "failed" | "pending";
  extractor: "pdfjs" | "pdf-parse" | "gemini" | "gemini-vision" | "nvidia-vision" | "native";
};

export type StudyPageMetadata = {
  totalPages: number;
  extractedPageCount: number;
  readablePages: number[];
  failedPages: number[];
  extractor: "pdfjs" | "pdf-parse" | "gemini-vision-batches" | "nvidia-vision-batches" | "mixed-native-vision";
  batchSize?: number;
  pageRanges: StudyPageRangeMetadata[];
  visionPagesAttempted: number;
  visionPagesSucceeded: number;
  visionPagesFailed: number;
  nativePagesSucceeded: number;
  fallbackProviderUsed?: "gemini-vision" | "nvidia-vision";
};

export type VisionExtractionProgress = {
  stage: "native-extraction" | "vision-queue" | "vision-processing" | "vision-complete" | "merging" | "complete";
  totalPages: number;
  nativePagesProcessed: number;
  nativePagesReadable: number;
  visionPagesQueued: number;
  visionPagesCompleted: number;
  visionPagesFailed: number;
  currentBatch?: { startPage: number; endPage: number; provider: "gemini-vision" | "nvidia-vision" };
  partialFailures: string[];
};

const MAX_ZIP_FILES = 20;
const MAX_ZIP_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
const MIN_READABLE_TEXT_LENGTH = 40;
const TEXT_SAMPLE_BYTES = 64 * 1024;
const PDF_VISION_BATCH_SIZE = 8;
const PDF_VISION_BATCH_CONCURRENCY = 2;
const PDF_VISION_MAX_OUTPUT_TOKENS = 4096;
const PDF_VISION_TIMEOUT_MS = 60_000;
const MIN_VISION_BATCH_TEXT_LENGTH = 20;
const MIN_NATIVE_PAGE_TEXT_LENGTH = 50;
const MAX_GIBBERISH_RATIO = 0.3;

function materialResult({
  extractedText,
  contentType,
  processingNotes,
  pageMetadata,
  extractionFailure,
  childFiles,
}: Omit<StudyMaterialResult, "chunksCount" | "documentMetadata">): StudyMaterialResult {
  const chunks = chunkDocument(extractedText, { sourceId: contentType, dedupe: true });
  const totalPages = pageMetadata?.totalPages ?? null;
  const extractedPages = pageMetadata?.extractedPageCount ?? pageMetadata?.readablePages.length ?? null;
  const stage = extractionFailure ? (extractedText ? "partially_complete" : "failed") : "chunked";
  const fallbackUsed = pageMetadata?.extractor?.includes("vision") ?? false;

  return {
    extractedText,
    contentType,
    chunksCount: chunks.length,
    processingNotes,
    ...(pageMetadata ? { pageMetadata } : {}),
    documentMetadata: buildDocumentProcessingMetadata({
      text: extractedText,
      chunks,
      progress: createProcessingProgress(stage, {
        pagesProcessed: extractedPages,
        totalPages,
        chunksProcessed: chunks.length,
        totalChunks: chunks.length,
        fallbackUsed,
        partialFailures: extractionFailure ? [extractionFailure.message] : [],
      }),
    }),
    ...(extractionFailure ? { extractionFailure } : {}),
    ...(childFiles ? { childFiles } : {}),
  };
}

function isGibberish(text: string): boolean {
  if (!text.trim()) return true;
  const chars = text.replace(/\s/g, "");
  if (chars.length < 10) return true;
  const uniqueChars = new Set(chars.toLowerCase()).size;
  const ratio = uniqueChars / chars.length;
  if (ratio < 0.15) return true;
  const words = text.split(/\s+/).filter((w) => w.length > 1);
  if (words.length === 0) return true;
  const nonWordChars = words.filter((w) => !/^[a-zA-Z0-9.,;:!?()\[\]{}'"/-]+$/.test(w)).length;
  if (nonWordChars / words.length > MAX_GIBBERISH_RATIO) return true;
  return false;
}

function assessNativePageQuality(page: PdfPageExtraction): { readable: boolean; reason?: string } {
  if (!page.readable || page.textLength === 0) {
    return { readable: false, reason: "empty" };
  }
  if (page.textLength < MIN_NATIVE_PAGE_TEXT_LENGTH) {
    return { readable: false, reason: "too-short" };
  }
  return { readable: true };
}

function buildPageRangesFromExtractions(
  extractions: PdfPageExtraction[],
  visionResults: Map<number, { text: string; provider: "gemini" | "gemini-vision" | "nvidia-vision"; success: boolean; error?: string }>,
): StudyPageRangeMetadata[] {
  return extractions.map((page) => {
    const visionResult = visionResults.get(page.pageNumber);
    if (visionResult) {
      return {
        startPage: page.pageNumber,
        endPage: page.pageNumber,
        textLength: visionResult.success ? visionResult.text.length : 0,
        status: visionResult.success ? "extracted" : "failed",
        extractor: visionResult.provider,
      };
    }
    return {
      startPage: page.pageNumber,
      endPage: page.pageNumber,
      textLength: page.textLength,
      status: page.readable ? "extracted" : page.textLength === 0 ? "empty" : "failed",
      extractor: "native",
    };
  });
}

// Minimum extracted text we require before trusting standard PDF text
// extraction for a file of a given size. A real text-based PDF yields far
// more than this; the old fixed `>= 40` check let a single partial section of
// a long PDF (e.g. CNS Module 1, ~63 pages) be saved as the whole document,
// which then starved the summarizer of the missing topics.
function expectedMinPdfText(bufferBytes: number, pages: number) {
  const floor = MIN_READABLE_TEXT_LENGTH;
  if (pages > 0) {
    // ~150 chars/page is conservative; text PDFs usually produce much more.
    return Math.max(floor, Math.min(pages * 150, 6000));
  }
  // No page count yet: approximate from compressed buffer size.
  return Math.max(floor, Math.min(Math.floor(bufferBytes / 150), 6000));
}

function expectedMinVisionText(pages: number) {
  return Math.max(MIN_READABLE_TEXT_LENGTH, Math.min((pages || 1) * 50, 4000));
}

const blockedExtensions = new Set([".exe", ".bat", ".cmd", ".sh", ".js", ".ts", ".msi", ".dll", ".com", ".scr", ".ps1", ".vbs", ".jar"]);
const allowedExtensions = new Set([".pdf", ".pptx", ".docx", ".txt", ".md", ".jpg", ".jpeg", ".png", ".webp", ".zip"]);

const imageMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const textMimeTypes = new Set(["text/plain", "text/markdown", "text/x-markdown"]);
const zipMimeTypes = new Set(["application/zip", "application/x-zip-compressed"]);
const officeMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const allowedMimeTypes = new Set(["application/pdf", ...imageMimeTypes, ...textMimeTypes, ...zipMimeTypes, ...officeMimeTypes]);
const extensionMimeTypes = new Map([
  [".pdf", "application/pdf"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".zip", "application/zip"],
]);

function extname(fileName: string) {
  const lower = fileName.toLowerCase();
  const index = lower.lastIndexOf(".");
  return index === -1 ? "" : lower.slice(index);
}

function normalizeMimeType(mimeType = "") {
  return mimeType.split(";")[0].trim().toLowerCase();
}

export function inferStudyMimeType(fileName: string, mimeType = "") {
  const extMime = extensionMimeTypes.get(extname(fileName));
  if (extMime) return extMime;

  const normalized = normalizeMimeType(mimeType);
  if (allowedMimeTypes.has(normalized)) return normalized;
  return "application/octet-stream";
}

export function isBlockedStudyFile(fileName: string) {
  return blockedExtensions.has(extname(fileName));
}

export function isAllowedStudyFile(fileName: string, mimeType = "") {
  const ext = extname(fileName);
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (isBlockedStudyFile(fileName)) return false;
  if (allowedExtensions.has(ext)) return true;
  return allowedMimeTypes.has(normalizedMimeType);
}

export function detectStudyContentType(fileName: string, mimeType = ""): StudyContentType | null {
  const ext = extname(fileName);
  const normalizedMimeType = normalizeMimeType(mimeType);
  if (ext === ".pdf" || normalizedMimeType === "application/pdf") return "pdf";
  if (ext === ".pptx" || normalizedMimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (ext === ".docx" || normalizedMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (ext === ".txt" || ext === ".md" || textMimeTypes.has(normalizedMimeType)) return "text";
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext) || imageMimeTypes.has(normalizedMimeType)) return "image";
  if (ext === ".zip" || zipMimeTypes.has(normalizedMimeType)) return "zip";
  return null;
}

function unsupportedFileType(): never {
  throw new Error("Unsupported file type.");
}

function startsWithBytes(buffer: Buffer, bytes: number[]) {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

function hasPdfSignature(buffer: Buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from("%PDF-"));
}

function hasZipSignature(buffer: Buffer) {
  return startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]) || startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06]) || startsWithBytes(buffer, [0x50, 0x4b, 0x07, 0x08]);
}

function detectImageMimeFromSignature(buffer: Buffer) {
  if (startsWithBytes(buffer, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

function looksLikeText(buffer: Buffer) {
  if (!buffer.length) return true;

  const sample = buffer.subarray(0, Math.min(buffer.length, TEXT_SAMPLE_BYTES));
  if (sample.includes(0)) return false;

  const decoded = sample.toString("utf8");
  if (!decoded) return true;

  const replacementCount = [...decoded].filter((char) => char === "\uFFFD").length;
  if (replacementCount > 4 && replacementCount / decoded.length > 0.01) return false;

  let suspiciousControlCount = 0;
  for (const char of decoded) {
    const code = char.charCodeAt(0);
    if (code < 32 && char !== "\n" && char !== "\r" && char !== "\t" && char !== "\f") suspiciousControlCount += 1;
  }

  return suspiciousControlCount / decoded.length <= 0.02;
}

function validateStudyMaterialBuffer(buffer: Buffer, fileName: string, mimeType: string, contentType: StudyContentType) {
  const expectedMimeType = inferStudyMimeType(fileName, mimeType);

  if (contentType === "pdf") {
    if (!hasPdfSignature(buffer)) unsupportedFileType();
    return "application/pdf";
  }

  if (contentType === "docx" || contentType === "pptx" || contentType === "zip") {
    if (!hasZipSignature(buffer)) unsupportedFileType();
    return expectedMimeType;
  }

  if (contentType === "image") {
    const actualMimeType = detectImageMimeFromSignature(buffer);
    if (!actualMimeType) unsupportedFileType();
    if (imageMimeTypes.has(expectedMimeType) && expectedMimeType !== actualMimeType) unsupportedFileType();
    return actualMimeType;
  }

  if (contentType === "text") {
    if (!looksLikeText(buffer)) unsupportedFileType();
    return expectedMimeType;
  }

  return expectedMimeType;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlText(xml: string) {
  const matches = [...xml.matchAll(/<[^:>]*:?t[^>]*>([\s\S]*?)<\/[^:>]*:?t>/g)];
  return matches.map((match) => decodeXmlEntities(match[1].replace(/<[^>]+>/g, ""))).join(" ").replace(/\s+/g, " ").trim();
}

function cleanText(text: string) {
  return text.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[studyMaterial] ${message}`, details ?? "");
}

async function explainImage(buffer: Buffer, mimeType: string) {
  return askGeminiWithInlineData({
    mimeType,
    data: buffer,
    prompt: `${STUDYPILOT_TUTOR_INSTRUCTION}

Analyze this study image. Return plain text with these sections:
- What the image contains
- Visible text
- Student-friendly explanation
- Key points`,
  });
}

type VisionBatch = {
  startPage: number;
  endPage: number;
  data: Buffer;
  pageNumbers: number[];
};

type VisionBatchResult = {
  batch: VisionBatch;
  pageResults: Map<number, { text: string; success: boolean; error?: string }>;
  provider: "gemini" | "gemini-vision" | "nvidia-vision";
  failure?: { code: string; message: string };
};

async function createVisionBatches(
  buffer: Buffer,
  pageNumbers: number[],
): Promise<{ totalPages: number; batches: VisionBatch[] }> {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = source.getPageCount();
  const batches: VisionBatch[] = [];

  for (let i = 0; i < pageNumbers.length; i += PDF_VISION_BATCH_SIZE) {
    const batchPageNumbers = pageNumbers.slice(i, i + PDF_VISION_BATCH_SIZE);
    const startPage = batchPageNumbers[0];
    const endPage = batchPageNumbers[batchPageNumbers.length - 1];
    const batchDocument = await PDFDocument.create();
    const pageIndexes = batchPageNumbers.map((p) => p - 1);
    const copiedPages = await batchDocument.copyPages(source, pageIndexes);
    copiedPages.forEach((page) => batchDocument.addPage(page));
    const bytes = await batchDocument.save({ useObjectStreams: true, addDefaultPage: false });
    batches.push({ startPage, endPage, data: Buffer.from(bytes), pageNumbers: batchPageNumbers });
  }

  return { totalPages, batches };
}

async function processVisionBatch(
  batch: VisionBatch,
  fileName: string,
  attemptGeminiFirst: boolean,
  progressCallback?: (stage: VisionExtractionProgress["stage"], currentBatch?: VisionBatch, provider?: "gemini-vision" | "nvidia-vision") => void,
): Promise<VisionBatchResult> {
  const prompt = `${STUDYPILOT_TUTOR_INSTRUCTION}

This PDF contains original document pages ${batch.startPage}-${batch.endPage}.
Extract the study content from every page in this batch. Do not summarize, skip later pages, or focus on only one topic.
Label content with the original page markers [Page ${batch.startPage}] through [Page ${batch.endPage}].
Preserve headings, definitions, formulas, examples, cipher steps, tables, and diagram meaning.
If a page has no readable study content, write its page marker followed by [No readable text detected].
Return plain text only.`;

  const pageResults = new Map<number, { text: string; success: boolean; error?: string }>();

  if (attemptGeminiFirst) {
    progressCallback?.("vision-processing", batch, "gemini-vision");
    try {
      const rawText = await askGeminiWithInlineData({
        prompt,
        mimeType: "application/pdf",
        data: batch.data,
        maxOutputTokens: PDF_VISION_MAX_OUTPUT_TOKENS,
        timeoutMs: PDF_VISION_TIMEOUT_MS,
      });
      const text = cleanText(rawText);

      if (text.length >= MIN_VISION_BATCH_TEXT_LENGTH) {
        for (const pageNum of batch.pageNumbers) {
          const pageMarker = new RegExp(`\\[Page\\s+${pageNum}\\]`);
          const hasPageMarker = pageMarker.test(text);
          pageResults.set(pageNum, { text: hasPageMarker ? text : "", success: hasPageMarker, error: hasPageMarker ? undefined : "page-marker-missing" });
        }
        if (pageResults.size === batch.pageNumbers.length && [...pageResults.values()].every((r) => r.success)) {
          return { batch, pageResults, provider: "gemini-vision" };
        }
      }
    } catch (error) {
      devLog("gemini vision batch failed, will try nvidia-vision", {
        fileName,
        startPage: batch.startPage,
        endPage: batch.endPage,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  progressCallback?.("vision-processing", batch, "nvidia-vision");
  try {
    const response = await extractWithVision(prompt, batch.data, "application/pdf", {
      maxOutputTokens: PDF_VISION_MAX_OUTPUT_TOKENS,
      timeoutMs: PDF_VISION_TIMEOUT_MS,
    });
    const text = cleanText(response.text);

    if (text.length >= MIN_VISION_BATCH_TEXT_LENGTH) {
      for (const pageNum of batch.pageNumbers) {
        const pageMarker = new RegExp(`\\[Page\\s+${pageNum}\\]`);
        const hasPageMarker = pageMarker.test(text);
        pageResults.set(pageNum, { text: hasPageMarker ? text : "", success: hasPageMarker, error: hasPageMarker ? undefined : "page-marker-missing" });
      }
      if (pageResults.size === batch.pageNumbers.length && [...pageResults.values()].every((r) => r.success)) {
        return { batch, pageResults, provider: response.provider, failure: response.provider === "nvidia-vision" ? undefined : undefined };
      }
    }

    return {
      batch,
      pageResults,
      provider: response.provider,
      failure: { code: "insufficient", message: `NVIDIA Vision returned insufficient text for PDF pages ${batch.startPage}-${batch.endPage}.` },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vision extraction failed";
    devLog("nvidia vision batch failed", {
      fileName,
      startPage: batch.startPage,
      endPage: batch.endPage,
      error: message,
    });
    for (const pageNum of batch.pageNumbers) {
      pageResults.set(pageNum, { text: "", success: false, error: message });
    }
    return {
      batch,
      pageResults,
      provider: "nvidia-vision",
      failure: { code: "unavailable", message: `NVIDIA Vision failed: ${getVisionUserMessage(error)}` },
    };
  }
}

async function processVisionBatchesWithConcurrency(
  batches: VisionBatch[],
  fileName: string,
  progressCallback?: (progress: import("./backgroundJobs").ExtractionProgressDetail) => Promise<void>,
): Promise<VisionBatchResult[]> {
  const results: VisionBatchResult[] = [];
  const concurrency = Math.min(PDF_VISION_BATCH_CONCURRENCY, batches.length);
  let completed = 0;
  const totalVisionPages = batches.reduce((sum, b) => sum + b.pageNumbers.length, 0);

  async function runBatch(batch: VisionBatch) {
    const result = await processVisionBatch(batch, fileName, true, async (stage, currentBatch, provider) => {
      if (progressCallback) {
        await progressCallback({
          stage,
          totalPages: totalVisionPages,
          nativePagesProcessed: 0,
          nativePagesReadable: 0,
          visionPagesQueued: batches.length - completed - 1,
          visionPagesCompleted: completed,
          visionPagesFailed: 0,
          currentBatch: currentBatch ? { startPage: currentBatch.startPage, endPage: currentBatch.endPage, provider: provider! } : undefined,
          partialFailures: [],
        });
      }
    });
    completed += 1;
    results.push(result);
    if (progressCallback) {
      await progressCallback({
        stage: "vision-processing",
        totalPages: totalVisionPages,
        nativePagesProcessed: 0,
        nativePagesReadable: 0,
        visionPagesQueued: batches.length - completed,
        visionPagesCompleted: completed,
        visionPagesFailed: results.filter((r) => r.failure).length,
        partialFailures: results.filter((r) => r.failure).map((r) => r.failure!.message),
      });
    }
    return result;
  }

  const queue = [...batches];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const batch = queue.shift()!;
      await runBatch(batch);
    }
  });
  await Promise.all(workers);

  return results;
}

async function processPdf(
  buffer: Buffer,
  fileName: string,
  validateExtractedText?: (text: string) => boolean,
  resumeProgress?: import("./backgroundJobs").ExtractionProgressDetail | null,
  progressCallback?: (progress: import("./backgroundJobs").ExtractionProgressDetail) => Promise<void>,
): Promise<StudyMaterialResult> {
  const notes: string[] = [];

  const reportProgress = async (progress: import("./backgroundJobs").ExtractionProgressDetail) => {
    if (progressCallback) {
      await progressCallback(progress);
    }
  };

  devLog("pdf extraction started", { fileName, bufferSize: buffer.length, isResume: Boolean(resumeProgress) });

  let nativeExtractions: PdfPageExtraction[];
  let totalPages: number;
  let nativeExtractor: "pdfjs" | "pdf-parse";

  try {
    const extracted = await extractPdfText(buffer);
    nativeExtractions = extracted.pageExtractions;
    totalPages = extracted.pages;
    nativeExtractor = extracted.extractor;

    devLog("native pdf extraction completed", {
      fileName,
      extractor: nativeExtractor,
      pages: totalPages,
      readablePages: extracted.readablePages.length,
      failedPages: extracted.failedPages.length,
      textLength: extracted.readableTextLength,
    });
  } catch (error) {
    devLog("native pdf extraction failed completely", {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    });
    notes.push("Native PDF text extraction failed; falling back to vision for all pages.");

    const { visionPagesQueued, visionPagesSucceeded, visionPagesFailed, extractedText, pageMetadata, extractionFailure } = await extractAllPagesWithVision(buffer, fileName, validateExtractedText, reportProgress);
    notes.push(`Vision extraction attempted ${visionPagesQueued} pages; ${visionPagesSucceeded} succeeded, ${visionPagesFailed} failed.`);
    if (extractionFailure) {
      return {
        ...materialResult({
          extractedText: extractedText || "",
          contentType: "pdf",
          processingNotes: notes,
          pageMetadata,
          extractionFailure,
        }),
      };
    }
    return {
      ...materialResult({
        extractedText: extractedText || "",
        contentType: "pdf",
        processingNotes: notes,
        pageMetadata,
      }),
    };
  }

  const completedPagesFromResume = resumeProgress ? new Set<number>() : new Set<number>();
  const failedPagesFromResume = resumeProgress ? new Set<number>() : new Set<number>();
  const visionCompletedFromResume = resumeProgress ? new Set<number>() : new Set<number>();
  if (resumeProgress) {
    for (const range of resumeProgress.completedPageRanges ?? []) {
      if (range.success) {
        for (let p = range.startPage; p <= range.endPage; p++) {
          completedPagesFromResume.add(p);
          if (range.extractor === "gemini-vision" || range.extractor === "nvidia-vision") {
            visionCompletedFromResume.add(p);
          }
        }
      }
    }
    for (const p of resumeProgress.failedPages ?? []) {
      failedPagesFromResume.add(p);
    }
  }

  await reportProgress({
    stage: "native-extraction",
    totalPages,
    nativePagesProcessed: totalPages,
    nativePagesReadable: nativeExtractions.filter((p) => p.readable).length,
    visionPagesQueued: 0,
    visionPagesCompleted: 0,
    visionPagesFailed: 0,
    partialFailures: [],
    completedPageRanges: resumeProgress?.completedPageRanges ?? [],
    failedPages: resumeProgress?.failedPages ?? [],
  });

  const nativeQuality = nativeExtractions.map((page) => ({
    pageNumber: page.pageNumber,
    ...assessNativePageQuality(page),
    textLength: page.textLength,
  }));

  const readableNativePages = nativeQuality
    .filter((p) => p.readable)
    .map((p) => p.pageNumber)
    .filter((p) => !completedPagesFromResume.has(p));

  const alreadyCompletedNative = nativeQuality
    .filter((p) => p.readable)
    .map((p) => p.pageNumber)
    .filter((p) => completedPagesFromResume.has(p));

  let problematicPages = nativeQuality
    .filter((p) => !p.readable)
    .map((p) => p.pageNumber)
    .filter((p) => !completedPagesFromResume.has(p) && !failedPagesFromResume.has(p));

  devLog("native page quality assessment", {
    fileName,
    totalPages,
    readableNativePages: readableNativePages.length,
    alreadyCompletedNative: alreadyCompletedNative.length,
    problematicPages: problematicPages.length,
    reasons: problematicPages.length > 0 ? nativeQuality.filter((p) => !p.readable && problematicPages.includes(p.pageNumber)).map((p) => p.reason) : [],
  });

  // If no problematic pages, native extraction is sufficient
  if (problematicPages.length === 0) {
    const extracted = await extractPdfText(buffer);
    notes.push(
      `Standard PDF extraction processed all ${extracted.pages} pages; ${extracted.readablePages.length} pages contained readable text.`,
    );
    notes.push(`PDF text extraction produced ${extracted.readableTextLength} characters using ${extracted.extractor}.`);

    const pageMetadata: StudyPageMetadata = {
      totalPages,
      extractedPageCount: readableNativePages.length + alreadyCompletedNative.length,
      readablePages: [...readableNativePages, ...alreadyCompletedNative].sort((a, b) => a - b),
      failedPages: [],
      extractor: nativeExtractor,
      pageRanges: buildPageRangesFromExtractions(nativeExtractions, new Map()),
      visionPagesAttempted: 0,
      visionPagesSucceeded: 0,
      visionPagesFailed: 0,
      nativePagesSucceeded: readableNativePages.length + alreadyCompletedNative.length,
    };

    const required = expectedMinPdfText(buffer.length, totalPages);
    const coverageValid = validateExtractedText ? validateExtractedText(extracted.text) : true;

    if (extracted.readableTextLength >= required && coverageValid) {
      await reportProgress({
        stage: "complete",
        totalPages,
        nativePagesProcessed: totalPages,
        nativePagesReadable: readableNativePages.length + alreadyCompletedNative.length,
        visionPagesQueued: 0,
        visionPagesCompleted: 0,
        visionPagesFailed: 0,
        partialFailures: [],
        completedPageRanges: pageMetadata.pageRanges.map((r) => ({
          startPage: r.startPage,
          endPage: r.endPage,
          extractor: r.extractor,
          success: r.status === "extracted",
        })),
        failedPages: [],
        extractedTextLength: extracted.text.length,
      });
      return {
        ...materialResult({
          extractedText: extracted.text,
          contentType: "pdf",
          processingNotes: notes,
          pageMetadata,
        }),
      };
    }

    notes.push(
      coverageValid
        ? `Standard PDF extraction found ${extracted.readableTextLength} characters; coverage validation required vision for some pages.`
        : "Standard PDF extraction did not cover the full module; vision fallback needed.",
    );
    problematicPages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
      (p) => !completedPagesFromResume.has(p) && !failedPagesFromResume.has(p),
    );
  }

  if (problematicPages.length > 0) {
    notes.push(
      `Native extraction readable on ${readableNativePages.length + alreadyCompletedNative.length}/${totalPages} pages; ${problematicPages.length} pages need vision fallback.`,
    );
    await reportProgress({
      stage: "vision-queue",
      totalPages,
      nativePagesProcessed: totalPages,
      nativePagesReadable: readableNativePages.length + alreadyCompletedNative.length,
      visionPagesQueued: problematicPages.length,
      visionPagesCompleted: 0,
      visionPagesFailed: 0,
      partialFailures: [],
      completedPageRanges: resumeProgress?.completedPageRanges ?? [],
      failedPages: resumeProgress?.failedPages ?? [],
    });

    const { visionPagesSucceeded, visionPagesFailed, extractedText, pageMetadata, extractionFailure } = await extractProblematicPagesWithVision(
      buffer,
      fileName,
      problematicPages,
      nativeExtractions,
      [...readableNativePages, ...alreadyCompletedNative],
      visionCompletedFromResume,
      validateExtractedText,
      reportProgress,
    );

    notes.push(`Vision extraction: ${visionPagesSucceeded} pages succeeded, ${visionPagesFailed} pages failed.`);
    if (extractionFailure) {
      return {
        ...materialResult({
          extractedText: extractedText || "",
          contentType: "pdf",
          processingNotes: notes,
          pageMetadata,
          extractionFailure,
        }),
      };
    }
    return {
      ...materialResult({
        extractedText: extractedText || "",
        contentType: "pdf",
        processingNotes: notes,
        pageMetadata,
      }),
    };
  }

  // This should not be reached, but handle edge case
  const extracted = await extractPdfText(buffer);
  const pageMetadata: StudyPageMetadata = {
    totalPages,
    extractedPageCount: readableNativePages.length + alreadyCompletedNative.length,
    readablePages: [...readableNativePages, ...alreadyCompletedNative].sort((a, b) => a - b),
    failedPages: problematicPages,
    extractor: "mixed-native-vision",
    pageRanges: buildPageRangesFromExtractions(nativeExtractions, new Map()),
    visionPagesAttempted: 0,
    visionPagesSucceeded: 0,
    visionPagesFailed: 0,
    nativePagesSucceeded: readableNativePages.length + alreadyCompletedNative.length,
  };

  await reportProgress({
    stage: "complete",
    totalPages,
    nativePagesProcessed: totalPages,
    nativePagesReadable: readableNativePages.length + alreadyCompletedNative.length,
    visionPagesQueued: 0,
    visionPagesCompleted: 0,
    visionPagesFailed: 0,
    partialFailures: [],
    completedPageRanges: pageMetadata.pageRanges.map((r) => ({
      startPage: r.startPage,
      endPage: r.endPage,
      extractor: r.extractor,
      success: r.status === "extracted",
    })),
    failedPages: pageMetadata.failedPages,
    extractedTextLength: extracted.text.length,
  });

  return {
    ...materialResult({
      extractedText: extracted.text,
      contentType: "pdf",
      processingNotes: notes,
      pageMetadata,
    }),
  };
}

async function extractAllPagesWithVision(
  buffer: Buffer,
  fileName: string,
  validateExtractedText?: (text: string) => boolean,
  progressCallback?: (progress: import("./backgroundJobs").ExtractionProgressDetail) => Promise<void>,
): Promise<{
  visionPagesQueued: number;
  visionPagesSucceeded: number;
  visionPagesFailed: number;
  extractedText: string;
  pageMetadata: StudyPageMetadata;
  extractionFailure?: StudyMaterialResult["extractionFailure"];
}> {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = source.getPageCount();
  const { batches } = await createVisionBatches(buffer, Array.from({ length: totalPages }, (_, i) => i + 1));

  const visionResults = await processVisionBatchesWithConcurrency(batches, fileName, progressCallback);

  const allVisionResults = new Map<number, { text: string; provider: "gemini" | "gemini-vision" | "nvidia-vision"; success: boolean; error?: string }>();
  let visionPagesSucceeded = 0;
  let visionPagesFailed = 0;
  let fallbackProviderUsed: "gemini-vision" | "nvidia-vision" | undefined;

  for (const result of visionResults) {
    for (const [pageNum, pageResult] of result.pageResults) {
      allVisionResults.set(pageNum, { ...pageResult, provider: result.provider });
      if (pageResult.success) visionPagesSucceeded++;
      else visionPagesFailed++;
    }
    if (!fallbackProviderUsed && result.provider === "nvidia-vision") {
      fallbackProviderUsed = "nvidia-vision";
    }
  }

  const nativeExtractions = Array.from({ length: totalPages }, (_, i) => ({
    pageNumber: i + 1,
    textLength: 0,
    readable: false,
  } as PdfPageExtraction));

  const pageRanges = buildPageRangesFromExtractions(nativeExtractions, allVisionResults);
  const failedPages = Array.from(allVisionResults.entries())
    .filter(([, v]) => !v.success)
    .map(([pageNum]) => pageNum);
  const readablePages = Array.from(allVisionResults.entries())
    .filter(([, v]) => v.success)
    .map(([pageNum]) => pageNum);

  const combinedText = cleanText(
    Array.from(allVisionResults.entries())
      .filter(([, v]) => v.success)
      .sort((a, b) => a[0] - b[0])
      .map(([pageNum, v]) => `[Page ${pageNum}]\n${v.text}`)
      .join("\n\n"),
  );

  const pageMetadata: StudyPageMetadata = {
    totalPages,
    extractedPageCount: visionPagesSucceeded,
    readablePages,
    failedPages,
    extractor: fallbackProviderUsed === "nvidia-vision" ? "nvidia-vision-batches" : "gemini-vision-batches",
    batchSize: PDF_VISION_BATCH_SIZE,
    pageRanges,
    visionPagesAttempted: totalPages,
    visionPagesSucceeded,
    visionPagesFailed,
    nativePagesSucceeded: 0,
    fallbackProviderUsed,
  };

  let extractionFailure: StudyMaterialResult["extractionFailure"] | undefined;
  if (visionPagesSucceeded === 0) {
    extractionFailure = { code: "unavailable", message: "Vision extraction failed for all pages." };
  } else if (visionPagesFailed > 0) {
    extractionFailure = { code: "insufficient", message: `${visionPagesFailed} of ${totalPages} pages could not be extracted.` };
  }

  const coverageValid = validateExtractedText ? validateExtractedText(combinedText) : true;
  if (!coverageValid && !extractionFailure) {
    extractionFailure = { code: "insufficient", message: "Full-module coverage validation failed after vision extraction." };
  }

  return { visionPagesQueued: totalPages, visionPagesSucceeded, visionPagesFailed, extractedText: combinedText, pageMetadata, extractionFailure };
}

async function extractProblematicPagesWithVision(
  buffer: Buffer,
  fileName: string,
  problematicPages: number[],
  nativeExtractions: PdfPageExtraction[],
  readableNativePages: number[],
  visionCompletedFromResume: Set<number>,
  validateExtractedText?: (text: string) => boolean,
  progressCallback?: (progress: import("./backgroundJobs").ExtractionProgressDetail) => Promise<void>,
): Promise<{
  visionPagesSucceeded: number;
  visionPagesFailed: number;
  extractedText: string;
  pageMetadata: StudyPageMetadata;
  extractionFailure?: StudyMaterialResult["extractionFailure"];
}> {
  if (problematicPages.length === 0) {
    const extracted = await extractPdfText(buffer);
    const pageMetadata: StudyPageMetadata = {
      totalPages: nativeExtractions.length,
      extractedPageCount: readableNativePages.length,
      readablePages: readableNativePages,
      failedPages: [],
      extractor: "pdfjs",
      pageRanges: buildPageRangesFromExtractions(nativeExtractions, new Map()),
      visionPagesAttempted: 0,
      visionPagesSucceeded: 0,
      visionPagesFailed: 0,
      nativePagesSucceeded: readableNativePages.length,
    };
    return { visionPagesSucceeded: 0, visionPagesFailed: 0, extractedText: extracted.text, pageMetadata };
  }

  const { totalPages, batches } = await createVisionBatches(buffer, problematicPages);

  const visionResults = await processVisionBatchesWithConcurrency(batches, fileName, progressCallback);

  const allVisionResults = new Map<number, { text: string; provider: "gemini" | "gemini-vision" | "nvidia-vision"; success: boolean; error?: string }>();
  let visionPagesSucceeded = 0;
  let visionPagesFailed = 0;
  let fallbackProviderUsed: "gemini-vision" | "nvidia-vision" | undefined;

  for (const result of visionResults) {
    for (const [pageNum, pageResult] of result.pageResults) {
      allVisionResults.set(pageNum, { ...pageResult, provider: result.provider });
      if (pageResult.success) visionPagesSucceeded++;
      else visionPagesFailed++;
    }
    if (!fallbackProviderUsed && result.provider === "nvidia-vision") {
      fallbackProviderUsed = "nvidia-vision";
    }
  }

  const pageRanges = buildPageRangesFromExtractions(nativeExtractions, allVisionResults);
  const failedPages = [
    ...Array.from(allVisionResults.entries())
      .filter(([, v]) => !v.success)
      .map(([pageNum]) => pageNum),
    ...nativeExtractions.filter((p) => !p.readable && !problematicPages.includes(p.pageNumber)).map((p) => p.pageNumber),
  ];
  const readablePages = [
    ...readableNativePages,
    ...Array.from(visionCompletedFromResume),
    ...Array.from(allVisionResults.entries())
      .filter(([, v]) => v.success)
      .map(([pageNum]) => pageNum),
  ].sort((a, b) => a - b);

  const nativeText = await extractPdfText(buffer);
  const nativeTextByPage = nativeText.pageExtractions.filter((p) => p.readable).reduce((acc, p) => {
    acc.set(p.pageNumber, p);
    return acc;
  }, new Map<number, PdfPageExtraction>());

  const nativeFullTextByPage = new Map<number, string>();
  const fullTextParts = nativeText.text.split(/\n\n/);
  for (const part of fullTextParts) {
    const match = part.match(/^\[Page\s+(\d+)\]\n([\s\S]*)$/);
    if (match) {
      nativeFullTextByPage.set(parseInt(match[1], 10), match[2]);
    }
  }

  const combinedParts: string[] = [];
  for (let pageNum = 1; pageNum <= nativeExtractions.length; pageNum++) {
    const visionResult = allVisionResults.get(pageNum);
    if (visionResult?.success) {
      combinedParts.push(`[Page ${pageNum}]\n${visionResult.text}`);
    } else if (nativeTextByPage.has(pageNum)) {
      const pageText = nativeTextByPage.get(pageNum)!;
      const pageContent = pageText.text ?? nativeFullTextByPage.get(pageNum) ?? "";
      combinedParts.push(`[Page ${pageNum}]\n${cleanText(pageContent)}`);
    } else {
      combinedParts.push(`[Page ${pageNum}]\n[No readable text detected]`);
    }
  }
  const combinedText = cleanText(combinedParts.join("\n\n"));

  const pageMetadata: StudyPageMetadata = {
    totalPages: nativeExtractions.length,
    extractedPageCount: readablePages.length,
    readablePages,
    failedPages,
    extractor: "mixed-native-vision",
    batchSize: PDF_VISION_BATCH_SIZE,
    pageRanges,
    visionPagesAttempted: problematicPages.length,
    visionPagesSucceeded,
    visionPagesFailed,
    nativePagesSucceeded: readableNativePages.length,
    fallbackProviderUsed,
  };

  let extractionFailure: StudyMaterialResult["extractionFailure"] | undefined;
  if (visionPagesFailed > 0) {
    extractionFailure = { code: "insufficient", message: `${visionPagesFailed} of ${problematicPages.length} vision pages could not be extracted.` };
  }

  const coverageValid = validateExtractedText ? validateExtractedText(combinedText) : true;
  if (!coverageValid && !extractionFailure) {
    extractionFailure = { code: "insufficient", message: "Full-module coverage validation failed after mixed extraction." };
  }

  if (progressCallback) {
    await progressCallback({
      stage: "vision-complete",
      totalPages: nativeExtractions.length,
      nativePagesProcessed: nativeExtractions.length,
      nativePagesReadable: readableNativePages.length,
      visionPagesQueued: 0,
      visionPagesCompleted: visionPagesSucceeded,
      visionPagesFailed,
      partialFailures: visionPagesFailed > 0 ? [`${visionPagesFailed} vision pages failed`] : [],
      completedPageRanges: pageRanges.map((r) => ({
        startPage: r.startPage,
        endPage: r.endPage,
        extractor: r.extractor,
        success: r.status === "extracted",
      })),
      failedPages,
      extractedTextLength: combinedText.length,
    });
  }

  return { visionPagesSucceeded, visionPagesFailed, extractedText: combinedText, pageMetadata, extractionFailure };
}

async function processDocx(buffer: Buffer): Promise<StudyMaterialResult> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) unsupportedFileType();

  const supportingXmlPaths = Object.keys(zip.files)
    .filter((name) => /^word\/(?:header|footer|footnotes|endnotes)\d*\.xml$/.test(name))
    .sort();
  const xmlParts = [documentXml];

  for (const xmlPath of supportingXmlPaths) {
    const xml = await zip.file(xmlPath)?.async("string");
    if (xml) xmlParts.push(xml);
  }

  const notes: string[] = [`DOCX document XML parsed (${supportingXmlPaths.length} supporting parts).`];
  const text = cleanText(xmlParts.map(stripXmlText).join("\n\n"));

  return {
    ...materialResult({ extractedText: text, contentType: "docx", processingNotes: notes }),
  };
}

async function processPptx(buffer: Buffer): Promise<StudyMaterialResult> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)\.xml/)?.[1] ?? 0) - Number(b.match(/slide(\d+)\.xml/)?.[1] ?? 0));

  const sections: string[] = [];
  const notes: string[] = [`PPTX slide count detected: ${slideFiles.length}.`];

  if (!slideFiles.length) unsupportedFileType();

  for (const slidePath of slideFiles) {
    try {
      const slideNumber = slidePath.match(/slide(\d+)\.xml/)?.[1] ?? "?";
      const xml = await zip.file(slidePath)?.async("string");
      const slideText = xml ? stripXmlText(xml) : "";
      const notesPath = `ppt/notesSlides/notesSlide${slideNumber}.xml`;
      const notesXml = await zip.file(notesPath)?.async("string");
      const speakerNotes = notesXml ? stripXmlText(notesXml) : "";
      const relPath = slidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
      const relXml = await zip.file(relPath)?.async("string");
      const hasMedia = Boolean(relXml?.includes("../media/") || xml?.includes("pic:pic") || xml?.includes("graphicFrame"));
      sections.push(
        `Slide ${slideNumber}:\n${slideText || "[No slide text detected]"}${speakerNotes ? `\nSpeaker notes: ${speakerNotes}` : ""}${hasMedia ? `\n[Slide ${slideNumber} image/chart detected]` : ""}`,
      );
    } catch (error) {
      notes.push(`A slide failed to parse and was skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  const text = cleanText(sections.join("\n\n"));
  return {
    ...materialResult({ extractedText: text, contentType: "pptx", processingNotes: notes }),
  };
}

async function processText(buffer: Buffer): Promise<StudyMaterialResult> {
  const text = cleanText(buffer.toString("utf8"));
  return {
    ...materialResult({ extractedText: text, contentType: "text", processingNotes: ["Text notes read directly."] }),
  };
}

async function processImage(buffer: Buffer, mimeType: string): Promise<StudyMaterialResult> {
  const text = cleanText(await explainImage(buffer, mimeType));
  return {
    ...materialResult({ extractedText: text, contentType: "image", processingNotes: ["Image explained with Gemini Vision server-side."] }),
  };
}

function isUnsafeZipPath(name: string) {
  return name.includes("..") || name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.includes("\\");
}

async function processZip(buffer: Buffer, userId: string): Promise<StudyMaterialResult> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const notes: string[] = [`ZIP entries found: ${entries.length}.`];
  const childFiles: ProcessedChildFile[] = [];
  const sections: string[] = [];

  if (entries.length > MAX_ZIP_FILES) {
    throw new Error("File too large for free-tier processing.");
  }

  let totalSize = 0;

  for (const entry of entries) {
    if (isUnsafeZipPath(entry.name)) {
      notes.push(`Skipped unsafe ZIP path: ${entry.name}`);
      continue;
    }

    const fileName = entry.name.split("/").pop() ?? entry.name;
    if (extname(fileName) === ".zip") {
      notes.push(`Skipped nested ZIP: ${fileName}`);
      continue;
    }

    if (isBlockedStudyFile(fileName)) {
      notes.push(`Rejected dangerous file inside ZIP: ${fileName}`);
      continue;
    }

    if (!isAllowedStudyFile(fileName)) {
      notes.push(`Skipped unsupported file inside ZIP: ${fileName}`);
      continue;
    }

    const data = Buffer.from(await entry.async("uint8array"));
    totalSize += data.length;
    if (totalSize > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new Error("File too large for free-tier processing.");
    }

    const result = await processStudyMaterial({
      buffer: data,
      fileName,
      mimeType: inferStudyMimeType(fileName),
      userId,
      allowZip: false,
    });

    if (result.extractedText) {
      sections.push(`File: ${fileName}\n${result.extractedText}`);
    }

    childFiles.push({
      fileName,
      contentType: result.contentType,
      extractedTextLength: result.extractedText.length,
      processingNotes: result.processingNotes,
    });
  }

  const text = cleanText(sections.join("\n\n---\n\n"));
  if (!text) {
    return {
      ...materialResult({
        extractedText: "",
        contentType: "zip",
        processingNotes: [...notes, "No supported study files found inside this ZIP."],
        childFiles,
      }),
    };
  }

  return {
    ...materialResult({ extractedText: text, contentType: "zip", processingNotes: notes, childFiles }),
  };
}

export async function processStudyMaterial({
  buffer,
  fileName,
  mimeType,
  userId,
  allowZip = true,
  validateExtractedText,
  resumeProgress,
  progressCallback,
}: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  userId: string;
  allowZip?: boolean;
  validateExtractedText?: (text: string) => boolean;
  resumeProgress?: import("./backgroundJobs").ExtractionProgressDetail | null;
  progressCallback?: (progress: import("./backgroundJobs").ExtractionProgressDetail) => Promise<void>;
}): Promise<StudyMaterialResult> {
  if (isBlockedStudyFile(fileName)) {
    throw new Error("Unsupported file type.");
  }

  const contentType = detectStudyContentType(fileName, mimeType);
  if (!contentType || !isAllowedStudyFile(fileName, mimeType)) {
    throw new Error("Unsupported file type.");
  }
  const safeMimeType = validateStudyMaterialBuffer(buffer, fileName, mimeType, contentType);

  if (contentType === "pdf") return processPdf(buffer, fileName, validateExtractedText, resumeProgress, progressCallback);
  if (contentType === "docx") return processDocx(buffer);
  if (contentType === "pptx") return processPptx(buffer);
  if (contentType === "text") return processText(buffer);
  if (contentType === "image") return processImage(buffer, safeMimeType);
  if (contentType === "zip") {
    if (!allowZip) {
      return {
        ...materialResult({ extractedText: "", contentType: "zip", processingNotes: ["Nested ZIP skipped."] }),
      };
    }
    return processZip(buffer, userId);
  }

  throw new Error("Unsupported file type.");
}
