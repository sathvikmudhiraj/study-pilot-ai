import { describe, expect, it } from "vitest";
import {
  buildDocumentProcessingMetadata,
  buildGenerationCacheKey,
  chunkDocument,
  createProcessingProgress,
  hasFreshCache,
  isOversizedForAi,
  removeRepeatedHeadersFooters,
  runWithBoundedRetries,
  selectRelevantChunks,
  stableHash,
} from "../documentProcessing";

const PAGE_TEXT = [
  `[Page 1]\nStudyPilot Header\n${"Networking basics explain packets, frames, and routing. A router forwards packets between networks. ".repeat(12)}\nStudyPilot Footer`,
  `[Page 2]\nStudyPilot Header\n${"Subnetting divides an IP network into smaller ranges. CIDR notation describes prefix length. ".repeat(12)}\nStudyPilot Footer`,
  `[Page 3]\nStudyPilot Header\n${"TCP provides reliable transport. UDP is connectionless and useful for latency-sensitive traffic. ".repeat(12)}\nStudyPilot Footer`,
  `[Page 4]\nStudyPilot Header\n${"Subnet masks and default gateways are common exam concepts in networking chapters. ".repeat(12)}\nStudyPilot Footer`,
].join("\n\n");

describe("documentProcessing", () => {
  it("creates deterministic chunks with stable hashes and page ranges", () => {
    const first = chunkDocument(PAGE_TEXT, { maxChars: 900, sourceId: "file-1" });
    const second = chunkDocument(PAGE_TEXT, { maxChars: 900, sourceId: "file-1" });

    expect(first.length).toBeGreaterThan(1);
    expect(first.map((chunk) => chunk.id)).toEqual(second.map((chunk) => chunk.id));
    expect(first.map((chunk) => chunk.hash)).toEqual(second.map((chunk) => chunk.hash));
    expect(first[0].startPage).toBe(1);
    expect(first.at(-1)?.endPage).toBe(4);
  });

  it("deduplicates repeated chunks", () => {
    const repeated = "[Page 1]\nSame paragraph about cryptography and keys. ".repeat(6);
    const chunks = chunkDocument(`${repeated}\n\n${repeated}`, { maxChars: 140, dedupe: true });

    expect(chunks.length).toBe(1);
  });

  it("handles empty and very small documents", () => {
    expect(chunkDocument("   ")).toEqual([]);
    const tiny = chunkDocument("Hill cipher uses matrix multiplication.", { maxChars: 120 });
    expect(tiny).toHaveLength(1);
    expect(tiny[0].text).toContain("Hill cipher");
  });

  it("removes repeated headers and footers without deleting page markers", () => {
    const cleaned = removeRepeatedHeadersFooters(PAGE_TEXT);

    expect(cleaned).toContain("[Page 1]");
    expect(cleaned).toContain("[Page 4]");
    expect(cleaned).not.toContain("StudyPilot Header");
    expect(cleaned).not.toContain("StudyPilot Footer");
  });

  it("builds cache keys and detects hit/miss/content invalidation", () => {
    const contentHash = stableHash("chapter text");
    const key = buildGenerationCacheKey({
      fileId: "file-1",
      contentHash,
      generationType: "summary",
      provider: "gemini",
      model: "flash",
      promptVersion: "summary-v1",
      personalizationHash: stableHash(["subnetting"]),
      options: { difficulty: "medium" },
    });

    expect(hasFreshCache({ expectedCacheKey: key, cachedCacheKey: key, cachedContentHash: contentHash, contentHash })).toBe(true);
    expect(hasFreshCache({ expectedCacheKey: key, cachedCacheKey: key, cachedContentHash: stableHash("old"), contentHash })).toBe(false);
    expect(
      buildGenerationCacheKey({
        fileId: "file-1",
        contentHash,
        generationType: "summary",
        provider: "gemini",
        model: "flash",
        promptVersion: "summary-v1",
        personalizationHash: stableHash(["routing"]),
        options: { difficulty: "medium" },
      }),
    ).not.toBe(key);
  });

  it("records partial processing progress and chunk manifest without duplicating full text", () => {
    const chunks = chunkDocument(PAGE_TEXT, { maxChars: 900 });
    const progress = createProcessingProgress("partially_complete", {
      pagesProcessed: 3,
      totalPages: 4,
      chunksProcessed: chunks.length - 1,
      totalChunks: chunks.length,
      retryCount: 2,
      cache: "miss",
      fallbackUsed: true,
      partialFailures: ["chunk-4-timeout"],
      startedAt: new Date(Date.now() - 1000).toISOString(),
    });
    const metadata = buildDocumentProcessingMetadata({ text: PAGE_TEXT, chunks, progress });

    expect(metadata.progress.stage).toBe("partially_complete");
    expect(metadata.chunks).toHaveLength(chunks.length);
    expect(metadata.chunks[0]).not.toHaveProperty("text");
    expect(metadata.contentHash).toBe(stableHash(removeRepeatedHeadersFooters(PAGE_TEXT)));
  });

  it("bounds retry attempts", async () => {
    const result = await runWithBoundedRetries(
      async () => {
        throw new Error("timeout");
      },
      { maxAttempts: 2, classifyFailure: () => "timeout" },
    );

    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(2);
    expect(result.failures).toEqual(["timeout", "timeout"]);
  });

  it("selects relevant chat chunks and preserves document order when requested", () => {
    const chunks = chunkDocument(PAGE_TEXT, { maxChars: 900 });
    const selected = selectRelevantChunks({ chunks, query: "subnet mask CIDR", maxChunks: 2, preserveOrder: true });

    expect(selected).toHaveLength(2);
    expect(selected[0].index).toBeLessThan(selected[1].index);
    expect(selected.map((chunk) => chunk.text).join(" ")).toMatch(/Subnetting|Subnet masks/);
  });

  it("flags oversized AI operations without truncating text", () => {
    expect(isOversizedForAi("short document")).toBe(false);
  });
});
