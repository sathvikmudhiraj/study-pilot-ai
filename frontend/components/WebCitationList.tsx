import type { WebCitation } from "@/frontend/lib/webFeatures";

function safeCitationUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function WebCitationList({ citations }: { citations: WebCitation[] }) {
  const safeCitations = citations
    .map((citation) => ({ citation, href: safeCitationUrl(citation.url) }))
    .filter((item) => item.href);

  if (!safeCitations.length) return null;

  return (
    <section aria-label="Web sources">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-300/90">Web sources</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {safeCitations.map(({ citation, href }) => (
          <a
            key={`${citation.id}:${citation.locator_start}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            className="group min-w-0 rounded-lg border border-violet-300/20 bg-violet-300/[0.06] p-2.5 transition hover:border-violet-300/35 hover:bg-violet-300/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/50"
            title={`${citation.source_name} — ${citation.domain}`}
          >
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-violet-300/20 bg-violet-300/10 text-violet-200" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
                </svg>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-xs font-semibold leading-5 text-violet-50 group-hover:text-white">
                  {citation.source_name}
                </span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-violet-200/70">
                  <span className="break-all">{citation.domain}</span>
                  {citation.published_at ? (
                    <>
                      <span aria-hidden="true">•</span>
                      <span>{citation.published_at}</span>
                    </>
                  ) : null}
                  <span aria-hidden="true">•</span>
                  <span className="font-semibold text-violet-200">Result {citation.locator_start}</span>
                </span>
                {citation.snippet ? (
                  <span className="mt-1 line-clamp-2 break-words text-[11px] leading-4 text-slate-400">{citation.snippet}</span>
                ) : null}
              </span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
