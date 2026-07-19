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
import { extractPdfText } from "./pdfText";
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
  status: "extracted" | "empty" | "failed";
  extractor: "pdfjs" | "pdf-parse" | "gemini-vision";
};

export type StudyPageMetadata = {
  totalPages: number;
  extractedPageCount: number;
  readablePages: number[];
  failedPages: number[];
  extractor: "pdfjs" | "pdf-parse" | "gemini-vision-batches";
  batchSize?: number;
  pageRanges: StudyPageRangeMetadata[];
};

const MAX_ZIP_FILES = 20;
const MAX_ZIP_UNCOMPRESSED_BYTES = 60 * 1024 * 1024;
const MIN_READABLE_TEXT_LENGTH = 40;
const TEXT_SAMPLE_BYTES = 64 * 1024;
const PDF_VISION_BATCH_SIZE = 8;
const PDF_VISION_BATCH_CONCURRENCY = 2;
const PDF_VISION_MAX_OUTPUT_TOKENS = 4096;
const PDF_VISION_TIMEOUT_MS = 45_000;
const MIN_VISION_BATCH_TEXT_LENGTH = 80;

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
        fallbackUsed: pageMetadata?.extractor === "gemini-vision-batches",
        partialFailures: extractionFailure ? [extractionFailure.message] : [],
      }),
    }),
    ...(extractionFailure ? { extractionFailure } : {}),
    ...(childFiles ? { childFiles } : {}),
  };
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

type PdfVisionBatch = {
  startPage: number;
  endPage: number;
  data: Buffer;
};

type PdfVisionResult = {
  ok: boolean;
  text: string;
  processingNotes: string[];
  pageMetadata: StudyPageMetadata;
  failure?: StudyMaterialResult["extractionFailure"];
};

function sanitizedVisionFailure(error: unknown): NonNullable<StudyMaterialResult["extractionFailure"]> {
  const category = getGeminiErrorCategory(error);

  if (category === "quota") {
    return { code: "quota", message: "Gemini quota was reached during PDF extraction." };
  }
  if (category === "model") {
    return { code: "model", message: "The configured Gemini model does not support PDF extraction." };
  }
  if (category === "timeout" || category === "busy") {
    return { code: "timeout", message: "Gemini PDF extraction timed out or is temporarily busy." };
  }
  if (category === "config" || category === "auth") {
    return { code: "unavailable", message: "Gemini vision is not configured for PDF extraction." };
  }

  return { code: "unavailable", message: "Gemini could not extract this PDF batch." };
}

