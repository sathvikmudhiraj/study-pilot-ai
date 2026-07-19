import { describe, expect, it } from "vitest";
import { sanitizeSummaryForDisplay } from "@/shared/summarySanitizer";

const INTERNAL_METADATA_PATTERN =
  /\b(chunk_number|chunk_total|chunkNumber|chunkTotal|heading|topics|CHUNK_MAPS|TOTAL_CHUNKS|ALL_DETECTED_TOPICS|ALL_DETECTED_CONCEPTS)\b/i;

function visibleSummaryText(value: unknown) {
  return JSON.stringify(value);
}

describe("sanitizeSummaryForDisplay", () => {
  it("sanitizes fresh generation output before it is returned or saved", () => {
    const sanitized = sanitizeSummaryForDisplay({
      suggested_title: "Study summary",
      short_summary: "chunk_number: 1 Linear equations explain relationships between variables.",
      covered_topics: ["Linear equations", "heading: Chunk 1"],
      key_points: ["Linear equations", "Solve for unknown variables."],
      topic_wise_summary: [
        {
          topic: "Linear equations",
          explanation: "topics: algebra basics",
          important_points: ["Use inverse operations.", "chunk_total: 3"],
        },
      ],
      important_concepts: ["Linear equations", "Inverse operations"],
      action_items: ["Practice two examples."],
      suggested_tags: ["#algebra", "topics: internal"],
      suggested_next_step: "Generate a quiz.",
      source_citations: [{ fileId: "file-1", page: 2 }],
    });

    expect(visibleSummaryText(sanitized)).not.toMatch(INTERNAL_METADATA_PATTERN);
    expect(sanitized.covered_topics).toEqual(["Linear equations"]);
    expect(sanitized.key_points).toEqual(["Solve for unknown variables."]);
    expect(sanitized.source_citations).toEqual([{ fileId: "file-1", page: 2 }]);
  });

  it("sanitizes regeneration payloads with the same canonical rules", () => {
    const sanitized = sanitizeSummaryForDisplay({
      id: "summary-1",
      short_summary: "```json\n{\"chunk_number\":1,\"heading\":\"Intro\"}\n```\nMatrices transform vectors.",
      covered_topics: ["Matrices", "Matrices"],
      key_points: ["Matrices", "Matrix multiplication combines transformations."],
      topic_wise_summary: [
        {
          topic: "Matrices",
          explanation: "Matrix multiplication combines transformations.",
          important_points: ["Rows combine with columns."],
        },
      ],
      important_concepts: ["Matrices", "Matrix multiplication"],
      action_items: ["Try a 2x2 multiplication."],
      suggested_tags: ["linear-algebra"],
      suggested_next_step: "Review examples.",
      created_at: "2026-07-17T00:00:00Z",
    });

    expect(visibleSummaryText(sanitized)).not.toMatch(INTERNAL_METADATA_PATTERN);
    expect(sanitized.short_summary).toBe("Matrices transform vectors.");
    expect(sanitized.covered_topics).toEqual(["Matrices"]);
    expect(sanitized.key_points).toEqual(["Matrix multiplication combines transformations."]);
    expect(sanitized.created_at).toBe("2026-07-17T00:00:00Z");
  });

  it("defensively cleans older cached summary rows merged with content JSON", () => {
    const cachedRow = {
      id: "old-row",
      short_summary: "chunk_total: 4 Photosynthesis converts light into chemical energy.",
      key_points: ["{\"heading\":\"Chunk 2\"}", "Chlorophyll captures light.", "Chlorophyll captures light."],
      content: JSON.stringify({
        covered_topics: ["Photosynthesis", "{\"topics\":[\"internal\"]}"],
        important_concepts: ["Photosynthesis", "Chlorophyll"],
        topic_wise_summary: [
          {
            topic: "heading: Chunk 2",
            explanation: "topics: plants",
            important_points: ["chunk_number: 2"],
          },
          {
            topic: "Light reactions",
            explanation: "Light reactions produce ATP and NADPH.",
            important_points: ["Water is split."],
          },
        ],
        source_citations: [{ fileId: "biology.pdf", page: 5 }],
      }),
    };
    const parsedContent = JSON.parse(cachedRow.content);

    const sanitized = sanitizeSummaryForDisplay({ ...parsedContent, ...cachedRow });

    expect(visibleSummaryText(sanitized)).not.toMatch(INTERNAL_METADATA_PATTERN);
    expect(sanitized.covered_topics).toEqual(["Photosynthesis"]);
    expect(sanitized.key_points).toEqual(["Chlorophyll captures light."]);
    expect(sanitized.topic_wise_summary).toEqual([
      {
        topic: "Light reactions",
        explanation: "Light reactions produce ATP and NADPH.",
        important_points: ["Water is split."],
      },
    ]);
    expect(sanitized.source_citations).toEqual([{ fileId: "biology.pdf", page: 5 }]);
  });

  it("removes malformed raw model fragments from user-facing fields", () => {
    const sanitized = sanitizeSummaryForDisplay({
      short_summary: "{\"topics\":[\"x\"],\"chunk_number\":3}",
      covered_topics: ["```json\n{\"heading\":\"Chunk\"}\n```", "Thermodynamics"],
      key_points: ["{bad json", "Energy is conserved."],
      topic_wise_summary: [],
      important_concepts: ["Thermodynamics"],
      action_items: [],
      suggested_tags: [],
      suggested_next_step: "heading: retry",
    });

    expect(visibleSummaryText(sanitized)).not.toMatch(INTERNAL_METADATA_PATTERN);
    expect(sanitized.short_summary).toBe("Energy is conserved.");
    expect(sanitized.covered_topics).toEqual(["Thermodynamics"]);
    expect(sanitized.key_points).toEqual(["Energy is conserved."]);
    expect(sanitized.suggested_next_step).toBe(
      "Review the key points, then generate a quiz to check your understanding.",
    );
  });

  it("deduplicates repeated concepts across topic, concept, and key point fields", () => {
    const sanitized = sanitizeSummaryForDisplay({
      short_summary: "Newton's laws describe motion.",
      covered_topics: ["Newton's laws", "Forces"],
      topic_wise_summary: [
        {
          topic: "Newton's laws",
          explanation: "The laws relate force, mass, and acceleration.",
          important_points: ["Force equals mass times acceleration."],
        },
      ],
      important_concepts: ["Newton's laws", "Forces", "Inertia"],
      key_points: ["Newton's laws", "Forces", "Inertia", "Net force changes motion."],
      action_items: ["Solve a force diagram."],
      suggested_tags: ["physics"],
      suggested_next_step: "Take a quiz.",
    });

    expect(sanitized.covered_topics).toEqual(["Newton's laws", "Forces"]);
    expect(sanitized.important_concepts).toEqual(["Inertia"]);
    expect(sanitized.key_points).toEqual(["Net force changes motion."]);
  });

  it("preserves partial summary fallback metadata while sanitizing visible content", () => {
    const sanitized = sanitizeSummaryForDisplay({
      short_summary: "chunk_number: 1 Cell division includes mitosis.",
      covered_topics: ["Cell division"],
      key_points: ["Cell division", "Mitosis creates identical cells."],
      topic_wise_summary: [],
      important_concepts: ["Mitosis"],
      action_items: [],
      suggested_tags: [],
      suggested_next_step: "",
      generation_metadata: {
        partialCoverage: true,
        reason: "model_timeout",
      },
    });

    expect(visibleSummaryText(sanitized)).not.toMatch(INTERNAL_METADATA_PATTERN);
    expect(sanitized.generation_metadata).toEqual({
      partialCoverage: true,
      reason: "model_timeout",
    });
    expect(sanitized.key_points).toEqual(["Mitosis creates identical cells."]);
  });
});
