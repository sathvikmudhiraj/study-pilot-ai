/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Buffer } from "node:buffer";

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    load: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/backend/lib/pdfText", () => ({
  extractPdfText: vi.fn(),
}));

vi.mock("@/backend/lib/aiProvider", () => ({
  extractWithVision: vi.fn(),
  isVisionAvailable: vi.fn(),
  getVisionUserMessage: vi.fn(),
}));

vi.mock("@/backend/lib/gemini", () => ({
  askGeminiWithInlineData: vi.fn(),
  getGeminiErrorCategory: vi.fn(),
}));

import { processStudyMaterial } from "@/backend/lib/studyMaterial";
import { extractPdfText } from "@/backend/lib/pdfText";
import { extractWithVision, isVisionAvailable, getVisionUserMessage } from "@/backend/lib/aiProvider";
import { askGeminiWithInlineData, getGeminiErrorCategory } from "@/backend/lib/gemini";
import { PDFDocument } from "pdf-lib";

describe("studyMaterial vision extraction", () => {
  const mockFileName = "test.pdf";
  const mockBuffer = Buffer.from("%PDF-1.4\nfake pdf content");
  const mockUserId = "user-123";

  beforeEach(() => {
    vi.clearAllMocks();
    (askGeminiWithInlineData as any).mockResolvedValue("[Page 1]\nVision content 1\n\n[Page 2]\nVision content 2");
    (extractWithVision as any).mockResolvedValue({
      text: "[Page 1]\nVision content 1\n\n[Page 2]\nVision content 2",
      provider: "gemini",
      model: "gemini-2.5-flash",
    });
    (isVisionAvailable as any).mockReturnValue({ gemini: true, nvidiaVision: true });
    (getGeminiErrorCategory as any).mockReturnValue("unknown");
    (getVisionUserMessage as any).mockReturnValue("Vision request failed. Please try again.");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  function setupPdfDocumentMock(pageCount: number) {
    (PDFDocument.load as any).mockResolvedValue({
      getPageCount: () => pageCount,
      copyPages: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(Buffer.from("batch")),
    });
    (PDFDocument.create as any).mockReturnValue({
      copyPages: vi.fn().mockResolvedValue([]),
      addPage: vi.fn(),
      save: vi.fn().mockResolvedValue(Buffer.from("batch")),
    });
  }

  describe("native PDF extraction success", () => {
    it("should use native extraction when all pages are readable and meet threshold", async () => {
      setupPdfDocumentMock(3);
      const mockExtractions = [
        { pageNumber: 1, textLength: 500, readable: true },
        { pageNumber: 2, textLength: 600, readable: true },
        { pageNumber: 3, textLength: 450, readable: true },
      ];

      const fullText = "[Page 1]\n" + "Content 1 ".repeat(50) + "\n\n[Page 2]\n" + "Content 2 ".repeat(60) + "\n\n[Page 3]\n" + "Content 3 ".repeat(45);

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 3,
        readableTextLength: 1550,
        readablePages: [1, 2, 3],
        failedPages: [],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
        validateExtractedText: (text) => text.length > 100,
      });

      expect(result.extractedText.length).toBeGreaterThan(100);
      expect(result.pageMetadata?.extractor).toBe("pdfjs");
      expect(result.pageMetadata?.visionPagesAttempted).toBe(0);
      expect(result.pageMetadata?.nativePagesSucceeded).toBe(3);
      expect(extractWithVision).not.toHaveBeenCalled();
    });

    it("should skip vision when native extraction meets quality threshold for large PDF", async () => {
      setupPdfDocumentMock(50);
      const mockExtractions = Array.from({ length: 50 }, (_, i) => ({
        pageNumber: i + 1,
        textLength: 200,
        readable: true,
      }));

      const fullText = Array.from({ length: 50 }, (_, i) => `[Page ${i + 1}]\n` + "Content ".repeat(20)).join("\n\n");

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 50,
        readableTextLength: 10000,
        readablePages: Array.from({ length: 50 }, (_, i) => i + 1),
        failedPages: [],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
      });

      expect(result.pageMetadata?.visionPagesAttempted).toBe(0);
      expect(result.pageMetadata?.nativePagesSucceeded).toBe(50);
      expect(extractWithVision).not.toHaveBeenCalled();
    });
  });

  describe("vision fallback for problematic pages", () => {
    it("should only use vision for pages that fail native extraction quality check", async () => {
      setupPdfDocumentMock(4);
      const mockExtractions = [
        { pageNumber: 1, textLength: 500, readable: true },
        { pageNumber: 2, textLength: 0, readable: false },
        { pageNumber: 3, textLength: 30, readable: false },
        { pageNumber: 4, textLength: 600, readable: true },
      ];

      const fullText = "[Page 1]\n" + "Content 1 ".repeat(50) + "\n\n[Page 2]\n[No readable text detected]\n\n[Page 3]\n[No readable text detected]\n\n[Page 4]\n" + "Content 4 ".repeat(60);

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 4,
        readableTextLength: 1100,
        readablePages: [1, 4],
        failedPages: [2, 3],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (askGeminiWithInlineData as any).mockResolvedValue("[Page 2]\nVision content 2\n\n[Page 3]\nVision content 3");

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
      });

      expect(result.pageMetadata?.visionPagesAttempted).toBe(2);
      expect(result.pageMetadata?.visionPagesSucceeded).toBe(2);
      expect(result.pageMetadata?.nativePagesSucceeded).toBe(2);
      expect(result.pageMetadata?.readablePages).toContain(1);
      expect(result.pageMetadata?.readablePages).toContain(4);
    });

    it("should use native text for readable pages and vision text for problematic pages", async () => {
      setupPdfDocumentMock(2);
      const mockExtractions = [
        { pageNumber: 1, textLength: 500, readable: true },
        { pageNumber: 2, textLength: 0, readable: false },
      ];

      const fullText = "[Page 1]\n" + "Native content ".repeat(50) + "\n\n[Page 2]\n[No readable text detected]";

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 2,
        readableTextLength: 500,
        readablePages: [1],
        failedPages: [2],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (askGeminiWithInlineData as any).mockResolvedValue("[Page 2]\nVision extracted content");

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
      });

      expect(result.extractedText).toContain("Native content");
      expect(result.extractedText).toContain("Vision extracted content");
      expect(result.pageMetadata?.pageRanges[0].extractor).toBe("native");
      expect(result.pageMetadata?.pageRanges[1].extractor).toBe("gemini-vision");
    });
  });

  describe("Gemini Vision -> NVIDIA Vision fallback", () => {
    it("should fall back to NVIDIA Vision when Gemini quota is exceeded", async () => {
      setupPdfDocumentMock(1);
      const mockExtractions = [
        { pageNumber: 1, textLength: 0, readable: false },
      ];

      const fullText = "[Page 1]\n[No readable text detected]";

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 1,
        readableTextLength: 0,
        readablePages: [],
        failedPages: [1],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (getGeminiErrorCategory as any).mockReturnValue("quota");
      (askGeminiWithInlineData as any).mockRejectedValue(new Error("Quota exceeded"));
      (extractWithVision as any).mockResolvedValue({
        text: "[Page 1]\nNVIDIA Vision content",
        provider: "nvidia-vision",
        model: "meta/llama-3.2-11b-vision-instruct",
      });

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
      });

      expect(result.pageMetadata?.fallbackProviderUsed).toBe("nvidia-vision");
      expect(result.pageMetadata?.pageRanges[0].extractor).toBe("nvidia-vision");
    });

    it("should fall back to NVIDIA Vision when Gemini times out", async () => {
      setupPdfDocumentMock(1);
      const mockExtractions = [
        { pageNumber: 1, textLength: 0, readable: false },
      ];

      const fullText = "[Page 1]\n[No readable text detected]";

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 1,
        readableTextLength: 0,
        readablePages: [],
        failedPages: [1],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (getGeminiErrorCategory as any).mockReturnValue("timeout");
      (askGeminiWithInlineData as any).mockRejectedValue(new Error("Timeout"));
      (extractWithVision as any).mockResolvedValue({
        text: "[Page 1]\nNVIDIA Vision content",
        provider: "nvidia-vision",
        model: "meta/llama-3.2-11b-vision-instruct",
      });

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
      });

      expect(result.pageMetadata?.fallbackProviderUsed).toBe("nvidia-vision");
    });

    it("should mark page as failed when both providers fail", async () => {
      setupPdfDocumentMock(1);
      const mockExtractions = [
        { pageNumber: 1, textLength: 0, readable: false },
      ];

      const fullText = "[Page 1]\n[No readable text detected]";

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 1,
        readableTextLength: 0,
        readablePages: [],
        failedPages: [1],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (getGeminiErrorCategory as any).mockReturnValue("quota");
      (askGeminiWithInlineData as any).mockRejectedValue(new Error("Quota exceeded"));
      (extractWithVision as any).mockRejectedValue(new Error("Both vision providers failed"));

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
      });

      expect(result.pageMetadata?.failedPages).toContain(1);
      expect(result.pageMetadata?.visionPagesFailed).toBe(1);
      expect(result.extractionFailure).toBeDefined();
    });
  });

  describe("resume support", () => {
    it("should skip already completed pages on resume", async () => {
      setupPdfDocumentMock(3);
      const mockExtractions = [
        { pageNumber: 1, textLength: 500, readable: true },
        { pageNumber: 2, textLength: 0, readable: false },
        { pageNumber: 3, textLength: 0, readable: false },
      ];

      const fullText = "[Page 1]\n" + "Content 1 ".repeat(50) + "\n\n[Page 2]\n[No readable text detected]\n\n[Page 3]\n[No readable text detected]";

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 3,
        readableTextLength: 500,
        readablePages: [1],
        failedPages: [2, 3],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (askGeminiWithInlineData as any).mockResolvedValue("[Page 3]\nVision content 3");

      const resumeProgress = {
        stage: "vision-processing" as const,
        totalPages: 3,
        nativePagesProcessed: 3,
        nativePagesReadable: 1,
        visionPagesQueued: 1,
        visionPagesCompleted: 1,
        visionPagesFailed: 0,
        completedPageRanges: [
          { startPage: 1, endPage: 1, extractor: "native", success: true },
          { startPage: 2, endPage: 2, extractor: "gemini-vision", success: true },
        ],
        failedPages: [],
        partialFailures: [],
      };

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
        resumeProgress,
      });

      expect(result.pageMetadata?.nativePagesSucceeded).toBe(1);
      expect(result.pageMetadata?.visionPagesAttempted).toBe(1);
      expect(result.pageMetadata?.readablePages).toContain(1);
      expect(result.pageMetadata?.readablePages).toContain(2);
      expect(result.pageMetadata?.readablePages).toContain(3);
    });
  });

  describe("large PDF handling", () => {
    it("should only process problematic pages with vision for large PDFs", async () => {
      setupPdfDocumentMock(1000);
      const mockExtractions = Array.from({ length: 1000 }, (_, i) => ({
        pageNumber: i + 1,
        textLength: i < 980 ? 500 : 0,
        readable: i < 980,
      }));

      const fullText = Array.from({ length: 1000 }, (_, i) =>
        `[Page ${i + 1}]\n${i < 980 ? "Content ".repeat(50) : "[No readable text detected]"}`
      ).join("\n\n");

      (extractPdfText as any).mockResolvedValue({
        text: fullText,
        pages: 1000,
        readableTextLength: 980 * 500,
        readablePages: Array.from({ length: 980 }, (_, i) => i + 1),
        failedPages: Array.from({ length: 20 }, (_, i) => 981 + i),
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (askGeminiWithInlineData as any).mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => `[Page ${981 + i}]\nVision content`).join("\n\n")
      );

      const result = await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
      });

      expect(result.pageMetadata?.visionPagesAttempted).toBe(20);
      expect(result.pageMetadata?.nativePagesSucceeded).toBe(980);
      expect(result.pageMetadata?.totalPages).toBe(1000);
      expect(result.pageMetadata?.extractedPageCount).toBe(1000);
    });
  });

  describe("progress reporting", () => {
    it("should report progress through callback", async () => {
      setupPdfDocumentMock(1);
      const mockExtractions = [
        { pageNumber: 1, textLength: 0, readable: false },
      ];

      (extractPdfText as any).mockResolvedValue({
        text: "[Page 1]\n[No readable text detected]",
        pages: 1,
        readableTextLength: 0,
        readablePages: [],
        failedPages: [1],
        pageExtractions: mockExtractions,
        extractor: "pdfjs",
      });

      (askGeminiWithInlineData as any).mockResolvedValue("[Page 1]\nVision content");

      const progressReports: any[] = [];
      const progressCallback = vi.fn(async (progress) => {
        progressReports.push(progress);
      });

      await processStudyMaterial({
        buffer: mockBuffer,
        fileName: mockFileName,
        mimeType: "application/pdf",
        userId: mockUserId,
        progressCallback,
      });

      expect(progressReports.length).toBeGreaterThan(0);
      const stages = progressReports.map((r) => r.stage);
      expect(stages).toContain("native-extraction");
      expect(stages).toContain("vision-queue");
      expect(stages).toContain("vision-processing");
      expect(stages).toContain("vision-complete");
    });
  });
});
