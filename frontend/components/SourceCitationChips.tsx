export type SourceCitationValue = {
  id?: string;
  source_id?: string;
  source_type?: string;
  source_name: string;
  locator_type?: "page" | "slide" | "chunk";
  locator_start?: number;
  locator_end?: number;
};

function citationParts(citation: SourceCitationValue): { name: string; locator: string | null } {
  const sourceName = citation.source_name.trim() || "Study material";
  if (!citation.locator_type || citation.locator_start === undefined) return { name: sourceName, locator: null };

  const noun = citation.locator_type === "page" ? "Page" : citation.locator_type === "slide" ? "Slide" : "Chunk";
  const locator =
    citation.locator_end !== undefined && citation.locator_end !== citation.locator_start
      ? `${citation.locator_start}-${citation.locator_end}`
      : String(citation.locator_start);
  return { name: sourceName, locator: `${noun} ${locator}` };
}

function citationLabel(citation: SourceCitationValue) {
  const { name, locator } = citationParts(citation);
  return locator ? `${name} - ${locator}` : name;
}

export function normalizeSourceCitations(value: unknown): SourceCitationValue[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const citations: SourceCitationValue[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const sourceName = String(record.source_name ?? record.sourceName ?? record.label ?? "").trim();
    if (!sourceName) continue;

    const locatorTypeValue = String(record.locator_type ?? record.locatorType ?? "").toLowerCase();
    const locatorType = ["page", "slide", "chunk"].includes(locatorTypeValue)
      ? (locatorTypeValue as SourceCitationValue["locator_type"])
      : undefined;
    const startValue = Number(record.locator_start ?? record.locatorStart);
    const endValue = Number(record.locator_end ?? record.locatorEnd);
    const citation: SourceCitationValue = {
      id: String(record.id ?? "").trim() || undefined,
      source_id: String(record.source_id ?? record.sourceId ?? "").trim() || undefined,
      source_type: String(record.source_type ?? record.sourceType ?? "").trim() || undefined,
      source_name: sourceName,
      locator_type: locatorType,
      locator_start: locatorType && Number.isFinite(startValue) ? startValue : undefined,
      locator_end: locatorType && Number.isFinite(endValue) ? endValue : undefined,
    };
    const key = citationLabel(citation).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push(citation);
    if (citations.length >= 12) break;
  }

  return citations;
}

export function SourceCitationChips({ citations }: { citations: SourceCitationValue[] }) {
  if (!citations.length) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Sources">
      <span className="mr-0.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</span>
      {citations.map((citation, index) => {
        const { name, locator } = citationParts(citation);
        const title = citationLabel(citation);
        return (
          <span
            key={citation.id || `${title}:${index}`}
            title={title}
            className="inline-flex max-w-full items-center gap-1.5 break-words rounded-full border border-cyan-300/25 bg-cyan-300/[0.08] py-0.5 pl-2 pr-2 text-xs font-medium text-cyan-100"
          >
            <svg
              viewBox="0 0 24 24"
              width="11"
              height="11"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0 text-cyan-300/80"
              aria-hidden="true"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="truncate">{name}</span>
            {locator ? (
              <span className="shrink-0 rounded-full bg-cyan-300/15 px-1.5 py-px text-[10px] font-semibold tracking-wide text-cyan-200">
                {locator}
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
