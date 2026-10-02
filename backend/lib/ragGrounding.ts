import { uniqueSourceCitations, type SourceCitation } from "./sourceCitations";
import { localizedRuntimeCopy } from "@/shared/runtimeMessages";
import type { SupportedLanguageCode } from "@/shared/languages";

export type GroundedChatAnswer = {
  response_mode?: "ai" | "cache" | "offline_fallback";
  short_answer: string;
  simple_explanation: string;
  step_by_step: string[];
  example: string;
  memory_line: string;
  common_mistake: string;
  exam_viva_answer: string;
  practice_question: string;
  related_files_notes: string[];
  next_step: string;
  found_in_notes?: boolean;
  source_ids?: string[];
  source_citations?: SourceCitation[];
  source_chips?: Array<{
    id?: string;
    label: string;
    type: "Saved summary" | "Extracted text" | "Manual notes" | "Previous answer";
  }>;
};

export function unsupportedSelectedMaterialAnswer(language: SupportedLanguageCode = "en"): GroundedChatAnswer {
  const copy = localizedRuntimeCopy(language);
  return {
    response_mode: "ai",
    short_answer: copy.topicNotFound,
    simple_explanation: "",
    step_by_step: [],
    example: "",
    memory_line: "",
    common_mistake: "",
    exam_viva_answer: "",
    practice_question: "",
    related_files_notes: [],
    next_step: copy.topicNotFoundNextStep,
    found_in_notes: false,
    source_ids: [],
    source_citations: [],
    source_chips: [],
  };
}

export function applyGroundingValidation(
  answer: GroundedChatAnswer,
  allowedCitations: SourceCitation[],
  language: SupportedLanguageCode = "en",
): GroundedChatAnswer {
  const byId = new Map(allowedCitations.map((citation) => [citation.id, citation]));
  const requestedIds = Array.isArray(answer.source_ids) ? answer.source_ids : [];
  const matched = uniqueSourceCitations(
    requestedIds
      .map((id) => byId.get(id))
      .filter((citation): citation is SourceCitation => Boolean(citation)),
    8,
  );

  if (answer.found_in_notes === false || matched.length === 0) {
    return unsupportedSelectedMaterialAnswer(language);
  }

  return {
    ...answer,
    found_in_notes: true,
    source_ids: matched.map((citation) => citation.id),
    source_citations: matched,
  };
}
