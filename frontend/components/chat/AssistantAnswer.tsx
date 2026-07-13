"use client";

import { Markdown } from "./Markdown";
import { SourceCitationChips, type SourceCitationValue } from "../SourceCitationChips";

export type ChatAnswer = {
  short_answer?: string;
  simple_explanation?: string;
  step_by_step?: string[];
  example?: string;
  memory_line?: string;
  common_mistake?: string;
  exam_viva_answer?: string;
  practice_question?: string;
  related_files_notes?: string[];
  next_step?: string;
  source_chips?: { id?: string; label: string; type: string }[];
  source_citations?: SourceCitationValue[];
};

type Section = {
  heading: string;
  body: string | string[];
  accent?: boolean;
};

/** Assemble the structured answer into ordered, labeled blocks. */
function buildSections(answer: ChatAnswer): Section[] {
  const sections: Section[] = [];
  if (answer.short_answer?.trim()) sections.push({ heading: "Short answer", body: answer.short_answer });
  if (answer.simple_explanation?.trim()) sections.push({ heading: "Simple explanation", body: answer.simple_explanation });
  if (answer.step_by_step?.length) sections.push({ heading: "Step-by-step", body: answer.step_by_step });
  if (answer.example?.trim()) sections.push({ heading: "Example", body: answer.example });
  if (answer.memory_line?.trim()) sections.push({ heading: "Memory trick", body: answer.memory_line, accent: true });
  if (answer.common_mistake?.trim()) sections.push({ heading: "Common mistake", body: answer.common_mistake });
  if (answer.exam_viva_answer?.trim()) sections.push({ heading: "Exam / viva answer", body: answer.exam_viva_answer });
  if (answer.practice_question?.trim()) sections.push({ heading: "Practice question", body: answer.practice_question });
  if (answer.related_files_notes?.length) sections.push({ heading: "Related files & notes", body: answer.related_files_notes });
  if (answer.next_step?.trim()) sections.push({ heading: "Next step", body: answer.next_step });
  return sections;
}

export function answerToText(answer: ChatAnswer): string {
  const sections = buildSections(answer);
  if (!sections.length) return "";
  return sections
    .map((section) => {
      const body = Array.isArray(section.body) ? section.body.map((line) => `• ${line}`).join("\n") : section.body;
      return `${section.heading}\n${body}`;
    })
    .join("\n\n");
}

function hasContent(answer: ChatAnswer) {
  return buildSections(answer).length > 0;
}

/**
 * Renders a structured AI answer as a clean conversational body.
 * The lead short_answer is shown as primary prose; remaining sections use
 * lightweight inline headings instead of heavy bordered cards.
 */
export function AssistantAnswer({ answer }: { answer: ChatAnswer }) {
  const lead = answer.short_answer?.trim() ? answer.short_answer : answer.simple_explanation?.trim();
  const rest = buildSections(answer).filter(
    (section) => section.heading !== "Short answer" && (lead ? section.heading !== "Simple explanation" : true),
  );

  const hasCitations = !!answer.source_citations?.length;
  const hasLegacyChips = !hasCitations && !!answer.source_chips?.length;

  if (!hasContent(answer)) {
    return <p className="text-sm leading-6 text-slate-400">No answer was returned. Try rephrasing your question.</p>;
  }

  return (
    <div className="min-w-0 text-sm leading-6 text-slate-200">
      {lead ? <Markdown>{lead}</Markdown> : null}

      {rest.length ? (
        <div className="mt-3 grid gap-3">
          {rest.map((section) => (
            <div key={section.heading} className="min-w-0">
              <h4
                className={`mb-1 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
                  section.accent ? "text-emerald-300" : "text-slate-400"
                }`}
              >
                {section.accent ? <span aria-hidden="true">💡</span> : null}
                {section.heading}
              </h4>
              {Array.isArray(section.body) ? (
                <ul className="list-disc space-y-1 pl-5 marker:text-slate-500">
                  {section.body.map((item, index) => (
                    <li key={index}>
                      <Markdown>{item}</Markdown>
                    </li>
                  ))}
                </ul>
              ) : (
                <Markdown>{section.body}</Markdown>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {hasCitations ? (
        <div className="mt-4">
          <SourceCitationChips citations={answer.source_citations!} />
        </div>
      ) : null}

      {hasLegacyChips ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-300/80">Sources</p>
          <div className="flex flex-wrap gap-2">
            {answer.source_chips!.map((source) => (
              <span
                key={`${source.type}:${source.id ?? source.label}`}
                className="max-w-full break-words rounded-md border border-amber-200/20 bg-amber-200/10 px-2 py-1 text-xs font-medium text-amber-100"
              >
                {source.type}: {source.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