async function createPdfVisionBatches(buffer: Buffer): Promise<{ totalPages: number; batches: PdfVisionBatch[] }> {
  const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = source.getPageCount();
  const batches: PdfVisionBatch[] = [];

  for (let startPage = 1; startPage <= totalPages; startPage += PDF_VISION_BATCH_SIZE) {
    const endPage = Math.min(startPage + PDF_VISION_BATCH_SIZE - 1, totalPages);
    const batchDocument = await PDFDocument.create();
    const pageIndexes = Array.from({ length: endPage - startPage + 1 }, (_, index) => startPage - 1 + index);
    const copiedPages = await batchDocument.copyPages(source, pageIndexes);
    copiedPages.forEach((page) => batchDocument.addPage(page));
    const bytes = await batchDocument.save({ useObjectStreams: true, addDefaultPage: false });
    batches.push({ startPage, endPage, data: Buffer.from(bytes) });
  }

  return { totalPages, batches };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function extractPdfWithVisionBatches(buffer: Buffer, fileName: string): Promise<PdfVisionResult> {
  let prepared: Awaited<ReturnType<typeof createPdfVisionBatches>>;

  try {
    prepared = await createPdfVisionBatches(buffer);
  } catch (error) {
    devLog("pdf batch preparation failed", {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    });
    const failure = sanitizedVisionFailure(error);
    return {
      ok: false,
      text: "",
      processingNotes: [failure.message],
      pageMetadata: {
        totalPages: 0,
        extractedPageCount: 0,
        readablePages: [],
        failedPages: [],
        extractor: "gemini-vision-batches",
        batchSize: PDF_VISION_BATCH_SIZE,
        pageRanges: [],
      },
      failure,
    };
  }

  devLog("pdf vision batching started", {
    fileName,
    totalPages: prepared.totalPages,
    batchSize: PDF_VISION_BATCH_SIZE,
    batchCount: prepared.batches.length,
  });

  const batchResults = await mapWithConcurrency(prepared.batches, PDF_VISION_BATCH_CONCURRENCY, async (batch) => {
    try {
      const rawText = await askGeminiWithInlineData({
        prompt: `${STUDYPILOT_TUTOR_INSTRUCTION}

This PDF contains original document pages ${batch.startPage}-${batch.endPage}.
Extract the study content from every page in this batch. Do not summarize, skip later pages, or focus on only one topic.
Label content with the original page markers [Page ${batch.startPage}] through [Page ${batch.endPage}].
Preserve headings, definitions, formulas, examples, cipher steps, tables, and diagram meaning.
If a page has no readable study content, write its page marker followed by [No readable text detected].
Return plain text only.`,
        mimeType: "application/pdf",
        data: batch.data,
        maxOutputTokens: PDF_VISION_MAX_OUTPUT_TOKENS,
        timeoutMs: PDF_VISION_TIMEOUT_MS,
      });
      const text = cleanText(rawText);

      if (text.length < MIN_VISION_BATCH_TEXT_LENGTH) {
        return {
          batch,
          text: "",
          failure: {
            code: "insufficient" as const,
            message: `Gemini returned insufficient text for PDF pages ${batch.startPage}-${batch.endPage}.`,
          },
        };
      }

      return { batch, text, failure: null };
    } catch (error) {
      const failure = sanitizedVisionFailure(error);
      devLog("pdf vision batch failed", {
        fileName,
        startPage: batch.startPage,
        endPage: batch.endPage,
        category: failure.code,
      });
      return { batch, text: "", failure };
    }
  });

  const pageRanges: StudyPageRangeMetadata[] = batchResults.map(({ batch, text, failure }) => ({
    startPage: batch.startPage,
    endPage: batch.endPage,
    textLength: text.length,
    status: failure ? "failed" : text ? "extracted" : "empty",
    extractor: "gemini-vision",
  }));
  const failedResults = batchResults.filter((result) => result.failure);
  const successfulResults = batchResults.filter((result) => !result.failure && result.text);
  const extractedPageCount = successfulResults.reduce(
    (total, result) => total + (result.batch.endPage - result.batch.startPage + 1),
    0,
  );
  const failedPages = failedResults.flatMap((result) =>
    Array.from({ length: result.batch.endPage - result.batch.startPage + 1 }, (_, index) => result.batch.startPage + index),
  );
  const combinedText = cleanText(
    successfulResults
      .map((result) => `[Page range ${result.batch.startPage}-${result.batch.endPage}]\n${result.text}`)
      .join("\n\n"),
  );
  const pageMetadata: StudyPageMetadata = {
    totalPages: prepared.totalPages,
    extractedPageCount,
    readablePages: [],
    failedPages,
    extractor: "gemini-vision-batches",
    batchSize: PDF_VISION_BATCH_SIZE,
    pageRanges,
  };

  if (failedResults.length) {
    const firstFailure = failedResults[0].failure ?? {
      code: "unavailable" as const,
      message: "Gemini could not extract every PDF page batch.",
    };
    return {
      ok: false,
      text: combinedText,
      processingNotes: [
        `PDF vision extraction completed ${successfulResults.length} of ${batchResults.length} page batches.`,
        firstFailure.message,
      ],
      pageMetadata,
      failure: firstFailure,
    };
  }

  if (combinedText.length < expectedMinVisionText(prepared.totalPages)) {
    const failure = {
      code: "insufficient" as const,
      message: "Gemini PDF extraction completed, but the combined text was insufficient.",
    };
    return {
      ok: false,
      text: combinedText,
      processingNotes: [failure.message],
      pageMetadata,
      failure,
    };
  }

  return {
    ok: true,
    text: combinedText,
    processingNotes: [
      `AI vision processed all ${prepared.totalPages} PDF pages in ${prepared.batches.length} batches of up to ${PDF_VISION_BATCH_SIZE} pages.`,
      `AI vision extraction produced ${combinedText.length} characters of combined study content.`,
    ],
    pageMetadata,
  };
}

async function processPdf(
  buffer: Buffer,
  fileName: string,
  validateExtractedText?: (text: string) => boolean,
): Promise<StudyMaterialResult> {
  const notes: string[] = [];
  let standardMetadata: StudyPageMetadata | undefined;

  try {
    const extracted = await extractPdfText(buffer);
    standardMetadata = {
      totalPages: extracted.pages,
      extractedPageCount: extracted.readablePages.length,
      readablePages: extracted.readablePages,
      failedPages: extracted.failedPages,
      extractor: extracted.extractor,
      pageRanges: extracted.pageExtractions.map((page) => ({
        startPage: page.pageNumber,
        endPage: page.pageNumber,
        textLength: page.textLength,
        status: page.readable ? "extracted" : extracted.failedPages.includes(page.pageNumber) ? "failed" : "empty",
        extractor: extracted.extractor,
      })),
    };
    devLog("pdf extractor used", {
      fileName,
      extractor: extracted.extractor,
      pages: extracted.pages,
      readablePages: extracted.readablePages.length,
      failedPages: extracted.failedPages.length,
      textLength: extracted.readableTextLength,
      threshold: expectedMinPdfText(buffer.length, extracted.pages),
    });

    const required = expectedMinPdfText(buffer.length, extracted.pages);
    const coverageValid = validateExtractedText ? validateExtractedText(extracted.text) : true;

    if (extracted.readableTextLength >= required && coverageValid) {
      notes.push(
        `Standard PDF extraction processed all ${extracted.pages} pages; ${extracted.readablePages.length} pages contained readable text.`,
      );
      notes.push(`PDF text extraction produced ${extracted.readableTextLength} characters using ${extracted.extractor}.`);
      return {
        ...materialResult({
          extractedText: extracted.text,
          contentType: "pdf",
          processingNotes: notes,
          pageMetadata: standardMetadata,
        }),
      };
    }

    notes.push(
      coverageValid
        ? `Standard PDF extraction found ${extracted.readableTextLength} characters across ${extracted.readablePages.length} of ${extracted.pages} pages; AI vision batching was required.`
        : "Standard PDF extraction did not cover the full module, so StudyPilot used page-batched AI vision extraction.",
    );
  } catch (error) {
    devLog("standard pdf extraction failed", {
      fileName,
      error: error instanceof Error ? error.message : String(error),
    });
    notes.push("Standard PDF text extraction was limited, so StudyPilot used AI vision fallback.");
  }

  const vision = await extractPdfWithVisionBatches(buffer, fileName);
  if (vision.ok) {
    const coverageValid = validateExtractedText ? validateExtractedText(vision.text) : true;
    if (!coverageValid) {
      const failure = {
        code: "insufficient" as const,
        message: "Full-module coverage validation failed after page-batched PDF extraction.",
      };
      return {
        ...materialResult({
          extractedText: "",
          contentType: "pdf",
          processingNotes: Array.from(new Set([...notes, ...vision.processingNotes, failure.message])),
          pageMetadata: vision.pageMetadata,
          extractionFailure: failure,
        }),
      };
    }

    return {
      ...materialResult({
        extractedText: vision.text,
        contentType: "pdf",
        processingNotes: [...notes, ...vision.processingNotes],
        pageMetadata: vision.pageMetadata,
      }),
    };
  }

  const failure = vision.failure ?? {
    code: "insufficient" as const,
    message: "No readable text was produced by fresh PDF extraction.",
  };

  return {
    ...materialResult({
      extractedText: "",
      contentType: "pdf",
      processingNotes: Array.from(new Set([...notes, ...vision.processingNotes, failure.message])),
      pageMetadata: vision.pageMetadata.totalPages ? vision.pageMetadata : standardMetadata,
      extractionFailure: failure,
    }),
  };
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
}: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  userId: string;
  allowZip?: boolean;
  validateExtractedText?: (text: string) => boolean;
}): Promise<StudyMaterialResult> {
  if (isBlockedStudyFile(fileName)) {
    throw new Error("Unsupported file type.");
  }

  const contentType = detectStudyContentType(fileName, mimeType);
  if (!contentType || !isAllowedStudyFile(fileName, mimeType)) {
    throw new Error("Unsupported file type.");
  }
  const safeMimeType = validateStudyMaterialBuffer(buffer, fileName, mimeType, contentType);

  if (contentType === "pdf") return processPdf(buffer, fileName, validateExtractedText);
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
