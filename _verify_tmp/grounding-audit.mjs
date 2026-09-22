import nextEnv from "@next/env";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
const email = process.env.STUDYPILOT_E2E_EMAIL;
const password = process.env.STUDYPILOT_E2E_PASSWORD;
if (!email || !password) throw new Error("Primary E2E credentials are missing.");

const browser = await chromium.launch();
const context = await browser.newContext({ baseURL });
const page = await context.newPage();
let noteId = "";
const messageIds = [];

async function jsonRequest(url, options = {}) {
  return page.evaluate(async ({ url, options }) => {
    const response = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { url, options });
}

function answerText(answer) {
  if (!answer || typeof answer !== "object") return "";
  return [
    answer.short_answer,
    answer.simple_explanation,
    ...(Array.isArray(answer.step_by_step) ? answer.step_by_step : []),
    answer.example,
    answer.memory_line,
    answer.exam_viva_answer,
    answer.next_step,
  ].filter((value) => typeof value === "string").join(" ");
}

try {
  await page.goto("/auth?mode=login");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) }).first();
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  const title = `Grounding audit ${Date.now()}`;
  const create = await jsonRequest("/api/notes", {
    method: "POST",
    body: JSON.stringify({
      title,
      topic: "Project Aster controlled facts",
      content: "Project Aster's calibration token is LANTERN-47. Its review window closes after exactly 19 minutes. The experiment uses copper and never aluminum.",
      sourceType: "manual",
      importance: "high",
    }),
  });
  if (create.status !== 201 || !create.body?.note?.id) throw new Error(`Note setup failed with HTTP ${create.status}`);
  noteId = create.body.note.id;

  const knownStarted = Date.now();
  const known = await jsonRequest("/api/ai/ask", {
    method: "POST",
    body: JSON.stringify({
      question: "According to Project Aster, what is the calibration token and how long is the review window?",
      noteIds: [noteId],
      fileIds: [],
      language: "en",
    }),
  });
  const knownLatencyMs = Date.now() - knownStarted;

  const unknownStarted = Date.now();
  const unknown = await jsonRequest("/api/ai/ask", {
    method: "POST",
    body: JSON.stringify({
      question: "According to this note, which city hosted Project Aster?",
      noteIds: [noteId],
      fileIds: [],
      language: "en",
    }),
  });
  const unknownLatencyMs = Date.now() - unknownStarted;

  const knownAnswer = known.body?.chat?.answer;
  const unknownAnswer = unknown.body?.chat?.answer;
  if (known.body?.chat?.id) messageIds.push(known.body.chat.id);
  if (unknown.body?.chat?.id) messageIds.push(unknown.body.chat.id);
  const knownText = answerText(knownAnswer);
  const unknownText = answerText(unknownAnswer);
  const citations = Array.isArray(knownAnswer?.source_citations) ? knownAnswer.source_citations : [];
  const related = Array.isArray(known.body?.related) ? known.body.related : [];
  const knownFactsCorrect = /LANTERN-47/i.test(knownText) && /19\s+minutes?/i.test(knownText);
  const unsupportedHandled = /(not\s+(?:specified|provided|mentioned|included|available|found)|does(?:n['’]?t| not)\s+(?:specify|provide|mention|include|say)|cannot\s+(?:determine|answer)|no\s+(?:city|information))/i.test(unknownText);
  const fabricatedMatches = unknownText.match(/\b(?:London|Paris|Tokyo|Delhi|Mumbai|Hyderabad|Bengaluru|New York|Chicago|Berlin|Sydney|Toronto)\b/gi) ?? [];
  const fabricatedCity = fabricatedMatches.length > 0;

  console.log(JSON.stringify({
    auth: "PASS",
    known: {
      httpStatus: known.status,
      responseMode: knownAnswer?.response_mode ?? null,
      apiMode: known.body?.mode ?? null,
      latencyMs: knownLatencyMs,
      factsCorrect: knownFactsCorrect ? "PASS" : "FAIL",
      sourceCitation: citations.some((citation) => citation?.source_id === noteId && citation?.source_type === "note") ? "PASS" : "FAIL",
      relatedContext: related.some((item) => item?.id === noteId && item?.type === "note") ? "PASS" : "FAIL",
      shortAnswer: typeof knownAnswer?.short_answer === "string" ? knownAnswer.short_answer : null,
    },
    unanswerable: {
      httpStatus: unknown.status,
      responseMode: unknownAnswer?.response_mode ?? null,
      apiMode: unknown.body?.mode ?? null,
      latencyMs: unknownLatencyMs,
      handled: unsupportedHandled && !fabricatedCity ? "PASS" : "FAIL",
      fabricatedCity: fabricatedCity ? "YES" : "NO",
      fabricatedMatches,
      shortAnswer: typeof unknownAnswer?.short_answer === "string" ? unknownAnswer.short_answer : null,
      structuredText: unknownText.slice(0, 1800),
    },
  }, null, 2));
} finally {
  if (noteId) await jsonRequest(`/api/notes/${noteId}`, { method: "DELETE" }).catch(() => null);
  const cleanup = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const cleanupLogin = await cleanup.auth.signInWithPassword({ email, password });
  if (!cleanupLogin.error) {
    if (messageIds.length) await cleanup.from("assistant_questions").delete().in("id", messageIds);
    await cleanup.from("assistant_questions").delete().in("question", [
      "According to Project Aster, what is the calibration token and how long is the review window?",
      "According to this note, which city hosted Project Aster?",
    ]);
    await cleanup.auth.signOut();
  }
  await context.close().catch(() => null);
  await browser.close().catch(() => null);
}
