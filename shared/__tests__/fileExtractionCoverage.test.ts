import { describe, expect, it } from "vitest";
import { hasCompletePageCoverage } from "../fileExtractionCoverage";

describe("hasCompletePageCoverage", () => {
  it("rejects a 63-page PDF with 13 failed vision pages", () => {
    expect(hasCompletePageCoverage({
      totalPages: 63,
      extractedPageCount: 50,
      failedPages: Array.from({ length: 13 }, (_, index) => index + 51),
      visionPagesFailed: 13,
    })).toBe(false);
  });

  it("requires every page to be extracted even if failures were not recorded", () => {
    expect(hasCompletePageCoverage({ totalPages: 63, extractedPageCount: 50, failedPages: [] })).toBe(false);
  });

  it("accepts complete page coverage and non-paginated material", () => {
    expect(hasCompletePageCoverage({ totalPages: 63, extractedPageCount: 63, failedPages: [], visionPagesFailed: 0 })).toBe(true);
    expect(hasCompletePageCoverage(null)).toBe(true);
  });
});
