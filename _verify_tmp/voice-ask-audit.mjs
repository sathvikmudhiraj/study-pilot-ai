/**
 * READ-ONLY audit driver for the Voice Tutor "Thinking..." latency issue.
 * Reproduces the exact real request path with the E2E student account:
 * mocked SpeechRecognition (same pattern as e2e/voice-mocked.spec.ts),
 * real network, real /api/ai/ask, real providers. Writes zero code changes.
 *
 * Usage: node _verify_tmp/voice-ask-audit.mjs <scenario> [question]
 * Scenarios: general | file-extracted | file-missing-text | deleted-file
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const root = process.cwd();
for (const raw of fs.readFileSync(`${root}/.env.local`, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  if (!(key in process.env)) process.env[key] = line.slice(eq + 1).trim();
}

const BASE = process.env.AUDIT_BASE_URL ?? "http://127.0.0.1:3210";
const SCENARIO = process.argv[2] ?? "general";
const QUESTION = process.argv[3] ?? "what is string";
const EMAIL = process.env.STUDYPILOT_E2E_EMAIL;
const PASSWORD = process.env.STUDYPILOT_E2E_PASSWORD;

const out = { scenario: SCENARIO, question: QUESTION, marks: {}, stages: [], notes: [], serverTimings: null, answerMeta: null, postBody: null };
const t0 = Date.now();
const mark = (name) => { out.marks[name] = Date.now() - t0; };
const note = (msg) => { out.notes.push({ t: Date.now() - t0, msg }); };

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function findUserIdByEmail(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = (data?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (!data?.users?.length || data.users.length < 200) throw new Error("user not found");
    page += 1;
  }
}

async function pickFiles(userId) {
  // NOTE: extracted_text content is never printed — only its presence/length.
  const { data, error } = await admin
    .from("files")
    .select("id, file_name, mime_type, processing_status, status, chunks_count, extracted_text, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []).map((f) => ({
    id: f.id,
    file_name: f.file_name,
    mime_type: f.mime_type,
    processing_status: f.processing_status ?? f.status ?? null,
    chunks_count: f.chunks_count ?? null,
    extracted_text_length: typeof f.extracted_text === "string" ? f.extracted_text.length : 0,
    has_extracted_text: Boolean(f.extracted_text && String(f.extracted_text).trim()),
    mentions_string_topic: typeof f.extracted_text === "string" ? /string/i.test(f.extracted_text) : false,
  }));
}

async function main() {
  if (!EMAIL || !PASSWORD) throw new Error("E2E creds missing");
  const userId = await findUserIdByEmail(EMAIL);
  const files = await pickFiles(userId);
  out.userFiles = files;
  note(`user has ${files.length} file(s); withText=${files.filter((f) => f.has_extracted_text).length}, withoutText=${files.filter((f) => !f.has_extracted_text).length}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on("console", (m) => {
    const text = m.text();
    if (text.startsWith("[telemetry]")) note(`console ${text}`);
  });

  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = ""; continuous = false; interimResults = false; maxAlternatives = 1;
      onresult = null; onerror = null; onend = null; onstart = null;
      onaudiostart = null; onaudioend = null; onsoundstart = null; onsoundend = null;
      onspeechstart = null; onspeechend = null;
      started = false;
      start() { this.started = true; window.__mockRecognition = this; setTimeout(() => { this.onstart?.(); this.onspeechstart?.(); }, 25); }
      stop() { if (!this.started) return; this.started = false; setTimeout(() => { this.onspeechend?.(); this.onend?.(); }, 25); }
      abort() { this.stop(); }
      __emitFinal(transcript) {
        const result = { 0: { transcript, confidence: 0.98 }, isFinal: true, length: 1 };
        this.onresult?.({ resultIndex: 0, results: [result] });
      }
    }
    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
    window.__ttsCalls = [];
    const record = (utterance) => { window.__ttsCalls.push({ t: Date.now(), text: utterance.text.slice(0, 60) }); setTimeout(() => utterance.onend?.({}), 25); };
    if (window.speechSynthesis && typeof window.speechSynthesis.speak === "function") {
      window.speechSynthesis.speak = record;
    } else {
      window.speechSynthesis = { speak: record, cancel() {}, getVoices: () => [] };
    }
  });

  // ---- login -------------------------------------------------------------
  await page.goto(`${BASE}/auth?mode=login`);
  const loginForm = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) });
  await loginForm.getByLabel("Email").waitFor({ state: "visible", timeout: 20000 });
  mark("login_form_ready");
  await loginForm.getByLabel("Email").fill(EMAIL);
  await loginForm.getByLabel("Password").fill(PASSWORD);
  await loginForm.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30000 });
  mark("logged_in");

  // ---- scenario-specific conversation setup ------------------------------
  let conversationId = null;
  if (SCENARIO !== "general") {
    let activeFileIds = [];
    if (SCENARIO === "deleted-file") {
      activeFileIds = ["00000000-0000-4000-8000-000000000000"];
    } else if (SCENARIO === "file-extracted") {
      const file = files.find((f) => f.has_extracted_text);
      if (!file) throw new Error("no file with extracted_text available");
      activeFileIds = [file.id];
      note(`selected file: ${file.file_name} (text ${file.extracted_text_length} chars, mentions 'string': ${file.mentions_string_topic})`);
    } else if (SCENARIO === "file-missing-text") {
      const file = files.find((f) => !f.has_extracted_text);
      if (!file) throw new Error("no file WITHOUT extracted_text available");
      activeFileIds = [file.id];
      note(`selected file without extracted_text: ${file.file_name} status=${file.processing_status}`);
    }
    const res = await page.request.post(`${BASE}/api/conversations`, {
      data: {
        title: `audit-${SCENARIO}-${Date.now()}`,
        context_mode: "file",
        active_file_ids: activeFileIds,
        active_note_ids: [],
        language_code: "en",
      },
    });
    const created = await res.json();
    conversationId = created.conversation?.id;
    note(`conversation created mode=file files=${JSON.stringify(activeFileIds)} id=${conversationId} status=${res.status()}`);
  }

  // ---- open Voice Tutor --------------------------------------------------
  await page.goto(`${BASE}/voice${conversationId ? `?conversationId=${conversationId}` : ""}`);
  await page.getByRole("button", { name: /start listening/i }).waitFor({ state: "visible", timeout: 20000 });
  mark("voice_page_ready");

  // Watch the ask request/response.
  let askPayload = null;
  page.on("request", (req) => {
    if (req.url().includes("/api/conversations") && req.method() === "POST") mark("conversation_post_start");
    if (req.url().includes("/api/ai/ask") && req.method() === "POST") {
      mark("ask_request_sent");
      try { askPayload = JSON.parse(req.postData() ?? "{}"); } catch { /* ignore */ }
    }
  });
  page.on("response", (res) => {
    if (res.url().includes("/api/conversations") && res.request().method() === "POST") mark("conversation_post_done");
    if (res.url().includes("/api/ai/ask") && res.request().method() === "POST") mark("ask_response_headers");
  });

  // Poll UI state.
  let polling = true;
  const poller = (async () => {
    let wasThinking = false;
    while (polling) {
      try {
        const thinking = await page.getByText("Thinking with your study context", { exact: false }).first().isVisible().catch(() => false);
        if (thinking && !wasThinking) mark("thinking_shown");
        if (!thinking && wasThinking) mark("thinking_hidden");
        wasThinking = thinking;
        const tts = await page.evaluate(() => window.__ttsCalls.length);
        if (tts > 0 && out.marks.tts_start === undefined) mark("tts_start");
        const notice = await page.locator("p", { hasText: "Request timed out" }).first().textContent().catch(() => "");
        if (notice && !out.marks.timeout_notice) { mark("timeout_notice"); note(`notice: ${notice}`); }
      } catch { /* page navigating */ }
      await new Promise((r) => setTimeout(r, 120));
    }
  })();

  // ---- speak -------------------------------------------------------------
  await page.getByRole("button", { name: /start listening/i }).click();
  await page.getByRole("button", { name: /stop listening/i }).waitFor({ state: "visible", timeout: 10000 });
  mark("listening_started");
  await page.evaluate((spoken) => {
    const r = window.__mockRecognition;
    r.__emitFinal(spoken);
    r.stop();
  }, QUESTION);
  mark("transcript_dispatched");

  // ---- wait for the ask response -----------------------------------------
  const MAX_WAIT_MS = Number(process.env.AUDIT_MAX_WAIT_MS ?? 420_000);
  try {
    const response = await page.waitForResponse(
      (r) => r.url().includes("/api/ai/ask") && r.request().method() === "POST",
      { timeout: MAX_WAIT_MS },
    );
    mark("ask_response_received");
    out.httpStatus = response.status();
    const json = await response.json();
    out.serverTimings = json?.debug?.timings ?? null;
    const answer = json?.chat?.answer ?? {};
    out.answerMeta = {
      mode: json?.mode ?? null,
      response_mode: answer?.response_mode ?? null,
      found_in_notes: answer?.found_in_notes ?? null,
      fallback_notice_present: Boolean(answer?.fallback_notice),
      short_answer_prefix: typeof answer?.short_answer === "string" ? answer.short_answer.slice(0, 90) : null,
      source_citations_count: Array.isArray(answer?.source_citations) ? answer.source_citations.length : 0,
      citation_source_names: Array.isArray(answer?.source_citations) ? [...new Set(answer.source_citations.map((c) => c?.source_name))] : [],
      related: Array.isArray(json?.related) ? json.related.map((r) => ({ type: r?.type, label: String(r?.label ?? "").slice(0, 60) })) : [],
      deferredPersistence: json?.deferredPersistence ?? false,
      debugKeys: json?.debug ? Object.fromEntries(Object.entries(json.debug).filter(([k]) => k !== "timings")) : null,
    };
  } catch (error) {
    out.waitError = `no /api/ai/ask response within ${MAX_WAIT_MS}ms: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
    note(out.waitError);
  }

  // Give UI a moment to render + TTS to fire.
  await page.waitForTimeout(2500);
  mark("observation_end");
  out.postBody = askPayload;
  polling = false;
  await poller;

  // Final UI state
  out.finalUi = {
    thinkingVisible: await page.getByText("Thinking with your study context", { exact: false }).first().isVisible().catch(() => false),
    timeoutNoticeVisible: await page.getByText("Request timed out", { exact: false }).first().isVisible().catch(() => false),
    ttsCallCount: await page.evaluate(() => window.__ttsCalls.length).catch(() => -1),
  };

  await browser.close();
  fs.writeFileSync(`${root}/_verify_tmp/audit-${SCENARIO}.json`, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((error) => {
  out.fatal = error instanceof Error ? error.message : String(error);
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
});
