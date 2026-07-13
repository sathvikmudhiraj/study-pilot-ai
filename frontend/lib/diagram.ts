export const DIAGRAM_TYPES = [
  "flowchart",
  "mind_map",
  "concept_map",
  "sequence_diagram",
  "timeline",
  "comparison_diagram",
  "study_process",
] as const;

export const DIAGRAM_SOURCE_TYPES = [
  "answer",
  "file",
  "summary",
  "topic",
  "web_search",
  "deep_research",
] as const;

export type DiagramType = (typeof DIAGRAM_TYPES)[number];
export type DiagramSourceType = (typeof DIAGRAM_SOURCE_TYPES)[number];

export type DiagramRequest = {
  diagramType: DiagramType;
  sourceType: DiagramSourceType;
  answerId?: string;
  fileId?: string;
  topic?: string;
  sourceText?: string;
};

export type DiagramResult = {
  title: string;
  diagram_type: DiagramType;
  source_type: DiagramSourceType;
  mermaid: string;
  explanation: string;
  generated_at: string;
};

export type DiagramSourceOption = {
  id: string;
  label: string;
  detail: string;
  sourceType: DiagramSourceType;
  answerId?: string;
  fileId?: string;
  sourceText?: string;
};

const MAX_RESPONSE_BYTES = 100_000;
const MAX_MERMAID_CHARS = 40_000;
const MAX_MERMAID_LINES = 400;
const MAX_SOURCE_TEXT_CHARS = 16_000;

const ALLOWED_ROOTS = [
  /^flowchart(?:\s|$)/i,
  /^graph(?:\s|$)/i,
  /^mindmap(?:\s|$)/i,
  /^sequenceDiagram(?:\s|$)/,
  /^timeline(?:\s|$)/i,
];

const RISKY_MERMAID_PATTERNS = [
  /%%\s*\{/i,
  /\bclick\s+[\w-]+/i,
  /\b(?:href|javascript|vbscript|file|ftp)\s*:/i,
  /\bdata\s*:\s*(?:text|image\/svg)/i,
  /https?:\/\//i,
  /(?:^|[\s"'(])\/\/[a-z0-9.-]+/im,
  /<\/?(?:script|iframe|object|embed|foreignObject|style|link|meta)\b/i,
  /\bon\w+\s*=/i,
];

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function limitedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function isDiagramType(value: unknown): value is DiagramType {
  return typeof value === "string" && (DIAGRAM_TYPES as readonly string[]).includes(value);
}

function isDiagramSourceType(value: unknown): value is DiagramSourceType {
  return typeof value === "string" && (DIAGRAM_SOURCE_TYPES as readonly string[]).includes(value);
}

function firstMermaidDirective(source: string): string {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("%%")) ?? "";
}

export function validateMermaidSource(source: string): string | null {
  const mermaid = source.trim();
  if (!mermaid) return "The diagram source is empty.";
  if (mermaid.length > MAX_MERMAID_CHARS) return "The diagram is too large to render safely.";
  if (mermaid.split(/\r?\n/).length > MAX_MERMAID_LINES) return "The diagram has too many lines to render safely.";

  const root = firstMermaidDirective(mermaid);
  if (!ALLOWED_ROOTS.some((pattern) => pattern.test(root))) {
    return "The diagram uses an unsupported Mermaid diagram type.";
  }

  if (RISKY_MERMAID_PATTERNS.some((pattern) => pattern.test(mermaid))) {
    return "The diagram contains content that cannot be rendered safely.";
  }

  return null;
}

export function boundDiagramSourceText(value: string): string {
  return value.replace(/\u0000/g, "").trim().slice(0, MAX_SOURCE_TEXT_CHARS);
}

function normalizeDiagramResult(value: unknown): DiagramResult | null {
  const root = recordValue(value);
  const record = recordValue(root?.diagram) ?? root;
  if (!record) return null;

  const title = limitedText(record.title, 200);
  const explanation = limitedText(record.explanation, 3_000);
  const mermaid = limitedText(record.mermaid, MAX_MERMAID_CHARS);
  const diagramType = record.diagram_type;
  const sourceType = record.source_type;
  const generatedAtValue = limitedText(record.generated_at, 80);
  const generatedAtDate = new Date(generatedAtValue);

  if (
    !title ||
    !explanation ||
    !isDiagramType(diagramType) ||
    !isDiagramSourceType(sourceType) ||
    !generatedAtValue ||
    Number.isNaN(generatedAtDate.getTime()) ||
    validateMermaidSource(mermaid)
  ) {
    return null;
  }

  return {
    title,
    diagram_type: diagramType,
    source_type: sourceType,
    mermaid,
    explanation,
    generated_at: generatedAtDate.toISOString(),
  };
}

function cleanServerError(value: unknown, status: number): string {
  const record = recordValue(value);
  const message = limitedText(record?.error, 300);
  if (message) return message;
  if (status === 401) return "Please sign in again to generate a diagram.";
  if (status === 429) return "Diagram generation limit reached. Please try again later.";
  return "Diagram generation failed. Please try again.";
}

function cleanRequest(request: DiagramRequest): DiagramRequest {
  if (!isDiagramType(request.diagramType) || !isDiagramSourceType(request.sourceType)) {
    throw new Error("Choose a supported diagram type and source.");
  }

  const base = { diagramType: request.diagramType, sourceType: request.sourceType };
  if (request.sourceType === "answer") {
    const answerId = limitedText(request.answerId, 128);
    if (!answerId) throw new Error("Choose a saved AI answer first.");
    return { ...base, answerId };
  }
  if (request.sourceType === "file" || request.sourceType === "summary") {
    const fileId = limitedText(request.fileId, 128);
    if (!fileId) throw new Error("Choose an attached file first.");
    return { ...base, fileId };
  }
  if (request.sourceType === "topic") {
    const topic = limitedText(request.topic, 500);
    if (topic.length < 2) throw new Error("Enter a topic for the diagram.");
    return { ...base, topic };
  }

  const sourceText = boundDiagramSourceText(request.sourceText ?? "");
  if (sourceText.length < 3) throw new Error("Choose a completed web or research result first.");
  return { ...base, sourceText };
}

export async function runDiagramGeneration(
  request: DiagramRequest,
  options: { signal?: AbortSignal } = {},
): Promise<DiagramResult> {
  const response = await fetch("/api/ai/diagram", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(cleanRequest(request)),
    signal: options.signal,
  });

  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_BYTES) {
    throw new Error("Diagram generation returned too much data. Please use a narrower source.");
  }

  let payload: unknown = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    if (!response.ok) throw new Error("Diagram generation failed. Please try again.");
    throw new Error("Diagram generation returned an unreadable response.");
  }

  if (!response.ok) throw new Error(cleanServerError(payload, response.status));
  const diagram = normalizeDiagramResult(payload);
  if (!diagram) throw new Error("Diagram generation returned an invalid or unsafe diagram.");
  return diagram;
}
