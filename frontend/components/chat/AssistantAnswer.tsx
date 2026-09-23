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
  learning_step?: unknown;
  source_chips?: { id?: string; label: string; type: string }[];
  source_citations?: SourceCitationValue[];
  found_in_notes?: boolean;
  source_ids?: string[];
};

type Section = {
  heading: string;
  body: string | string[];
  accent?: boolean;
};

const PLACEHOLDER_VALUES = new Set(["string", "example", "placeholder", "null", "undefined", "n/a", "none", "todo"]);

function cleanDisplayText(value: unknown) {
  const text = String(value ?? "")
    .normalize("NFKC")
    .replace(/^\s*["'`]+|["'`]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const normalized = text.toLowerCase().replace(/[.!?;:]+$/g, "").trim();
  if (PLACEHOLDER_VALUES.has(normalized)) return "";
  if (/^PRACTICE QUESTION:\s*string$/i.test(text)) return "";
  if (/^NEXT STEP:\s*string$/i.test(text)) return "";
  return text;
}

function cleanDisplayList(value: unknown) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of value) {
    const cleaned = cleanDisplayText(item);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    items.push(cleaned);
  }
  return items;
}

/** Assemble the structured answer into ordered, labeled blocks. */
function buildSections(answer: ChatAnswer): Section[] {
  const sections: Section[] = [];
  const shortAnswer = cleanDisplayText(answer.short_answer);
  const simpleExplanation = cleanDisplayText(answer.simple_explanation);
  const stepByStep = cleanDisplayList(answer.step_by_step);
  const example = cleanDisplayText(answer.example);
  const memoryLine = cleanDisplayText(answer.memory_line);
  const commonMistake = cleanDisplayText(answer.common_mistake);
  const examAnswer = cleanDisplayText(answer.exam_viva_answer);
  const practiceQuestion = cleanDisplayText(answer.practice_question);
  const related = cleanDisplayList(answer.related_files_notes);
  const nextStep = cleanDisplayText(answer.next_step);

  if (shortAnswer) sections.push({ heading: "Short answer", body: shortAnswer });
  if (simpleExplanation) sections.push({ heading: "Simple explanation", body: simpleExplanation });
  if (stepByStep.length) sections.push({ heading: "Step-by-step", body: stepByStep });
  if (example) sections.push({ heading: "Example", body: example });
  if (memoryLine) sections.push({ heading: "Memory trick", body: memoryLine, accent: true });
  if (commonMistake) sections.push({ heading: "Common mistake", body: commonMistake });
  if (examAnswer) sections.push({ heading: "Exam / viva answer", body: examAnswer });
  if (practiceQuestion) sections.push({ heading: "Practice question", body: practiceQuestion });
  if (related.length) sections.push({ heading: "Related files & notes", body: related });
  if (nextStep) sections.push({ heading: "Next step", body: nextStep });
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
  if (answer.found_in_notes === false) {
    return (
      <div className="min-w-0 text-sm leading-6 text-slate-200">
        <p className="font-medium text-amber-100">Not found in your selected notes.</p>
        <p className="mt-1 text-slate-400">StudyPilot did not find enough supporting evidence in the selected study material.</p>
        <button
          type="button"
          className="mt-3 rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] px-3 py-1.5 text-xs font-semibold text-cyan-100"
        >
          Search outside my notes
        </button>
      </div>
    );
  }

  const lead = cleanDisplayText(answer.short_answer) || cleanDisplayText(answer.simple_explanation);
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
