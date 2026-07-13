export type CitationSourceType = "file" | "note" | "summary" | "previous_answer";

export type CitationLocatorType = "page" | "slide" | "chunk";

export type SourceCitation = {
  id: string;
  source_id?: string;
  source_type: CitationSourceType;
  source_name: string;
  locator_type?: CitationLocatorType;
  locator_start?: number;
  locator_end?: number;
};

export type CitedTextSegment = {
  text: string;
  citation: SourceCitation;
};

type SourceMarker = {
  index: number;
  type: "page" | "slide";
  value: number;
};

function collectMarkers(text: string): SourceMarker[] {
  const markers: SourceMarker[] = [];
  const patterns: { type: SourceMarker["type"]; regex: RegExp }[] = [
    { type: "page", regex: /\[Page\s+(\d+)\]/gi },
    { type: "slide", regex: /(?:^|\n)Slide\s+(\d+):/gi },
  ];

  for (const { type, regex } of patterns) {
    for (const match of text.matchAll(regex)) {
      const value = Number(match[1]);
      if (!Number.isFinite(value) || match.index === undefined) continue;
      markers.push({ index: match.index, type, value });
    }
  }

  return markers.sort((a, b) => a.index - b.index);
}

function findBoundary(text: string, cursor: number, target: number) {
  if (target >= text.length) return text.length;

  const paragraph = text.lastIndexOf("\n\n", target);
  if (paragraph > cursor + (target - cursor) * 0.55) return paragraph + 2;

  const sentence = text.lastIndexOf(". ", target);
  if (sentence > cursor + (target - cursor) * 0.55) return sentence + 1;

  return target;
}

function locatorForRange(markers: SourceMarker[], start: number, end: number, chunkNumber: number) {
  const preceding = [...markers].reverse().find((marker) => marker.index <= start);
  const inside = markers.filter((marker) => marker.index > start && marker.index < end);
  const relevant = preceding ? [preceding, ...inside] : inside;

  if (!relevant.length) {
    return {
      locator_type: "chunk" as const,
      locator_start: chunkNumber,
      locator_end: chunkNumber,
    };
  }

  const type = relevant[0].type;
  const sameType = relevant.filter((marker) => marker.type === type);
  return {
    locator_type: type,
    locator_start: sameType[0].value,
    locator_end: sameType[sameType.length - 1].value,
  };
}

export function segmentTextWithCitations({
  text,
  sourceId,
  sourceType,
  sourceName,
  maxChars = 6000,
  idPrefix = "source",
}: {
  text: string;
  sourceId?: string;
  sourceType: CitationSourceType;
  sourceName: string;
  maxChars?: number;
  idPrefix?: string;
}): CitedTextSegment[] {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];

  const markers = collectMarkers(normalized);
  const segments: CitedTextSegment[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const target = Math.min(cursor + Math.max(800, maxChars), normalized.length);
    const end = findBoundary(normalized, cursor, target);
    const segmentText = normalized.slice(cursor, end).trim();

    if (segmentText) {
      const chunkNumber = segments.length + 1;
      const locator = locatorForRange(markers, cursor, end, chunkNumber);
      segments.push({
        text: segmentText,
        citation: {
          id: `${idPrefix}-${chunkNumber}`,
          ...(sourceId ? { source_id: sourceId } : {}),
          source_type: sourceType,
          source_name: sourceName.trim() || "Study material",
          ...locator,
        },
      });
    }

    cursor = end > cursor ? end : target;
  }

  return segments;
}

export function uniqueSourceCitations(citations: SourceCitation[], limit = 12) {
  const seen = new Set<string>();
  const unique: SourceCitation[] = [];

  for (const citation of citations) {
    const key = [
      citation.source_type,
      citation.source_id ?? citation.source_name,
      citation.locator_type ?? "source",
      citation.locator_start ?? "",
      citation.locator_end ?? "",
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(citation);
    if (unique.length >= limit) break;
  }

  return unique;
}

export function formatCitationLocator(citation: SourceCitation) {
  if (!citation.locator_type || citation.locator_start === undefined) return citation.source_name;

  const noun = citation.locator_type === "page" ? "Page" : citation.locator_type === "slide" ? "Slide" : "Chunk";
  const range =
    citation.locator_end !== undefined && citation.locator_end !== citation.locator_start
      ? `${citation.locator_start}-${citation.locator_end}`
      : String(citation.locator_start);
  return `${citation.source_name} - ${noun} ${range}`;
}
