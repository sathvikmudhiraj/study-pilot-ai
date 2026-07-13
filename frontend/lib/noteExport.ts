import { normalizeSourceCitations, type SourceCitationValue } from "@/frontend/components/SourceCitationChips";
import type { StudyNoteDraft } from "./studyNotes";

export type NoteExportFormat = "pdf" | "docx" | "markdown" | "txt";

export type CanonicalNoteExport = {
  heading: "StudyPilot AI";
  title: string;
  generatedDate: string;
  body: string;
  sources: string[];
};

export const MAX_NOTE_EXPORT_CHARACTERS = 100_000;

const formatExtensions: Record<NoteExportFormat, string> = {
  pdf: "pdf",
  docx: "docx",
  markdown: "md",
  txt: "txt",
};

const formatMimeTypes: Record<Exclude<NoteExportFormat, "pdf" | "docx">, string> = {
  markdown: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};

const SENSITIVE_VALUE_HIDDEN = "[sensitive value hidden]";
const LOCAL_PATH_HIDDEN = "[local path hidden]";

/**
 * Export is a trust boundary: notes may be manually edited or contain text
 * copied from logs. Redact high-confidence credentials and machine-local paths
 * without changing the note that remains visible in the editor.
 */
export function sanitizeNoteExportText(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi,
      SENSITIVE_VALUE_HIDDEN,
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, `Bearer ${SENSITIVE_VALUE_HIDDEN}`)
    .replace(
      /\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,}|nvapi-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,})\b/g,
      SENSITIVE_VALUE_HIDDEN,
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      SENSITIVE_VALUE_HIDDEN,
    )
    .replace(
      /(\b(?:[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|PRIVATE[_-]?KEY)|api\s+key|access\s+token|auth\s+token|client\s+secret|password)\b\s*[:=]\s*)(?:"[^"\r\n]{4,}"|'[^'\r\n]{4,}'|[^\s,;]{4,})/gi,
      `$1${SENSITIVE_VALUE_HIDDEN}`,
    )
    .replace(/\bfile:\/\/\/?[^\s"'<>]+/gi, LOCAL_PATH_HIDDEN)
    .replace(/\b[A-Za-z]:\\Users\\[^\r\n"'<>|]+/g, LOCAL_PATH_HIDDEN)
    .replace(/(?:\/Users\/|\/home\/)[^\s"'<>]+/g, LOCAL_PATH_HIDDEN);
}

function formatGeneratedDate(value?: string): string {
  const candidate = value ? new Date(value) : new Date();
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatSourceCitation(citation: SourceCitationValue): string {
  const sourceName = citation.source_name.trim() || "Study material";
  if (!citation.locator_type || citation.locator_start === undefined) return sourceName;

  const noun =
    citation.locator_type === "page"
      ? "Page"
      : citation.locator_type === "slide"
        ? "Slide"
        : "Chunk";
  const locator =
    citation.locator_end !== undefined && citation.locator_end !== citation.locator_start
      ? `${citation.locator_start}-${citation.locator_end}`
      : String(citation.locator_start);
  return `${sourceName} - ${noun} ${locator}`;
}

export function buildCanonicalNoteExport(note: StudyNoteDraft): CanonicalNoteExport {
  const rawTitle = note.title.trim();
  const rawBody = note.content.trim();

  if (!rawTitle) throw new Error("Add a title before downloading the note.");
  if (!rawBody) throw new Error("Add note content before downloading.");
  if (rawTitle.length + rawBody.length > MAX_NOTE_EXPORT_CHARACTERS) {
    throw new Error(
      `Keep the note under ${MAX_NOTE_EXPORT_CHARACTERS.toLocaleString()} characters before downloading.`,
    );
  }

  const title = sanitizeNoteExportText(rawTitle);
  const body = sanitizeNoteExportText(rawBody);

  const citations = normalizeSourceCitations([
    ...note.citations,
    ...(note.metadata?.source_citations ?? []),
  ]);

  return {
    heading: "StudyPilot AI",
    title,
    generatedDate: formatGeneratedDate(note.metadata?.generated_at ?? note.createdAt),
    body,
    sources: citations.map(formatSourceCitation).map(sanitizeNoteExportText),
  };
}

export function sanitizeNoteFilename(title: string, format: NoteExportFormat): string {
  const stem = Array.from(
    title
      .normalize("NFKC")
      // Unicode marks are part of Telugu/Devanagari graphemes; retaining them
      // avoids turning a safe multilingual title into broken consonants.
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "StudyPilot-Notes",
  )
    .slice(0, 100)
    .join("")
    .replace(/-+$/g, "");
  return `${stem || "StudyPilot-Notes"}.${formatExtensions[format]}`;
}

export function buildNoteMarkdown(model: CanonicalNoteExport): string {
  return [
    `# ${model.heading}`,
    "",
    `## ${model.title}`,
    "",
    `*Generated: ${model.generatedDate}*`,
    "",
    model.body,
    "",
    "## Verified sources",
    "",
    ...(model.sources.length
      ? model.sources.map((source) => `- ${source}`)
      : ["- No verified sources available."]),
    "",
  ].join("\n");
}

export function buildNoteText(model: CanonicalNoteExport): string {
  return [
    model.heading,
    model.title,
    `Generated: ${model.generatedDate}`,
    "",
    model.body,
    "",
    "VERIFIED SOURCES",
    ...(model.sources.length
      ? model.sources.map((source) => `- ${source}`)
      : ["- No verified sources available."]),
    "",
  ].join("\n");
}

async function createDocxBlob(model: CanonicalNoteExport): Promise<Blob> {
  const docx = await import("docx");
  const children = [
    new docx.Paragraph({
      text: model.heading,
      heading: docx.HeadingLevel.TITLE,
    }),
    new docx.Paragraph({
      text: model.title,
      heading: docx.HeadingLevel.HEADING_1,
    }),
    new docx.Paragraph({
      children: [new docx.TextRun({ text: `Generated: ${model.generatedDate}`, italics: true })],
      spacing: { after: 320 },
    }),
  ];

  for (const rawLine of model.body.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trimStart());
    const bullet = /^[-*+]\s+(.+)$/.exec(line.trimStart());

    if (!line.trim()) {
      children.push(new docx.Paragraph({ text: "", spacing: { after: 120 } }));
    } else if (heading) {
      children.push(
        new docx.Paragraph({
          text: heading[2],
          heading:
            heading[1].length === 1
              ? docx.HeadingLevel.HEADING_2
              : docx.HeadingLevel.HEADING_3,
        }),
      );
    } else if (bullet) {
      children.push(new docx.Paragraph({ text: bullet[1], bullet: { level: 0 } }));
    } else {
      children.push(new docx.Paragraph({ text: line, spacing: { after: 120 } }));
    }
  }

  children.push(
    new docx.Paragraph({
      text: "Verified sources",
      heading: docx.HeadingLevel.HEADING_2,
      spacing: { before: 320 },
    }),
  );
  if (model.sources.length) {
    for (const source of model.sources) {
      children.push(new docx.Paragraph({ text: source, bullet: { level: 0 } }));
    }
  } else {
    children.push(new docx.Paragraph({ text: "No verified sources available." }));
  }

  const document = new docx.Document({
    creator: "StudyPilot AI",
    title: model.title,
    description: "Study notes exported from StudyPilot AI",
    sections: [{ properties: {}, children }],
  });
  return docx.Packer.toBlob(document);
}

type CanvasBlock = {
  text: string;
  size: number;
  weight: 400 | 600 | 700;
  color: string;
  lineHeight: number;
  marginBefore?: number;
  marginAfter?: number;
  prefix?: string;
  indent?: number;
  rule?: boolean;
};

const canvasPage = {
  width: 794,
  height: 1123,
  paddingX: 64,
  paddingY: 58,
};

const pdfPage = {
  width: 595.28,
  height: 841.89,
};

const canvasFontFamily =
  'system-ui, "Nirmala UI", "Noto Sans Telugu", "Noto Sans Devanagari", "Noto Sans", sans-serif';

function bodyCanvasBlocks(body: string): CanvasBlock[] {
  const blocks: CanvasBlock[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    const bullet = /^[-*+]\s+(.+)$/.exec(trimmed);
    const numbered = /^(\d+[.)])\s+(.+)$/.exec(trimmed);

    if (!trimmed) {
      blocks.push({ text: "", size: 17, weight: 400, color: "#1e293b", lineHeight: 14 });
    } else if (heading) {
      blocks.push({
        text: heading[2],
        size: heading[1].length === 1 ? 22 : 19,
        weight: 700,
        color: "#0f172a",
        lineHeight: heading[1].length === 1 ? 29 : 26,
        marginBefore: 10,
        marginAfter: 5,
      });
    } else if (bullet) {
      blocks.push({
        text: bullet[1],
        prefix: "•",
        indent: 8,
        size: 17,
        weight: 400,
        color: "#1e293b",
        lineHeight: 25,
        marginAfter: 3,
      });
    } else if (numbered) {
      blocks.push({
        text: numbered[2],
        prefix: numbered[1],
        indent: 8,
        size: 17,
        weight: 400,
        color: "#1e293b",
        lineHeight: 25,
        marginAfter: 3,
      });
    } else {
      blocks.push({
        text: rawLine.trimEnd(),
        size: 17,
        weight: 400,
        color: "#1e293b",
        lineHeight: 25,
        marginAfter: 4,
      });
    }
  }
  return blocks;
}

function canvasBlocks(model: CanonicalNoteExport): CanvasBlock[] {
  return [
    {
      text: model.heading,
      size: 27,
      weight: 700,
      color: "#047857",
      lineHeight: 35,
      marginAfter: 8,
    },
    {
      text: model.title,
      size: 24,
      weight: 700,
      color: "#0f172a",
      lineHeight: 32,
      marginAfter: 8,
    },
    {
      text: `Generated: ${model.generatedDate}`,
      size: 14,
      weight: 400,
      color: "#64748b",
      lineHeight: 21,
      marginAfter: 15,
    },
    {
      text: "",
      size: 1,
      weight: 400,
      color: "#cbd5e1",
      lineHeight: 1,
      marginAfter: 18,
      rule: true,
    },
    ...bodyCanvasBlocks(model.body),
    {
      text: "Verified sources",
      size: 20,
      weight: 700,
      color: "#0f172a",
      lineHeight: 28,
      marginBefore: 22,
      marginAfter: 7,
    },
    ...(model.sources.length
      ? model.sources.map<CanvasBlock>((source) => ({
          text: source,
          prefix: "•",
          indent: 8,
          size: 15,
          weight: 400,
          color: "#334155",
          lineHeight: 23,
          marginAfter: 3,
        }))
      : [
          {
            text: "No verified sources available.",
            size: 15,
            weight: 400,
            color: "#64748b",
            lineHeight: 23,
          } satisfies CanvasBlock,
        ]),
  ];
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function splitLongToken(
  context: CanvasRenderingContext2D,
  token: string,
  maxWidth: number,
): string[] {
  const parts: string[] = [];
  let current = "";

  for (const grapheme of graphemes(token)) {
    const candidate = `${current}${grapheme}`;
    if (current && context.measureText(candidate).width > maxWidth) {
      parts.push(current);
      current = grapheme;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  if (!text) return [""];
  const tokens = text.split(/(\s+)/u).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    if (/^\s+$/u.test(token)) {
      if (current && !current.endsWith(" ")) current += " ";
      continue;
    }

    const cleanCurrent = current.trimEnd();
    const candidate = cleanCurrent ? `${cleanCurrent} ${token}` : token;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (cleanCurrent) lines.push(cleanCurrent);
    if (context.measureText(token).width <= maxWidth) {
      current = token;
      continue;
    }

    const pieces = splitLongToken(context, token, maxWidth);
    lines.push(...pieces.slice(0, -1));
    current = pieces.at(-1) ?? "";
  }

  if (current.trimEnd()) lines.push(current.trimEnd());
  return lines.length ? lines : [""];
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not render the PDF page."));
    }, "image/png");
  });
}

async function createPdfBlob(model: CanonicalNoteExport): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new Error("PDF download is available in the browser only.");
  }

  try {
    await document.fonts?.ready;
  } catch {
    // System font fallback remains available if the Font Loading API fails.
  }

  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const canvas = document.createElement("canvas");
  canvas.width = canvasPage.width;
  canvas.height = canvasPage.height;
  const candidateContext = canvas.getContext("2d", { alpha: false });
  if (!candidateContext) throw new Error("This browser cannot prepare a PDF canvas.");
  const context: CanvasRenderingContext2D = candidateContext;

  let y = canvasPage.paddingY;
  let pageHasContent = false;

  function beginPage() {
    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    context.textBaseline = "top";
    context.textAlign = "left";
    context.direction = "ltr";
    y = canvasPage.paddingY;
    pageHasContent = false;
  }

  async function commitPage() {
    if (!pageHasContent) return;
    const pngBlob = await canvasToPngBlob(canvas);
    const png = await pdf.embedPng(new Uint8Array(await pngBlob.arrayBuffer()));
    const page = pdf.addPage([pdfPage.width, pdfPage.height]);
    page.drawImage(png, { x: 0, y: 0, width: pdfPage.width, height: pdfPage.height });
  }

  async function ensureSpace(height: number) {
    if (y + height <= canvasPage.height - canvasPage.paddingY) return;
    await commitPage();
    beginPage();
  }

  beginPage();

  for (const block of canvasBlocks(model)) {
    const marginBefore = block.marginBefore ?? 0;
    if (!block.text && !block.rule) {
      await ensureSpace(block.lineHeight);
      y += block.lineHeight;
      continue;
    }

    await ensureSpace(marginBefore + block.lineHeight);
    y += marginBefore;

    if (block.rule) {
      context.save();
      context.strokeStyle = block.color;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(canvasPage.paddingX, y);
      context.lineTo(canvas.width - canvasPage.paddingX, y);
      context.stroke();
      context.restore();
      pageHasContent = true;
      y += block.lineHeight + (block.marginAfter ?? 0);
      continue;
    }

    context.font = `${block.weight} ${block.size}px ${canvasFontFamily}`;
    context.fillStyle = block.color;
    const baseX = canvasPage.paddingX + (block.indent ?? 0);
    const prefix = block.prefix ? `${block.prefix} ` : "";
    const prefixWidth = prefix ? context.measureText(prefix).width : 0;
    const textX = baseX + prefixWidth;
    const maxWidth = canvas.width - canvasPage.paddingX - textX;
    const lines = wrapCanvasText(context, block.text, maxWidth);

    for (let index = 0; index < lines.length; index += 1) {
      await ensureSpace(block.lineHeight);
      if (index === 0 && prefix) context.fillText(prefix.trimEnd(), baseX, y);
      context.fillText(lines[index], textX, y);
      pageHasContent = true;
      y += block.lineHeight;
    }
    y += block.marginAfter ?? 0;
  }

  await commitPage();
  const bytes = await pdf.save({ useObjectStreams: true });
  const pdfBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(pdfBuffer).set(bytes);
  return new Blob([pdfBuffer], { type: "application/pdf" });
}

export async function createNoteExportBlob(
  note: StudyNoteDraft,
  format: NoteExportFormat,
): Promise<{ blob: Blob; filename: string }> {
  const model = buildCanonicalNoteExport(note);
  let blob: Blob;

  if (format === "pdf") {
    blob = await createPdfBlob(model);
  } else if (format === "docx") {
    blob = await createDocxBlob(model);
  } else if (format === "markdown") {
    blob = new Blob([buildNoteMarkdown(model)], { type: formatMimeTypes.markdown });
  } else {
    // The BOM keeps Telugu, Hindi, and mixed-language TXT files readable in
    // older Windows editors while remaining valid UTF-8 everywhere else.
    blob = new Blob(["\uFEFF", buildNoteText(model)], { type: formatMimeTypes.txt });
  }

  return { blob, filename: sanitizeNoteFilename(model.title, format) };
}

function triggerBlobDownload(blob: Blob, filename: string) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Downloads are available in the browser only.");
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function exportStudyNote(
  note: StudyNoteDraft,
  format: NoteExportFormat,
): Promise<string> {
  const { blob, filename } = await createNoteExportBlob(note, format);
  triggerBlobDownload(blob, filename);
  return filename;
}
