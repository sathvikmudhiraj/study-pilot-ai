import type { WebCitation } from "@/frontend/lib/webFeatures";

function safeCitationUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function clampSnippet(snippet: string | undefined) {
  if (!snippet) return "";
  const normalized = snippet.replace(/\s+/g, " ").trim();
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217).trimEnd()}...`;
}

export function WebCitationList({ citations }: { citations: WebCitation[] }) {
  const safeCitations = citations
    .slice(0, 3)
    .map((citation) => ({
      citation,
      href: safeCitationUrl(citation.url),
      snippet: clampSnippet(citation.snippet),
    }))
    .filter((item) => item.href);

  if (!safeCitations.length) return null;

  return (
    <section aria-label="Web sources">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-300/90">Web Sources</p>
      <div className="grid gap-2">
        {safeCitations.map(({ citation, href, snippet }, index) => (
          <a
            key={`${href}:${citation.locator_start}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            className="group block min-w-0 rounded-lg border border-violet-300/20 bg-violet-300/[0.06] p-3 transition hover:border-violet-300/35 hover:bg-violet-300/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
            title={`${citation.source_name} - ${citation.domain}`}
          >
            <span className="flex min-w-0 items-start gap-2">
              <span
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-violet-300/20 bg-violet-300/10 text-xs font-bold text-violet-100"
                aria-hidden="true"
              >
                {citation.locator_start || index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-xs font-semibold leading-5 text-violet-50 group-hover:text-white">
                  {citation.source_name}
                </span>
                <span className="mt-0.5 block break-all text-[11px] text-violet-200/70">
                  {citation.domain}
                </span>
                {snippet ? (
                  <span className="mt-1 block break-words text-[11px] leading-4 text-slate-400">{snippet}</span>
                ) : null}
              </span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
