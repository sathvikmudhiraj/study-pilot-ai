type PageCoverage = {
  totalPages?: unknown;
  extractedPageCount?: unknown;
  readablePages?: unknown;
  failedPages?: unknown;
  visionPagesFailed?: unknown;
};

export function hasCompletePageCoverage(metadata: PageCoverage | null | undefined): boolean {
  if (!metadata) return true;
  if (Array.isArray(metadata.failedPages) && metadata.failedPages.length > 0) return false;
  if (typeof metadata.visionPagesFailed === "number" && metadata.visionPagesFailed > 0) return false;

  const total = metadata.totalPages;
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return true;

  const extracted = typeof metadata.extractedPageCount === "number"
    ? metadata.extractedPageCount
    : Array.isArray(metadata.readablePages) ? metadata.readablePages.length : 0;
  return extracted >= total;
}
