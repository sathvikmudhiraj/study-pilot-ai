export type WebCitation = {
  id: string;
  source_type: "web";
  source_name: string;
  url: string;
  domain: string;
  published_at?: string;
  locator_type: "result";
  locator_start: number;
  snippet?: string;
};

export type WebSearchAnswer = {
  query: string;
  concise_answer: string;
  searched_at: string;
  web_citations: WebCitation[];
};

export type DeepResearchAnalysisSection = {
  heading: string;
  content: string;
};

export type DeepResearchReport = {
  research_question: string;
  sub_queries: string[];
  executive_summary: string;
  key_findings: string[];
  detailed_analysis: DeepResearchAnalysisSection[];
  different_viewpoints: DeepResearchAnalysisSection[];
  practical_conclusion: string;
  research_limitations: string[];
  sources: WebCitation[];
  researched_at: string;
};

type RunWebSearchOptions = {
  signal?: AbortSignal;
};

type RunDeepResearchOptions = {
  signal?: AbortSignal;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function limitedText(value: unknown, maxLength: number) {
  return textValue(value).slice(0, maxLength).trim();
}

function parseIpv4(hostname: string) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function isPrivateHost(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata" ||
    host === "instance-data"
  ) {
    return true;
  }

  const ipv4 = parseIpv4(host);
  if (ipv4) {
    const [a, b] = ipv4;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (!host.includes(":")) return false;
  if (host === "::" || host === "::1" || host.startsWith("::ffff:")) return true;
  const firstHextet = Number.parseInt(host.split(":", 1)[0] || "0", 16);
  return (
    !Number.isFinite(firstHextet) ||
    (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) ||
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf)
  );
}

function safeWebUrl(value: unknown) {
  const raw = textValue(value);
  if (!raw) return "";

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password || isPrivateHost(url.hostname)) return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeCitation(value: unknown): WebCitation | null {
  const record = recordValue(value);
  if (!record) return null;

  const id = limitedText(record.id, 120);
  const sourceName = limitedText(record.source_name, 300);
  const url = safeWebUrl(record.url);
  const domain = limitedText(record.domain, 255);
  const locatorStart = Number(record.locator_start);

  if (
    !id ||
    record.source_type !== "web" ||
    !sourceName ||
    !url ||
    !domain ||
    record.locator_type !== "result" ||
    !Number.isInteger(locatorStart) ||
    locatorStart < 1
  ) {
    return null;
  }

  const publishedAt = limitedText(record.published_at, 80);
  const snippet = limitedText(record.snippet, 1_200);
  return {
    id,
    source_type: "web",
    source_name: sourceName,
    url,
    domain,
    ...(publishedAt ? { published_at: publishedAt } : {}),
    locator_type: "result",
    locator_start: locatorStart,
    ...(snippet ? { snippet } : {}),
  };
}

