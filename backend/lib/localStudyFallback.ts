import type { SourceCitation } from "./sourceCitations";
import type { StructuredChatAnswer } from "./aiChat";
import type { GeneratedQuiz, QuizOptions, QuizQuestion } from "./aiQuiz";
import type { RevisionPlan, StudyContext } from "./aiRevisionPlan";
import { canonicalTopicId } from "@/shared/languages";
import JSZip from "jszip";

export async function readLocalDocxParagraphs(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  const decode = (value: string) => value.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (entity, numeric: string | undefined, named: string | undefined) => {
    if (numeric) return String.fromCodePoint(numeric.startsWith("x") ? parseInt(numeric.slice(1), 16) : parseInt(numeric, 10));
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[named?.toLowerCase() ?? ""] ?? entity;
  });
  return [...xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((paragraph) => [...paragraph[1].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((run) => decode(run[1])).join(""))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export type LocalSource = { id: string; label: string; text: string; citation?: SourceCitation };
export type LocalFact = { id: string; topic: string; text: string; source: LocalSource; kind: "definition" | "comparison" | "example" | "list" | "fact"; score: number; order: number };

const genericHeading = /^(?:chapter|unit|module|section|page|contents?|introduction|conclusion|references?|bibliography|overview|summary|questions?|exercise|objectives?|learning outcomes?)\b/i;
const internalContextHeading = /^(?:saved summary context|retrieved context|page context|selected file extracted text|study context|chunk(?:\s+\d+(?:\s+of\s+\d+)?)?)\s*:?(?:\s*[-â€”]\s*.*)?$/i;
const definitionPattern = /^([A-Za-z][A-Za-z0-9 /()\-]{2,48}?)\s+(?:is|are|means|refers to|is defined as|can be defined as)\s+(.{15,})$/i;
const stopWords = new Set(["the", "and", "for", "with", "from", "this", "that", "what", "which", "into", "about", "have", "their", "there", "these", "were", "being", "also", "using", "used", "such", "each", "than"]);

function tidy(text: string) {
  return text.replace(/\s+/g, " ").replace(/^[\s\u2022\u25cf*\-]+/, "").trim();
}

function isHeading(line: string) {
  const value = tidy(line).replace(/^\d+(?:\.\d+)*[.)]?\s*/, "").replace(/:$/, "");
  if (value.length < 4 || value.length > 65 || /[.!?]$/.test(value) || value.split(/\s+/).length > 7) return false;
  if (genericHeading.test(value) && value.split(/\s+/).length < 4) return false;
  if (/^(?:syntax|example|result|output|query|code|general syntax|look at|consider|following)/i.test(value)) return false;
  return /^[A-Z][A-Za-z0-9 &,()/\-]+$/.test(value) &&
    (line.trim().endsWith(":") || value === value.toUpperCase() || value.split(/\s+/).filter((word) => /^[A-Z]/.test(word)).length >= Math.ceil(value.split(/\s+/).length * 0.6));
}

function topicFromSentence(sentence: string) {
  const match = sentence.match(definitionPattern);
  if (match && match[1].split(/\s+/).length <= 6 && !/^(?:so|if|here|when|where|there|this|that|these|those|following|the condition|one of|same|they|we|you|some|any|all|each)\b/i.test(match[1])) return tidy(match[1]).replace(/^(?:an?|the)\s+/i, "");
  return "";
}

function factKind(sentence: string): LocalFact["kind"] {
  if (topicFromSentence(sentence)) return "definition";
  if (/\b(?:whereas|unlike|compared with|difference between|versus| vs\.? )\b/i.test(sentence)) return "comparison";
  if (/\b(?:for example|e\.g\.|such as|for instance)\b/i.test(sentence)) return "example";
  if (/^(?:\d+[.)]|[a-z][.)]|[\u2022*-])\s/i.test(sentence)) return "list";
  return "fact";
}

