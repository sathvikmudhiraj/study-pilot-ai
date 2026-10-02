import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../aiProvider", () => ({ generateSummaryAIText: vi.fn(async () => "") }));

import { generateStudyNoteDraft, StudyNoteGenerationError } from "../aiNotes";

describe("study note provider response", () => {
  it("does not report an empty provider result as a JSON format failure", async () => {
    await expect(generateStudyNoteDraft({
      sourceType: "file",
      sourceId: "file-1",
      sourceLabel: "Module-3.docx",
      sourceText: "Set operators combine result sets. UNION removes duplicate rows from the result.",
      fileId: "file-1",
      style: "exam",
      language: "auto",
      citationStrategy: "derived",
      citationSourceType: "file",
    })).rejects.toMatchObject({
      name: StudyNoteGenerationError.name,
      code: "provider_unavailable",
      message: expect.not.stringMatching(/format/i),
    });
  });
});
