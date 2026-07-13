import "server-only";

import { open, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export type PdfPageExtraction = {
  pageNumber: number;
  textLength: number;
  readable: boolean;
};

export type PdfExtractionResult = {
  text: string;
  pages: number;
  readableTextLength: number;
  readablePages: number[];
  failedPages: number[];
  pageExtractions: PdfPageExtraction[];
  extractor: "pdfjs" | "pdf-parse";
};

function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[pdfText] ${message}`, details ?? "");
}

async function readWorkerVersion(workerPath: string) {
  const handle = await open(workerPath, "r");

  try {
    const header = Buffer.alloc(2048);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return header.subarray(0, bytesRead).toString("utf8").match(/pdfjsVersion\s*=\s*([0-9.]+)/)?.[1] ?? "";
  } finally {
    await handle.close();
  }
}

async function installedWorkerUrl({
  extractor,
  workerPath,
  expectedVersion,
}: {
  extractor: "pdfjs" | "pdf-parse";
  workerPath: string;
  expectedVersion: string;
}) {
  const workerVersion = await readWorkerVersion(workerPath);

  if (!workerVersion || workerVersion !== expectedVersion) {
    throw new Error(
      `${extractor} worker version mismatch: expected ${expectedVersion || "unknown"}, received ${workerVersion || "unknown"}.`,
    );
  }

  devLog("worker configured", { extractor, apiVersion: expectedVersion, workerVersion });
  return pathToFileURL(workerPath).href;
}

async function pdfParsePdfJsVersion() {
  const packagePath = resolve(process.cwd(), "node_modules", "pdf-parse", "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return packageJson.dependencies?.["pdfjs-dist"] ?? "";
}

async function extractWithPdfJs(buffer: Buffer): Promise<PdfExtractionResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = await installedWorkerUrl({
    extractor: "pdfjs",
    workerPath: resolve(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
    expectedVersion: pdfjs.version,
  });

  const data = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data,
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const document = await loadingTask.promise;
  const pageSections: string[] = [];
  const readablePages: number[] = [];
  const failedPages: number[] = [];
  const pageExtractions: PdfPageExtraction[] = [];
  const pageCount = document.numPages;

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      let page: Awaited<ReturnType<typeof document.getPage>> | null = null;

      try {
        page = await document.getPage(pageNumber);
        const content = await page.getTextContent({ includeMarkedContent: false });
        const pageText = normalizeText(
          content.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean)
            .join(" "),
        );
        const readable = Boolean(pageText);

        if (readable) readablePages.push(pageNumber);
        pageExtractions.push({ pageNumber, textLength: pageText.length, readable });
        pageSections.push(`[Page ${pageNumber}]\n${pageText || "[No readable text detected]"}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "page extraction failed";
        failedPages.push(pageNumber);
        pageExtractions.push({ pageNumber, textLength: 0, readable: false });
        pageSections.push(`[Page ${pageNumber}]\n[Text extraction unavailable]`);
        devLog("page extraction failed", { extractor: "pdfjs", pageNumber, error: message });
      } finally {
        page?.cleanup();
      }
    }
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }

  return {
    text: normalizeText(pageSections.join("\n\n")),
    pages: pageCount,
    readableTextLength: pageExtractions.reduce((total, page) => total + page.textLength, 0),
    readablePages,
    failedPages,
    pageExtractions,
    extractor: "pdfjs",
  };
}

async function extractWithPdfParse(buffer: Buffer): Promise<PdfExtractionResult> {
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(await installedWorkerUrl({
    extractor: "pdf-parse",
    workerPath: resolve(process.cwd(), "node_modules", "pdf-parse", "dist", "worker", "pdf.worker.mjs"),
    expectedVersion: await pdfParsePdfJsVersion(),
  }));
  const parser = new PDFParse({ data: buffer });

  try {
    const parsed = await parser.getText();
    const pageExtractions = parsed.pages.map((page) => {
      const pageText = normalizeText(page.text);
      return {
        pageNumber: page.num,
        textLength: pageText.length,
        readable: Boolean(pageText),
      };
    });
    const pageSections = parsed.pages.map((page) => {
      const pageText = normalizeText(page.text);
      return `[Page ${page.num}]\n${pageText || "[No readable text detected]"}`;
    });

    return {
      text: normalizeText(pageSections.join("\n\n")),
      pages: parsed.total,
      readableTextLength: pageExtractions.reduce((total, page) => total + page.textLength, 0),
      readablePages: pageExtractions.filter((page) => page.readable).map((page) => page.pageNumber),
      failedPages: [],
      pageExtractions,
      extractor: "pdf-parse",
    };
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfText(buffer: Buffer): Promise<PdfExtractionResult> {
  const errors: string[] = [];
  const candidates: PdfExtractionResult[] = [];

  try {
    const result = await extractWithPdfJs(buffer);
    candidates.push(result);
    devLog("extractor finished", {
      extractor: result.extractor,
      pages: result.pages,
      readablePages: result.readablePages.length,
      failedPages: result.failedPages.length,
      zeroTextPages: result.pageExtractions.filter((page) => !page.readable && !result.failedPages.includes(page.pageNumber)).map((page) => page.pageNumber),
      textLength: result.readableTextLength,
    });
    const strongTextLength = Math.max(40, Math.min(result.pages * 150, 6000));
    if (result.readableTextLength >= strongTextLength && result.failedPages.length === 0) {
      devLog("standard extraction accepted", {
        extractor: result.extractor,
        pages: result.pages,
        readablePages: result.readablePages.length,
        textLength: result.readableTextLength,
        visionFallbackNeeded: false,
      });
      return result;
    }
    if (result.readableTextLength < 40) errors.push("pdfjs returned little or no text");
  } catch (error) {
    const message = error instanceof Error ? error.message : "pdfjs failed";
    devLog("extractor failed", { extractor: "pdfjs", error: message });
    errors.push(message);
  }

  try {
    const result = await extractWithPdfParse(buffer);
    candidates.push(result);
    devLog("extractor finished", {
      extractor: result.extractor,
      pages: result.pages,
      readablePages: result.readablePages.length,
      failedPages: result.failedPages.length,
      zeroTextPages: result.pageExtractions.filter((page) => !page.readable).map((page) => page.pageNumber),
      textLength: result.readableTextLength,
    });
    if (result.readableTextLength < 40) errors.push("pdf-parse returned little or no text");
  } catch (error) {
    const message = error instanceof Error ? error.message : "pdf-parse failed";
    devLog("extractor failed", { extractor: "pdf-parse", error: message });
    errors.push(message);
  }

  const best = candidates.sort((left, right) => right.readableTextLength - left.readableTextLength)[0];
  if (best?.readableTextLength >= 40) {
    devLog("best standard extractor selected", {
      extractor: best.extractor,
      pages: best.pages,
      readablePages: best.readablePages.length,
      failedPages: best.failedPages.length,
      zeroTextPages: best.pageExtractions.filter((page) => !page.readable && !best.failedPages.includes(page.pageNumber)).map((page) => page.pageNumber),
      textLength: best.readableTextLength,
      visionFallbackNeeded: false,
    });
    return best;
  }

  devLog("standard extraction unavailable", {
    extractor: "none",
    pages: 0,
    readablePages: 0,
    failedPages: [],
    zeroTextPages: [],
    textLength: 0,
    visionFallbackNeeded: true,
  });

  throw new Error(`PDF text extraction failed: ${errors.join(" | ")}`);
}

export function estimateChunks(text: string) {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return Math.max(1, Math.ceil(cleaned.length / 12000));
}