function normalizeTextList(value: unknown, maxItems: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => limitedText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeAnalysisSections(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  const sections: DeepResearchAnalysisSection[] = [];
  for (const item of value) {
    const record = recordValue(item);
    if (!record) continue;
    const heading = limitedText(record.heading, 180);
    const content = limitedText(record.content, 6_000);
    if (!heading || !content) continue;
    sections.push({ heading, content });
    if (sections.length >= maxItems) break;
  }
  return sections;
}

function normalizeCitations(value: unknown, maxItems: number) {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const citations: WebCitation[] = [];
  for (const item of value) {
    const citation = normalizeCitation(item);
    if (!citation || seen.has(citation.url)) continue;
    seen.add(citation.url);
    citations.push(citation);
    if (citations.length >= maxItems) break;
  }
  return citations;
}

function normalizeWebSearchAnswer(value: unknown): WebSearchAnswer | null {
  const root = recordValue(value);
  if (!root) return null;
  const record = recordValue(root.answer) ?? recordValue(root.result) ?? root;

  const query = textValue(record.query);
  const conciseAnswer = textValue(record.concise_answer);
  const searchedAt = textValue(record.searched_at);
  if (!query || !conciseAnswer || !searchedAt || !Array.isArray(record.web_citations)) return null;

  const webCitations = normalizeCitations(record.web_citations, 12);
  if (!webCitations.length) return null;

  return {
    query,
    concise_answer: conciseAnswer,
    searched_at: searchedAt,
    web_citations: webCitations,
  };
}

function normalizeDeepResearchReport(value: unknown): DeepResearchReport | null {
  const root = recordValue(value);
  if (!root) return null;
  const record = recordValue(root.report) ?? root;

  const researchQuestion = limitedText(record.research_question, 500);
  const subQueries = normalizeTextList(record.sub_queries, 5, 300);
  const executiveSummary = limitedText(record.executive_summary, 5_000);
  const keyFindings = normalizeTextList(record.key_findings, 12, 3_000);
  const detailedAnalysis = normalizeAnalysisSections(record.detailed_analysis, 10);
  const differentViewpoints = normalizeAnalysisSections(record.different_viewpoints, 8);
  const practicalConclusion = limitedText(record.practical_conclusion, 5_000);
  const researchLimitations = normalizeTextList(record.research_limitations, 10, 2_000);
  const sources = normalizeCitations(record.sources, 12);
  const researchedAt = limitedText(record.researched_at, 80);

  if (
    !researchQuestion ||
    subQueries.length < 3 ||
    !executiveSummary ||
    !keyFindings.length ||
    !detailedAnalysis.length ||
    !practicalConclusion ||
    !researchLimitations.length ||
    !sources.length ||
    !researchedAt
  ) {
    return null;
  }

  return {
    research_question: researchQuestion,
    sub_queries: subQueries,
    executive_summary: executiveSummary,
    key_findings: keyFindings,
    detailed_analysis: detailedAnalysis,
    different_viewpoints: differentViewpoints,
    practical_conclusion: practicalConclusion,
    research_limitations: researchLimitations,
    sources,
    researched_at: researchedAt,
  };
}

function cleanServerError(value: unknown, status: number) {
  const record = recordValue(value);
  const serverMessage = textValue(record?.error) || textValue(record?.message);
  if (serverMessage) return serverMessage.slice(0, 300);
  if (status === 401) return "Please log in first.";
  if (status === 429) return "Web search limit reached. Please try again later.";
  if (status === 503) return "Web search is not configured or is temporarily unavailable.";
  return "Web search failed. Please try again.";
}

export async function runWebSearch(query: string, options: RunWebSearchOptions = {}): Promise<WebSearchAnswer> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("Enter a web search query first.");

  let response: Response;
  try {
    response = await fetch("/api/ai/web-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query: normalizedQuery }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("Network error. Check your connection and try again.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep malformed or non-JSON server responses away from the UI.
  }

  if (!response.ok) throw new Error(cleanServerError(payload, response.status));

  const answer = normalizeWebSearchAnswer(payload);
  if (!answer) throw new Error("Web search returned an unreadable response. Please try again.");
  return answer;
}

export async function runDeepResearch(
  query: string,
  options: RunDeepResearchOptions = {},
): Promise<DeepResearchReport> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) throw new Error("Enter a research question first.");

  let response: Response;
  try {
    response = await fetch("/api/ai/deep-research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ query: normalizedQuery }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error("Network error. Check your connection and try again.");
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Keep malformed or non-JSON server responses away from the UI.
  }

  if (!response.ok) {
    const message = cleanServerError(payload, response.status);
    if (response.status === 429 && !recordValue(payload)?.error) {
      throw new Error("Deep research limit reached. Please try again later.");
    }
    throw new Error(message);
  }

  const report = normalizeDeepResearchReport(payload);
  if (!report) throw new Error("Deep research returned an unreadable report. Please try again.");
  return report;
}

export function deepResearchToText(report: DeepResearchReport) {
  const detailed = report.detailed_analysis
    .map((section) => `${section.heading}\n${section.content}`)
    .join("\n\n");
  const viewpoints = report.different_viewpoints.length
    ? `\n\nDifferent viewpoints\n${report.different_viewpoints
        .map((section) => `${section.heading}\n${section.content}`)
        .join("\n\n")}`
    : "";
  const sources = report.sources
    .map((source, index) => `[${index + 1}] ${source.source_name} (${source.domain})`)
    .join("\n");

  return [
    `Research question\n${report.research_question}`,
    `Executive summary\n${report.executive_summary}`,
    `Key findings\n${report.key_findings.map((finding) => `- ${finding}`).join("\n")}`,
    `Detailed analysis\n${detailed}${viewpoints}`,
    `Practical conclusion\n${report.practical_conclusion}`,
    `Research limitations\n${report.research_limitations.map((item) => `- ${item}`).join("\n")}`,
    `Sources\n${sources}`,
  ].join("\n\n");
}