function stableId(source: LocalSource, text: string) {
  let hash = 2166136261;
  for (const char of `${source.id}:${text.toLowerCase()}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${source.id}:${(hash >>> 0).toString(36)}`;
}

export function analyzeLocalSources(sources: LocalSource[]): LocalFact[] {
  const facts: LocalFact[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    let heading = "";
    const lines = source.text.replace(/\r/g, "").split(/\n+/);
    for (const line of lines) {
      const raw = line.trim();
      if (internalContextHeading.test(raw)) {
        heading = "";
        continue;
      }
      if (isHeading(raw)) { heading = tidy(raw).replace(/:$/, "").replace(/^\d+(?:\.\d+)*[.)]?\s*/, ""); continue; }
      for (const part of raw.split(/(?<=[.!?])\s+(?=[A-Z(\d])/)) {
        const sentence = tidy(part);
        if (sentence.length < 32 || sentence.length > 360 || !/[a-zA-Z]{3}/.test(sentence)) continue;
        if (!/[.!?]$/.test(sentence) && !topicFromSentence(sentence)) continue;
        if (/^(?:figure|table|copyright|http|www\.|references?|page \d+|select\s|from\s|where\s|insert\s|update\s|delete\s|end\s|if\s.*then\b)\b/i.test(sentence)) continue;
        if (/\b(?:select|insert|update|delete)\s+.{0,80}\bfrom\b/i.test(sentence)) continue;
        const key = sentence.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 160);
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = factKind(sentence);
        const topic = topicFromSentence(sentence) || heading || source.label.replace(/\.[^.]+$/, "");
        if (internalContextHeading.test(topic)) continue;
        const score = (kind === "definition" ? 5 : kind === "comparison" ? 4 : kind === "list" ? 3 : 2) + (heading ? 2 : 0) + (sentence.length < 250 ? 1 : 0);
        facts.push({ id: stableId(source, sentence), topic, text: sentence, source, kind, score, order: facts.length });
      }
    }
  }
  const frequency = new Map<string, number>();
  for (const fact of facts) for (const word of fact.topic.toLowerCase().match(/[a-z]{4,}/g) ?? []) if (!stopWords.has(word)) frequency.set(word, (frequency.get(word) ?? 0) + 1);
  return facts.map((fact) => ({ ...fact, score: fact.score + Math.min(3, Math.max(0, ...((fact.topic.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((word) => (frequency.get(word) ?? 0) - 1)))) }));
}

function selectDiverse(facts: LocalFact[], count: number, excluded = new Set<string>()) {
  const selected: LocalFact[] = [];
  const topicCounts = new Map<string, number>();
  const seenIds = new Set<string>();
  const available = facts.filter((fact) => {
    if (excluded.has(fact.id) || seenIds.has(fact.id)) return false;
    seenIds.add(fact.id);
    return true;
  });
  while (selected.length < count && available.length) {
    available.sort((a, b) => {
      const aRepeated = topicCounts.get(a.topic.toLowerCase()) ?? 0;
      const bRepeated = topicCounts.get(b.topic.toLowerCase()) ?? 0;
      return aRepeated - bRepeated || Math.floor(a.order / 12) - Math.floor(b.order / 12) || b.score - a.score || a.order - b.order;
    });
    const chosen = available.shift()!;
    selected.push(chosen);
    topicCounts.set(chosen.topic.toLowerCase(), (topicCounts.get(chosen.topic.toLowerCase()) ?? 0) + 1);
  }
  return selected;
}

export function buildLocalChatAnswer(args: { question: string; sources: LocalSource[]; excludedIds?: string[]; language?: string; count?: number }): StructuredChatAnswer & { fallback_item_ids: string[]; source_citations: SourceCitation[] } {
  const all = analyzeLocalSources(args.sources);
  const query = args.question.toLowerCase();
  const isViva = /\bviva\b|oral exam/.test(query);
  const isExam = isViva || /exam questions?|practice questions?/.test(query);
  const beginner = /beginner|simply|simple terms|easy words|like a child/.test(query);
  const topicWise = /topic.wise|by topic|topics separated/.test(query);
  const telugu = args.language === "te";
  const excluded = new Set(args.excludedIds ?? []);
  const selected = selectDiverse(beginner ? [...all.filter((fact) => fact.kind === "definition" && fact.text.length < 180), ...all] : all, args.count ?? (isExam ? 5 : beginner ? 3 : 6), excluded);
  const citations = [...new Map(selected.map((fact) => [fact.source.citation?.id, fact.source.citation]).filter((pair): pair is [string, SourceCitation] => Boolean(pair[0] && pair[1]))).values()];
  const cite = (fact: LocalFact) => fact.source.citation ? ` [${fact.source.citation.id}]` : "";
  const topic = (fact: LocalFact) => telugu ? `విషయం: ${fact.topic}\nమూల పత్రం: ${fact.text}${cite(fact)}` : `${fact.topic}: ${fact.text}${cite(fact)}`;
  const questionFor = (fact: LocalFact) => telugu ? `ఈ పత్రం ప్రకారం ${fact.topic} గురించి ఏమి చెప్పబడింది?` : fact.kind === "definition" ? `How does the material define ${fact.topic}?` : `What key point does the material give about ${fact.topic}?`;
  const steps = isExam
    ? selected.map((fact, index) => `${index + 1}. ${questionFor(fact)}${isViva ? `\n   ${telugu ? "జవాబు" : "Short answer"}: ${fact.text}${cite(fact)}` : `\n   ${telugu ? "జవాబు" : "Answer"}: ${fact.text}${cite(fact)}`}`)
    : selected.map((fact) => topic(fact));
  const opening = telugu ? (isExam ? "పత్రం ఆధారంగా ప్రశ్నలు మరియు జవాబులు:" : "ఈ పత్రంలోని ముఖ్యమైన అంశాలు:") : isExam ? "Questions from the selected material:" : topicWise ? "Topic-wise points from the selected material:" : beginner ? "Here are the main ideas in simpler steps:" : "Important points from the selected material:";
  const noMore = telugu ? "ఈ పత్రంలో వేరే అంశాలు కనిపించలేదు." : "No more distinct points were found in the selected material.";
  return {
    short_answer: selected.length ? opening : noMore,
    simple_explanation: selected.length ? `${opening}\n\n${steps.join("\n\n")}` : noMore,
    step_by_step: steps,
    example: selected.find((fact) => fact.kind === "example")?.text ?? "",
    memory_line: "",
    common_mistake: "",
    exam_viva_answer: isViva ? steps.join("\n\n") : "",
    practice_question: selected[0] && !isExam ? questionFor(selected[0]) : "",
    related_files_notes: [...new Set(selected.map((fact) => fact.source.label))],
    next_step: selected.length ? (telugu ? "మరిన్ని అంశాల కోసం next అని టైప్ చేయండి." : "Type next for more from this file.") : "",
    found_in_notes: selected.length > 0,
    source_ids: citations.map((citation) => citation.id),
    fallback_item_ids: selected.map((fact) => fact.id),
    source_citations: citations,
  };
}

export function buildLocalQuiz(sourceText: string, options: QuizOptions = {}): GeneratedQuiz {
  const facts = analyzeLocalSources([{ id: "quiz-source", label: "Selected study material", text: sourceText }]);
  const count = Math.max(1, Math.min(20, options.count ?? 8));
  const selected = selectDiverse(facts, count);
  if (!selected.length) throw new Error("No readable facts found to generate a quiz from.");
  const definitions = facts.filter((fact) => fact.kind === "definition" && fact.topic.length < 55);
  const requested = options.questionTypes?.length ? options.questionTypes : ["mcq", "short"];
  const questions: QuizQuestion[] = selected.map((fact, index) => {
    const topic = fact.topic;
    const base = { id: `q${index + 1}`, topic, topic_en: topic, topic_id: canonicalTopicId(topic), explanation: fact.text };
    const body = fact.kind === "definition" ? fact.text.match(definitionPattern)?.[2]?.trim() ?? "" : "";
    const distractors = definitions.filter((other) => other.topic.toLowerCase() !== topic.toLowerCase() && !body.toLowerCase().includes(other.topic.toLowerCase())).map((other) => other.topic).filter((value, i, all) => all.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === i).slice(0, 3);
    if (requested.includes("mcq") && body.length >= 20 && body.length <= 180 && !body.toLowerCase().includes(topic.toLowerCase()) && distractors.length >= 2) {
      const optionsList = [topic, ...distractors];
      const offset = index % optionsList.length;
      const shuffled = [...optionsList.slice(offset), ...optionsList.slice(0, offset)];
      return { ...base, type: "mcq", question: `Which term in the material matches this description: ${body.replace(/[.!?]+$/, "")}?`, options: shuffled, correct_index: shuffled.indexOf(topic), acceptable_answers: [] };
    }
    return { ...base, type: "short", question: `According to the material, what is stated about ${topic}?`, options: [], correct_index: null, acceptable_answers: [fact.text], explanation: fact.text };
  });
  return { title: "Practice quiz from study material", difficulty: options.difficulty ?? "medium", questions, source_summary: `Covers ${[...new Set(selected.map((fact) => fact.topic))].slice(0, 5).join(", ")}.` };
}

export function buildLocalRevisionPlan(ctx: StudyContext, start = new Date()): RevisionPlan {
  const sources: LocalSource[] = [
    ...ctx.files.map((file, index) => ({ id: `file-${index}`, label: file.file_name, text: file.extracted_text })),
    ...ctx.notes.map((note, index) => ({ id: `note-${index}`, label: note.title, text: note.raw_notes })),
  ];
  const facts = analyzeLocalSources(sources);
  const fileLabels = new Set(sources.map((source) => source.label.replace(/\.[^.]+$/, "").toLowerCase()));
  const topicFacts = facts.filter((fact) => !fileLabels.has(fact.topic.toLowerCase()) && !/^(?:the )?(?:same|records?|result|operators?|features?|tables?|queries?|statements?|examples?|syntax)$/i.test(fact.topic.trim()));
  const topics = [...new Set(selectDiverse(topicFacts.length ? topicFacts : facts, 50).map((fact) => fact.topic))].slice(0, 21);
  if (!topics.length) throw new Error("No readable topics found to build a revision plan from.");
  const weak = ctx.quiz_analytics.weak_topics.filter((item) => topics.some((topic) => topic.toLowerCase().includes(item.toLowerCase()) || item.toLowerCase().includes(topic.toLowerCase())));
  const ordered = [...new Set([...weak, ...topics])];
  const dayCount = 7;
  const date = (offset: number) => { const value = new Date(start); value.setDate(value.getDate() + offset); return value.toISOString().slice(0, 10); };
  const daily_plan = Array.from({ length: dayCount }, (_, index) => {
    const focus = ordered.slice(Math.floor(index * ordered.length / dayCount), Math.max(Math.floor((index + 1) * ordered.length / dayCount), Math.floor(index * ordered.length / dayCount) + 1));
    const evidence = focus.map((topic) => facts.find((fact) => fact.topic === topic)?.text).filter((value): value is string => Boolean(value)).slice(0, 2);
    return { day: index + 1, date: date(index), focus_topics: focus, tasks: [`Review the selected material for ${focus.join(" and ")}.`, ...evidence.map((value) => `Recall and explain: ${value}`), `Answer two practice questions about ${focus[0]}.`], estimated_time: "45 minutes" };
  });
  return { title: "7-day revision plan", important_topics: ordered, revise_first: ordered.slice(0, Math.max(2, Math.ceil(ordered.length / 3))), pending_topics: ordered.slice(Math.max(2, Math.ceil(ordered.length / 3))), daily_plan, starts_on: date(0), ends_on: date(dayCount - 1), plan: { total_days: dayCount, next_steps: ["Review topics you could not explain without notes.", "Take another practice quiz from the same material."], study_tips: ["Use active recall before rereading the source.", "Check each answer against the uploaded material."], strong_topics: ctx.quiz_analytics.strong_topics.filter((item) => topics.includes(item)), weak_topics: weak, last_quiz_score: ctx.quiz_analytics.last_quiz_score } };
}
