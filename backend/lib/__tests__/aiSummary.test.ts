import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` is a Next.js-only side-effect import that throws when used in
// a client bundle. Vitest loads source as plain TS, so we map it to a no-op
// module before aiSummary.ts ever evaluates.
vi.mock("server-only", () => ({}));

// Stub the AI provider and the tutor prompt so the test has zero network and
// zero env-var dependencies. The mock factory returns a function the test
// overrides per-case via mockImplementation.
let mockGenerator: ((prompt: string) => Promise<string>) | null = null;

vi.mock("../aiProvider", () => ({
  generateSummaryAIText: vi.fn((prompt: string) => {
    if (mockGenerator) return mockGenerator(prompt);
    return Promise.resolve("{}");
  }),
  isAiBusyError: vi.fn((e: unknown) => e instanceof Error && /busy/.test(e.message)),
  isAiQuotaError: vi.fn((e: unknown) => e instanceof Error && /quota/.test(e.message)),
  isAiTimeoutError: vi.fn((e: unknown) => e instanceof Error && /timeout/.test(e.message)),
}));

vi.mock("../tutorPrompt", () => ({
  STUDYPILOT_TUTOR_INSTRUCTION: "TUTOR",
}));

import { summarizeStudyText } from "../aiSummary";

// ----- Synthetic CNS-Module-1 source text -----
// Three logical sections spread across three 12000-char-ish chunks. Each
// section is intentionally topic-disjoint so we can detect which chunks got
// through to the merged synthesis. We build a single big string of ~29,510
// chars, matching the user's reported extraction size.

function longText(seed: string, repeats: number): string {
  // `${seed}. `. repeated; ~120 chars per seed line.
  return `${seed}. `.repeat(repeats);
}

// Tune repeats so each section is below MAX_CHUNK_CHARS (12000) but high
// enough that the segmenter produces 3 chunks across the full source (~29k
// chars, matching the user-reported 29,510).
const CHUNK1_TEXT = `[Page 1] Introduction\n${longText(
  "cryptography plaintext ciphertext encryption decryption key CIA triad confidentiality OSI security architecture",
  80,
)}
[Page 26] Caesar cipher\n${longText("Caesar cipher symmetric cipher model cryptanalysis brute force", 8)}`;

const CHUNK2_TEXT = `[Page 27] Monoalphabetic\n${longText(
  "monoalphabetic cipher security attack active attack passive attack security service security mechanism",
  100,
)}
[Page 52] Playfair cipher\n${longText("Playfair cipher monoalphabetic cipher symmetric cipher model", 8)}`;

const CHUNK3_TEXT = `[Page 53] Hill cipher\n${longText(
  "Hill cipher modulo 26 multiplicative inverse",
  100,
)}
[Page 59] End of module`;

// Concatenate to roughly 29500 characters; the segmenter includes the whole
// thing, so chunks.length will be 3 for the summarizeStudyText call.
const CNS_SOURCE = `${CHUNK1_TEXT}\n\n${CHUNK2_TEXT}\n\n${CHUNK3_TEXT}`;

function chunkMapJson(chunkNumber: number, chunkTotal: number, topics: string[]) {
  return JSON.stringify({
    chunk_number: chunkNumber,
    chunk_total: chunkTotal,
    heading: `Chunk ${chunkNumber}`,
    topics,
    important_points: topics.map((t) => `${t} point`),
    exam_focus_points: topics.slice(0, 2),
    important_concepts: topics,
    memory_lines: [],
    common_mistakes: [],
  });
}

function synthesisJson(coveredTopics: string[]) {
  return JSON.stringify({
    suggested_title: "CNS Module 1",
    short_summary: "Summary of CNS Module 1",
    module_overview: "Full module overview",
    covered_topics: coveredTopics,
    key_points: coveredTopics.map((t) => `${t} kp`),
    topic_wise_summary: coveredTopics.map((t) => ({
      topic: t,
      explanation: `${t} explanation`,
      important_points: [`${t} important`],
    })),
    exam_focus_points: [],
    memory_lines: [],
    common_mistakes: [],
    important_concepts: coveredTopics,
    action_items: [],
    suggested_tags: coveredTopics.slice(0, 3),
    suggested_next_step: "Revise",
  });
}

const CHUNK1_TOPICS = [
  "cryptography",
  "plaintext",
  "ciphertext",
  "encryption",
  "decryption",
  "key",
  "CIA triad",
  "OSI security architecture",
  "Caesar cipher",
  "symmetric cipher model",
  "cryptanalysis",
  "brute force",
];
const CHUNK2_TOPICS = [
  "monoalphabetic cipher",
  "security attack",
  "active attack",
  "passive attack",
  "security service",
  "security mechanism",
  "Playfair cipher",
];
const CHUNK3_TOPICS = ["Hill cipher", "modulo 26", "multiplicative inverse"];

// Distinguish chunk-map requests from synthesis requests by a stable marker
// we put in the chunk-map prompt template ("CHUNK TEXT:") vs the synthesis
// prompt template ("MATERIAL:").
function isChunkMapPrompt(prompt: string) {
  return prompt.includes("SOURCE SECTION TEXT:");
}

function expectNoUserFacingMetadata(summary: Awaited<ReturnType<typeof summarizeStudyText>>) {
  const userFacing = [
    summary.suggested_title,
    summary.short_summary,
    summary.module_overview,
    ...summary.covered_topics,
    ...summary.key_points,
    ...summary.topic_wise_summary.flatMap((topic) => [topic.topic, topic.explanation, ...topic.important_points]),
    ...summary.exam_focus_points,
    ...summary.memory_lines,
    ...summary.common_mistakes,
    ...summary.important_concepts,
    ...summary.action_items,
    ...summary.suggested_tags,
    summary.suggested_next_step,
  ].join("\n");

  expect(userFacing).not.toMatch(/chunk_number|chunk_total|chunkNumber|chunkTotal|CHUNK_MAPS|TOTAL_CHUNKS|ALL_DETECTED/i);
  expect(userFacing).not.toMatch(/[{}[\]]/);
}

beforeEach(() => {
  mockGenerator = null;
});

afterEach(() => {
  mockGenerator = null;
});

describe("summarizeStudyText - resilient chunk processing", () => {
  it("processes all 29,510 characters and produces 3 ordered chunks", async () => {
    expect(CNS_SOURCE.length).toBeGreaterThan(24000);
    expect(CNS_SOURCE.length).toBeLessThanOrEqual(31000);

    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 1")) return Promise.resolve(chunkMapJson(1, 3, CHUNK1_TOPICS));
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      // Synthesis: return union of detected chunk topics.
      return Promise.resolve(synthesisJson([...CHUNK1_TOPICS, ...CHUNK2_TOPICS, ...CHUNK3_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    expect(summary.generation_metadata.attemptedChunks).toBe(3);
    expect(summary.generation_metadata.successfulChunks).toEqual([1, 2, 3]);
    expect(summary.generation_metadata.failedChunks).toEqual([]);
    expect(summary.generation_metadata.partialCoverage).toBe(false);
    expect(summary.generation_metadata.sourceTextLength).toBe(CNS_SOURCE.length);

    // The full CNS topic coverage (early, middle, late chunks): Hill cipher
    // (chunk 3) must NOT dominate. CIA triad, Caesar, monoalphabetic, Playfair,
    // and Hill must all appear.
    const covered = summary.covered_topics.join(" ");
    expect(covered).toMatch(/Hill cipher/i);
    expect(covered).toMatch(/Caesar cipher/i);
    expect(covered).toMatch(/monoalphabetic cipher/i);
    expect(covered).toMatch(/Playfair cipher/i);
    expect(covered).toMatch(/CIA triad/i);
    expect(covered).toMatch(/OSI security architecture/i);
    expect(covered).toMatch(/symmetric cipher model/i);
    expect(covered).toMatch(/security attack/i);
  });

  it("continues processing chunks 2 and 3 when chunk 1 times out", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 1")) return Promise.reject(new Error("timeout: chunk 1 exceeded 120s"));
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      return Promise.resolve(synthesisJson([...CHUNK2_TOPICS, ...CHUNK3_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    expect(summary.generation_metadata.attemptedChunks).toBe(3);
    expect(summary.generation_metadata.successfulChunks).toEqual([2, 3]);
    expect(summary.generation_metadata.failedChunks).toEqual([1]);
    expect(summary.generation_metadata.partialCoverage).toBe(true);
    expect(summary.generation_metadata.failureCategories).toContain("timeout");
    expect(summary.module_overview).toMatch(/partial/i);
    expect(summary.covered_topics.join(" ")).toMatch(/Hill cipher/i);
    expect(summary.covered_topics.join(" ")).toMatch(/Playfair cipher/i);
  });

  it("continues with chunks 1 and 3 when chunk 2 hits a quota error", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 27")) return Promise.reject(new Error("quota: free ai limit reached"));
        if (prompt.includes("Page 1")) return Promise.resolve(chunkMapJson(1, 3, CHUNK1_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      return Promise.resolve(synthesisJson([...CHUNK1_TOPICS, ...CHUNK3_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    expect(summary.generation_metadata.failedChunks).toEqual([2]);
    expect(summary.generation_metadata.successfulChunks).toEqual([1, 3]);
    expect(summary.generation_metadata.partialCoverage).toBe(true);
    expect(summary.generation_metadata.failureCategories).toContain("quota");
  });

  it("continues with chunks 1 and 2 when chunk 3 fails", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 53")) return Promise.reject(new Error("provider error"));
        if (prompt.includes("Page 1")) return Promise.resolve(chunkMapJson(1, 3, CHUNK1_TOPICS));
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      return Promise.resolve(synthesisJson([...CHUNK1_TOPICS, ...CHUNK2_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    expect(summary.generation_metadata.failedChunks).toEqual([3]);
    expect(summary.generation_metadata.successfulChunks).toEqual([1, 2]);
    expect(summary.generation_metadata.partialCoverage).toBe(true);
  });

  it("throws a clean summary-generation error when the final merge fails", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 1")) return Promise.resolve(chunkMapJson(1, 3, CHUNK1_TOPICS));
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      // Synthesis fails with a 503 busy error.
      return Promise.reject(new Error("busy: AI overloaded, try again later"));
    };

    await expect(
      summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" }),
    ).rejects.toThrow(/summary generation failed|busy/i);
  });

  it("throws a clean summary-generation error when every chunk fails (AI quota reached)", async () => {
    mockGenerator = () => Promise.reject(new Error("quota: free ai limit reached"));

    await expect(
      summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" }),
    ).rejects.toThrow(/Summary generation failed/);
  });

  it("falls back to deterministic chunk maps when AI returns invalid JSON", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        // Malformed JSON for chunk 1.
        if (prompt.includes("Page 1")) return Promise.resolve("{ not valid json");
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      return Promise.resolve(synthesisJson([...CHUNK2_TOPICS, ...CHUNK3_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    // Fallback chunk map keeps the chunk "successful" (no failure category)
    // because the AI did return a string that the fallback parser could
    // loosely parse. The chunk loop must not abort on invalid JSON.
    expect(summary.generation_metadata.failedChunks).toEqual([]);
    expect(summary.generation_metadata.successfulChunks).toEqual([1, 2, 3]);
    expect(summary.generation_metadata.partialCoverage).toBe(false);
  });

  it("partial coverage results when chunk 1 fails on timeout and chunk 3 on quota", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 1")) return Promise.reject(new Error("timeout: 120s exceeded"));
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        if (prompt.includes("Page 53")) return Promise.reject(new Error("quota: free ai limit reached"));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      return Promise.resolve(synthesisJson(CHUNK2_TOPICS));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    expect(summary.generation_metadata.failedChunks).toEqual([1, 3]);
    expect(summary.generation_metadata.successfulChunks).toEqual([2]);
    expect(summary.generation_metadata.partialCoverage).toBe(true);
    expect(summary.generation_metadata.failureCategories).toEqual(expect.arrayContaining(["timeout", "quota"]));
  });

  it("preserves chunk order in successfulChunks regardless of which chunks fail", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 27")) return Promise.reject(new Error("busy"));
        if (prompt.includes("Page 1")) return Promise.resolve(chunkMapJson(1, 3, CHUNK1_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      return Promise.resolve(synthesisJson([...CHUNK1_TOPICS, ...CHUNK3_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    // Order is preserved 1,3 — not reversed or shuffled.
    expect(summary.generation_metadata.successfulChunks).toEqual([1, 3]);
    expect(summary.generation_metadata.failedChunks).toEqual([2]);
  });

  it("does not include provider secrets, prompts, or raw stack traces in metadata", async () => {
    const secretMessage = "Bearer GEMINI.secret-API-key-12345";
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 1")) return Promise.reject(new Error(secretMessage));
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
        return Promise.resolve(chunkMapJson(0, 3, []));
      }
      return Promise.resolve(synthesisJson([...CHUNK2_TOPICS, ...CHUNK3_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    const metadataJson = JSON.stringify(summary.generation_metadata);
    expect(metadataJson).not.toContain("GEMINI");
    expect(metadataJson).not.toContain("secret");
    expect(metadataJson).not.toContain("Bearer");
    expect(metadataJson).not.toContain("API-key");
    // Only safe category labels are stored.
    expect(summary.generation_metadata.failureCategories).toEqual(["provider-error"]);
  });
});

describe("summarizeStudyText - user-facing formatting cleanup", () => {
  it("returns a clean structured summary for a single chunk", async () => {
    mockGenerator = () => Promise.resolve(synthesisJson(["Hill cipher", "Matrix inverse"]));

    const summary = await summarizeStudyText("Hill cipher uses matrix multiplication modulo 26 for encryption.", {
      sourceType: "note",
      sourceName: "Hill Cipher Note",
    });

    expect(summary.short_summary).toBe("Summary of CNS Module 1");
    expect(summary.key_points.length).toBeGreaterThan(0);
    expect(summary.action_items.length).toBeGreaterThan(0);
    expect(summary.covered_topics).toEqual(expect.arrayContaining(["Hill cipher", "Matrix inverse"]));
    expect(summary.important_concepts).toEqual([]);
    expect(summary.suggested_tags.length).toBeGreaterThan(0);
    expect(summary.suggested_next_step).toBe("Revise");
    expectNoUserFacingMetadata(summary);
  });

  it("sends clean educational material, not internal chunk metadata, to multi-chunk synthesis", async () => {
    let synthesisPrompt = "";

    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        if (prompt.includes("Page 1")) return Promise.resolve(chunkMapJson(1, 3, CHUNK1_TOPICS));
        if (prompt.includes("Page 27")) return Promise.resolve(chunkMapJson(2, 3, CHUNK2_TOPICS));
        if (prompt.includes("Page 53")) return Promise.resolve(chunkMapJson(3, 3, CHUNK3_TOPICS));
      }
      synthesisPrompt = prompt;
      return Promise.resolve(synthesisJson([...CHUNK1_TOPICS, ...CHUNK2_TOPICS, ...CHUNK3_TOPICS]));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    expect(synthesisPrompt).toContain("Major study areas");
    expect(synthesisPrompt).toContain("Key educational points");
    expect(synthesisPrompt).not.toMatch(/CHUNK_MAPS|TOTAL_CHUNKS|ALL_DETECTED|Chunk \d|chunk_number|chunk_total|Heading:/i);
    expect(summary.covered_topics.join(" ")).toMatch(/Hill cipher/i);
    expectNoUserFacingMetadata(summary);
  });

  it("deduplicates repeated concepts across source sections", async () => {
    mockGenerator = (prompt: string) => {
      if (isChunkMapPrompt(prompt)) {
        return Promise.resolve(JSON.stringify({
          study_areas: ["Hill Cipher", "Hill cipher", "hill cipher"],
          important_points: ["Hill cipher uses matrices", "Hill cipher uses matrices", "Hill cipher uses matrices."],
          important_concepts: ["Matrix inverse", "matrix inverse", "Matrix inverse"],
        }));
      }
      return Promise.resolve(JSON.stringify({
        suggested_title: "Hill Cipher",
        short_summary: "Hill cipher summary",
        module_overview: "Hill cipher overview",
        covered_topics: ["Hill Cipher", "Hill cipher", "Matrix inverse", "matrix inverse"],
        key_points: ["Hill cipher uses matrices", "Hill cipher uses matrices"],
        topic_wise_summary: [
          { topic: "Hill Cipher", explanation: "Matrix method", important_points: ["Modulo 26"] },
          { topic: "hill cipher", explanation: "Matrix method duplicate", important_points: ["Modulo 26"] },
        ],
        important_concepts: ["Matrix inverse", "matrix inverse"],
        action_items: ["Practice one example", "Practice one example"],
        suggested_tags: ["Hill Cipher", "hill cipher"],
        suggested_next_step: "Practice",
      }));
    };

    const summary = await summarizeStudyText(CNS_SOURCE, { sourceType: "file", sourceName: "CNSmodule-1.pdf" });

    expect(summary.covered_topics.filter((topic) => /hill cipher/i.test(topic))).toHaveLength(1);
    expect(summary.covered_topics.filter((topic) => /matrix inverse/i.test(topic))).toHaveLength(1);
    expect(summary.important_concepts.filter((concept) => /matrix inverse/i.test(concept))).toHaveLength(0);
    expect(summary.key_points.filter((point) => /Hill cipher uses matrices/i.test(point))).toHaveLength(1);
    expect(summary.topic_wise_summary.filter((topic) => /hill cipher/i.test(topic.topic))).toHaveLength(1);
  });

  it("removes internal metadata and raw JSON fragments from user-facing fields", async () => {
    mockGenerator = () => Promise.resolve(JSON.stringify({
      suggested_title: "{\"heading\":\"Chunk 1\",\"topics\":[\"Bad\"]}",
      short_summary: "chunk_number: 1 chunk_total: 3 Hill cipher is a classical cipher.",
      module_overview: "{\"chunk_total\":3} Matrix multiplication modulo 26 is used.",
      covered_topics: ["chunk_number: 1", "Hill cipher", "{\"topics\":[\"leak\"]}"],
      key_points: ["{\"heading\":\"Chunk 1\"}", "Use inverse matrix for decryption."],
      topic_wise_summary: [
        {
          topic: "chunk_total: 3",
          explanation: "{\"topics\":[\"internal\"]}",
          important_points: ["chunk_number: 1"],
        },
        {
          topic: "Hill cipher",
          explanation: "Uses matrices modulo 26.",
          important_points: ["Encryption uses key matrix."],
        },
      ],
      important_concepts: ["heading: Chunk 1", "Matrix inverse"],
      action_items: ["topics: internal", "Solve one encryption example."],
      suggested_tags: ["chunk_total: 3", "Hill cipher"],
      suggested_next_step: "{\"heading\":\"Next\"} Practice with a 2x2 matrix.",
    }));

    const summary = await summarizeStudyText("Hill cipher uses a key matrix and matrix inverse modulo 26.", {
      sourceType: "note",
      sourceName: "Hill Cipher Note",
    });

    expect(summary.covered_topics).toContain("Hill cipher");
    expect(summary.key_points).toContain("Use inverse matrix for decryption.");
    expect(summary.topic_wise_summary.map((topic) => topic.topic)).toContain("Hill cipher");
    expect(summary.action_items).toContain("Solve one encryption example.");
    expect(summary.suggested_tags).toContain("Hill cipher");
    expectNoUserFacingMetadata(summary);
  });

  it("cleans malformed AI JSON output with surrounding raw fragments", async () => {
    mockGenerator = () => Promise.resolve(`
      draft notes before JSON
      {
        "suggested_title": "Hill Cipher",
        "short_summary": "Hill cipher uses matrix encryption.",
        "module_overview": "A clean overview.",
        "covered_topics": ["Hill cipher", "Hill cipher"],
        "key_points": ["Matrix key", "Matrix key"],
        "topic_wise_summary": [{"topic":"Hill cipher","explanation":"Uses matrices.","important_points":["Modulo 26"]}],
        "important_concepts": ["Matrix inverse"],
        "action_items": ["Practice a 2x2 example"],
        "suggested_tags": ["Hill cipher"],
        "suggested_next_step": "Try a quiz."
      }
      {"chunk_number":1,"chunk_total":2,"heading":"internal"}
    `);

    const summary = await summarizeStudyText("Hill cipher uses matrix encryption modulo 26.", {
      sourceType: "note",
      sourceName: "Hill Cipher Note",
    });

    expect(summary.short_summary).toBe("Hill cipher uses matrix encryption.");
    expect(summary.covered_topics).toEqual(["Hill cipher"]);
    expect(summary.key_points).toEqual(["Matrix key"]);
    expectNoUserFacingMetadata(summary);
  });
});
