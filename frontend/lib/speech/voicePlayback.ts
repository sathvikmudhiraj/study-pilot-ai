const DEFAULT_MAX_CHARS = 260;

const NON_TERMINAL_ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i;

function splitLongSegment(segment: string, maxChars: number) {
  const chunks: string[] = [];
  let remaining = segment.trim();
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars + 1);
    const breakAt = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" "));
    const index = breakAt > Math.floor(maxChars * 0.55) ? breakAt + 1 : maxChars;
    chunks.push(remaining.slice(0, index).trim());
    remaining = remaining.slice(index).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function splitSpeechText(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  let start = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    if (!/[.!?]/.test(char)) continue;
    if (char === "." && /\d/.test(normalized[index - 1] ?? "") && /\d/.test(normalized[index + 1] ?? "")) continue;
    const candidate = normalized.slice(start, index + 1).trim();
    if (char === "." && NON_TERMINAL_ABBREVIATIONS.test(candidate)) continue;
    if (index + 1 < normalized.length && !/\s/.test(normalized[index + 1])) continue;
    if (candidate) sentences.push(candidate);
    start = index + 1;
  }
  const tail = normalized.slice(start).trim();
  if (tail) sentences.push(tail);

  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) chunks.push(current);
      chunks.push(...splitLongSegment(sentence, maxChars));
      current = "";
      continue;
    }
    const combined = current ? `${current} ${sentence}` : sentence;
    if (combined.length > maxChars) {
      if (current) chunks.push(current);
      current = sentence;
    } else {
      current = combined;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function cleanStreamSentence(value: string) {
  return value
    .replace(/https?:\/\/\S+/giu, "")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]+\)/gu, "$1")
    .replace(/[`*_#>]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function lastSafeBoundary(text: string) {
  for (let index = text.length - 1; index >= 0; index -= 1) {
    if (!/[.!?]/u.test(text[index])) continue;
    if (text[index] === "." && /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "")) continue;
    if (index + 1 < text.length && !/\s/u.test(text[index + 1])) continue;
    const candidate = text.slice(0, index + 1);
    if (text[index] === "." && NON_TERMINAL_ABBREVIATIONS.test(candidate.trim())) continue;
    if ((candidate.match(/\[/g)?.length ?? 0) !== (candidate.match(/\]/g)?.length ?? 0)) continue;
    return index + 1;
  }
  return -1;
}

export class SentenceStreamBuffer {
  private pending = "";

  push(delta: string): string[] {
    this.pending += delta;
    const boundary = lastSafeBoundary(this.pending);
    if (boundary < 0) return [];
    const complete = this.pending.slice(0, boundary);
    this.pending = this.pending.slice(boundary);
    if (/^\s*[\[{]/u.test(complete)) return [];
    return splitSpeechText(cleanStreamSentence(complete)).filter(Boolean);
  }

  reset() {
    this.pending = "";
  }

  flush(): string[] {
    const remaining = this.pending;
    this.pending = "";
    if (!remaining.trim() || /^\s*[\[{]/u.test(remaining)) return [];
    if ((remaining.match(/\[/g)?.length ?? 0) !== (remaining.match(/\]/g)?.length ?? 0)) return [];
    return splitSpeechText(cleanStreamSentence(remaining)).filter(Boolean);
  }
}
