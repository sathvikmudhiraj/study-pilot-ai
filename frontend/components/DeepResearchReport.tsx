import type { DeepResearchReport as DeepResearchReportValue, WebCitation } from "@/frontend/lib/webFeatures";
import { WebCitationList } from "./WebCitationList";

function safeCitationUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function CitedText({ text, sources }: { text: string; sources: WebCitation[] }) {
  const parts = text.split(/(\[\d{1,2}])/g);
  return (
    <>
      {parts.map((part, index) => {
        const marker = part.match(/^\[(\d{1,2})]$/);
        if (!marker) return <span key={`${index}:${part.slice(0, 12)}`}>{part}</span>;

        const position = Number(marker[1]);
        const source = sources.find((item) => item.locator_start === position) ?? sources[position - 1];
        const href = source ? safeCitationUrl(source.url) : "";
        if (!source || !href) return null;

        return (
          <a
            key={`${index}:${position}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            title={`${source.source_name} — ${source.domain}`}
            className="mx-0.5 inline-flex rounded bg-sky-300/10 px-1 text-xs font-bold text-sky-200 underline decoration-sky-300/30 underline-offset-2 hover:bg-sky-300/15"
          >
            [{position}]
          </a>
        );
      })}
    </>
  );
}

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-slate-950/45 p-4">
      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-sky-200">{title}</h3>
      <div className="mt-2 text-sm leading-7 text-slate-200">{children}</div>
    </section>
  );
}

export function DeepResearchReport({ report }: { report: DeepResearchReportValue }) {
  return (
    <article className="space-y-3" aria-label={`Deep research report: ${report.research_question}`}>
      <div className="rounded-xl border border-sky-300/20 bg-sky-300/[0.06] p-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-300">Research question</p>
        <h2 className="mt-1 break-words text-base font-semibold leading-7 text-white">{report.research_question}</h2>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Research sub-queries">
          {report.sub_queries.map((query) => (
            <span key={query} className="max-w-full break-words rounded-full border border-sky-300/15 bg-slate-950/40 px-2 py-1 text-[11px] text-sky-100/80">
              {query}
            </span>
          ))}
        </div>
      </div>

      <ReportSection title="Executive summary">
        <p className="whitespace-pre-wrap break-words">
          <CitedText text={report.executive_summary} sources={report.sources} />
        </p>
      </ReportSection>

      <ReportSection title="Key findings">
        <ul className="space-y-2 pl-5">
          {report.key_findings.map((finding, index) => (
            <li key={`${index}:${finding.slice(0, 24)}`} className="list-disc break-words marker:text-sky-300">
              <CitedText text={finding} sources={report.sources} />
            </li>
          ))}
        </ul>
      </ReportSection>

      <ReportSection title="Detailed analysis">
        <div className="space-y-5">
          {report.detailed_analysis.map((section, index) => (
            <div key={`${index}:${section.heading}`}>
              <h4 className="font-semibold text-slate-100">{section.heading}</h4>
              <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">
                <CitedText text={section.content} sources={report.sources} />
              </p>
            </div>
          ))}
        </div>
      </ReportSection>

      {report.different_viewpoints.length ? (
        <ReportSection title="Different viewpoints">
          <div className="space-y-4">
            {report.different_viewpoints.map((section, index) => (
              <div key={`${index}:${section.heading}`}>
                <h4 className="font-semibold text-slate-100">{section.heading}</h4>
                <p className="mt-1 whitespace-pre-wrap break-words text-slate-300">
                  <CitedText text={section.content} sources={report.sources} />
                </p>
              </div>
            ))}
          </div>
        </ReportSection>
      ) : null}

      <ReportSection title="Practical conclusion">
        <p className="whitespace-pre-wrap break-words">
          <CitedText text={report.practical_conclusion} sources={report.sources} />
        </p>
      </ReportSection>

      <ReportSection title="Research limitations">
        <ul className="space-y-1.5 pl-5">
          {report.research_limitations.map((limitation, index) => (
            <li key={`${index}:${limitation.slice(0, 24)}`} className="list-disc break-words marker:text-amber-300">
              <CitedText text={limitation} sources={report.sources} />
            </li>
          ))}
        </ul>
      </ReportSection>

      <section className="rounded-xl border border-sky-300/15 bg-sky-300/[0.035] p-4">
        <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-sky-200">Sources</h3>
        <div className="mt-3">
          <WebCitationList citations={report.sources} />
        </div>
      </section>
    </article>
  );
}
