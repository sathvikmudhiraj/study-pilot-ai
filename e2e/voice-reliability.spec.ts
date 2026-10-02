import { expect, test, type Page } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

test.setTimeout(90_000);

async function installVoiceHarness(page: Page) {
  await page.addInitScript(() => {
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = false;
      maxAlternatives = 1;
      onstart: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const target = window as unknown as Record<string, unknown>;
        target.__recognitionStarts = Number(target.__recognitionStarts) + 1;
        (window as unknown as { __voiceRecognition: Recognition }).__voiceRecognition = this;
        setTimeout(() => this.onstart?.(), 10);
      }
      stop() {
        const end = this.onend;
        setTimeout(() => { end?.(); end?.(); }, 10);
      }
      abort() { this.stop(); }
      emit(text: string, isFinal: boolean) {
        this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text, confidence: 0.99 }, isFinal, length: 1 }] });
      }
    }
    const target = window as unknown as Record<string, unknown>;
    class Utterance {
      text: string;
      lang = "";
      voice: SpeechSynthesisVoice | null = null;
      onend: ((event: SpeechSynthesisEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(text: string) { this.text = text; }
    }
    target.SpeechSynthesisUtterance = Utterance;
    target.SpeechRecognition = Recognition;
    target.webkitSpeechRecognition = Recognition;
    target.__spokenChunks = [] as string[];
    target.__spokenVoiceNames = [] as string[];
    target.__speechCancels = 0;
    target.__recognitionStarts = 0;
    target.__holdSpeech = false;
    target.__voices = [] as SpeechSynthesisVoice[];
    const synthesis = window.speechSynthesis;
    synthesis.getVoices = () => target.__voices as SpeechSynthesisVoice[];
    synthesis.speak = (utterance) => {
      (target.__spokenChunks as string[]).push(utterance.text);
      (target.__spokenVoiceNames as string[]).push(utterance.voice?.name ?? "");
      if (!target.__holdSpeech) setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 5);
    };
    synthesis.cancel = () => { target.__speechCancels = Number(target.__speechCancels) + 1; };
  });
}

async function emit(page: Page, text: string, isFinal: boolean) {
  await page.evaluate(({ text, isFinal }) => {
    (window as unknown as { __voiceRecognition: { emit: (value: string, final: boolean) => void } })
      .__voiceRecognition.emit(text, isFinal);
  }, { text, isFinal });
}

function fulfillAsk(route: import("@playwright/test").Route) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      mode: "selected-context",
      chat: { id: null, answer: { short_answer: "Grounded answer from the selected file.", simple_explanation: "The selected material supports this answer.", response_mode: "ai", source_citations: [] } },
    }),
  });
}

test.beforeEach(async ({ page }) => {
  requireE2EEnv();
  await installVoiceHarness(page);
  await login(page);
});

test("fresh Voice context, visible Stop, interim fallback, silence stop, and dedupe", async ({ page }) => {
  test.setTimeout(90_000);
  const payloads: Array<Record<string, unknown>> = [];
  await page.route("**/api/ai/ask", async (route) => {
    payloads.push(route.request().postDataJSON());
    await fulfillAsk(route);
  });
  await page.goto("/voice");
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  const selector = page.getByRole("combobox", { name: /active study file/i });
  await expect(selector).toHaveValue("");
  await expect(page.getByText("General AI knowledge")).toBeVisible();

  const moduleOption = selector.locator("option", { hasText: "Module-3.docx" });
  const moduleId = await moduleOption.getAttribute("value");
  expect(moduleId).toBeTruthy();
  await selector.selectOption(moduleId!);
  await expect(page.getByText("Using Module-3.docx", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "Explain set operators", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0].fileIds).toEqual([moduleId]);
  await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();

  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "Interim only question", false);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({ question: "Interim only question", fileIds: [moduleId] });

  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "Automatic silence question", true);
  await expect.poll(() => payloads.length, { timeout: 6_000 }).toBe(3);

  await page.getByRole("button", { name: /start listening/i }).click();
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect(page.getByText(/did not catch that/i)).toBeVisible();
  expect(payloads).toHaveLength(3);
});

test("changing the Voice file updates Ask, Diagram, Notes, Quiz, and Revision", async ({ page }) => {
  test.setTimeout(90_000);
  const askPayloads: Array<Record<string, unknown>> = [];
  const diagramPayloads: Array<Record<string, unknown>> = [];
  const notesPayloads: Array<Record<string, unknown>> = [];
  await page.route("**/api/ai/ask", async (route) => { askPayloads.push(route.request().postDataJSON()); await fulfillAsk(route); });
  await page.route("**/api/ai/diagram", async (route) => {
    diagramPayloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ diagram: { title: "Module diagram", diagram_type: "flowchart", source_type: "file", mermaid: "flowchart TD\nA-->B", explanation: "Selected file diagram.", generated_at: new Date().toISOString() } }) });
  });
  await page.route("**/api/notes/generate", async (route) => {
    notesPayloads.push(route.request().postDataJSON());
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Captured by reliability test." }) });
  });
  await page.goto("/voice");
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  const selector = page.getByRole("combobox", { name: /active study file/i });
  const values = await selector.locator("option:not([value=''])").evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  expect(values.length).toBeGreaterThan(1);
  const selectedId = await selector.locator("option", { hasText: "Module-3.docx" }).getAttribute("value");
  if (!selectedId) throw new Error("Module-3.docx is required for the Voice file-context test.");
  const initialId = values.find((value) => value !== selectedId);
  expect(initialId).toBeTruthy();
  await selector.selectOption(initialId!);
  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "Explain this file", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => askPayloads.length).toBe(1);
  expect(askPayloads[0].fileIds).toEqual([initialId]);

  await selector.selectOption(selectedId);

  for (const [command, completed, expectedCount] of [
    ["Explain this file simply", () => askPayloads.length, 2],
    ["generate a diagram from this file", () => diagramPayloads.length, 1],
    ["make exam notes", () => notesPayloads.length, 1],
  ] as const) {
    await page.getByRole("button", { name: /start listening/i }).click();
    await emit(page, command, true);
    await page.getByRole("button", { name: /stop listening/i }).click();
    await expect.poll(completed, { timeout: 30_000 }).toBe(expectedCount);
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled({ timeout: 30_000 });
  }
  expect(askPayloads[1].fileIds).toEqual([selectedId]);
  expect(diagramPayloads[0].fileId).toBe(selectedId);
  expect(notesPayloads[0].fileId).toBe(selectedId);

  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "generate quiz", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect(page).toHaveURL(new RegExp(`/quiz\\?fileId=${selectedId}`));
  await page.goto(`/voice?fileId=${selectedId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  const revisionSelector = page.getByRole("combobox", { name: /active study file/i });
  await expect(revisionSelector).toHaveValue(selectedId);
  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "create revision plan", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect(page).toHaveURL(new RegExp(`/revision\\?fileId=${selectedId}`));
});

test("long TTS is ordered, cancellable, and refreshes asynchronously loaded voices", async ({ page }) => {
  test.setTimeout(60_000);
  const longText = Array.from({ length: 14 }, (_, index) => `Sentence ${index + 1} explains an important database concept clearly.`).join(" ");
  await page.route("**/api/ai/ask", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ mode: "ai", chat: { id: null, answer: { short_answer: longText, response_mode: "ai" } } }),
  }));
  await page.goto("/voice");
  await page.evaluate(() => {
    const target = window as unknown as Record<string, unknown>;
    target.__voices = [{ name: "Test English", lang: "en-US", default: true, localService: true, voiceURI: "test" }] as unknown as SpeechSynthesisVoice[];
    window.speechSynthesis.dispatchEvent(new Event("voiceschanged"));
  });
  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "Explain databases", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spokenChunks: string[] }).__spokenChunks.length)).toBeGreaterThan(1);
  const chunks = await page.evaluate(() => (window as unknown as { __spokenChunks: string[] }).__spokenChunks);
  expect(chunks.join(" ")).toBe(longText);
  expect(await page.evaluate(() => (window as unknown as { __spokenVoiceNames: string[] }).__spokenVoiceNames.every((name) => name === "Test English"))).toBe(true);
  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__holdSpeech = true; });
  await page.getByRole("button", { name: /read aloud/i }).click();
  await page.getByRole("button", { name: /stop speaking/i }).click();
  const afterStop = await page.evaluate(() => ({ chunks: (window as unknown as { __spokenChunks: string[] }).__spokenChunks.length, cancels: Number((window as unknown as Record<string, unknown>).__speechCancels) }));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as unknown as { __spokenChunks: string[] }).__spokenChunks.length)).toBe(afterStop.chunks);
  expect(afterStop.cancels).toBeGreaterThan(0);
});

test("specialized Voice results survive conversation reload", async ({ page }) => {
  test.setTimeout(60_000);
  await page.route("**/api/ai/web-search", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ answer: {
      query: "cloud computing",
      concise_answer: "Cloud computing provides computing resources over a network.",
      searched_at: new Date().toISOString(),
      web_citations: [{ id: "web-1", source_type: "web", source_name: "Cloud reference", url: "https://example.com/cloud", domain: "example.com", locator_type: "result", locator_start: 1, snippet: "A concise cloud reference." }],
    } }),
  }));
  await page.goto("/voice");
  await page.getByRole("button", { name: /start listening/i }).click();
  await emit(page, "search the web for cloud computing", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect(page.getByRole("region", { name: /web sources/i })).toBeVisible();
  const returnLink = page.getByRole("link", { name: /return to ai chat/i });
  await expect(returnLink).toBeVisible();
  const conversationId = (await returnLink.getAttribute("href"))?.match(/conversationId=([^&]+)/)?.[1];
  expect(conversationId).toBeTruthy();
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByText("Cloud computing provides computing resources over a network.")).toBeVisible();
  await expect(page.getByRole("region", { name: /web sources/i })).toBeVisible();
  await page.goto(`/chat?conversationId=${conversationId}`);
  await expect(page.getByText("Cloud computing provides computing resources over a network.")).toBeVisible();
});

test("Jarvis mode auto-listens, preserves context, pauses, and supports barge-in", async ({ page }) => {
  test.setTimeout(90_000);
  const payloads: Array<Record<string, unknown>> = [];
  await page.route("**/api/ai/ask", async (route) => {
    payloads.push(route.request().postDataJSON());
    await fulfillAsk(route);
  });
  await page.goto("/voice");
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();

  const fileSelector = page.getByRole("combobox", { name: /active study file/i });
  const moduleId = await fileSelector.locator("option", { hasText: "Module-3.docx" }).getAttribute("value");
  expect(moduleId).toBeTruthy();
  await page.getByRole("combobox", { name: /speaking language/i }).selectOption("auto");

  await page.getByRole("switch", { name: /jarvis off/i }).click();
  await expect(page.getByRole("switch", { name: /jarvis on/i })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: /stop listening/i })).toBeEnabled();

  await emit(page, "Open Module 3", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect(fileSelector).toHaveValue(moduleId!);
  await expect(page.getByText("Using Module-3.docx", { exact: true })).toBeVisible();
  expect(payloads).toHaveLength(0);
  await expect(page.getByRole("button", { name: /stop listening/i })).toBeEnabled({ timeout: 10_000 });

  await emit(page, "Explain deadlocks", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => payloads.length).toBe(1);
  expect(payloads[0]).toMatchObject({ fileIds: [moduleId] });
  await expect(page.getByText("deadlocks", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: /stop listening/i })).toBeEnabled({ timeout: 10_000 });
  await emit(page, "Hindi mein samjhao", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => payloads.length).toBe(2);
  expect(payloads[1]).toMatchObject({ fileIds: [moduleId], language: "hi" });
  await expect(fileSelector).toHaveValue(moduleId!);

  await page.evaluate(() => { (window as unknown as Record<string, unknown>).__holdSpeech = true; });
  await expect(page.getByRole("button", { name: /stop listening/i })).toBeEnabled({ timeout: 10_000 });
  await emit(page, "Explain deadlocks again", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => payloads.length).toBe(3);
  await expect(page.getByRole("button", { name: /stop listening/i })).toBeEnabled({ timeout: 10_000 });
  const cancelsBefore = await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__speechCancels));
  await emit(page, "Wait explain simpler", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect.poll(() => payloads.length).toBe(4);
  expect(payloads[3]).toMatchObject({ question: "Wait explain simpler", fileIds: [moduleId] });
  await expect.poll(() => page.evaluate(() => Number((window as unknown as Record<string, unknown>).__speechCancels))).toBeGreaterThan(cancelsBefore);

  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  const startsAtPause = await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__recognitionStarts));
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__recognitionStarts))).toBe(startsAtPause);

  const returnLink = page.getByRole("link", { name: /return to ai chat/i });
  const conversationId = (await returnLink.getAttribute("href"))?.match(/conversationId=([^&]+)/)?.[1];
  expect(conversationId).toBeTruthy();
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("combobox", { name: /active study file/i })).toHaveValue(moduleId!);
  await expect(page.getByRole("combobox", { name: /speaking language/i })).toHaveValue("hi");
  await expect(page.getByText(/deadlocks/i).first()).toBeVisible();
});

test("streaming barge-in aborts the old response and the new answer wins", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/voice");
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  await page.evaluate(() => {
    const target = window as unknown as Record<string, unknown>;
    target.__streamAborts = 0;
    target.__holdSpeech = true;
    const nativeFetch = window.fetch.bind(window);
    let askCount = 0;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("/api/ai/ask")) return nativeFetch(input, init);
      askCount += 1;
      const current = askCount;
      const encoder = new TextEncoder();
      const timers: number[] = [];
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: Record<string, unknown>, delay: number) => {
            timers.push(window.setTimeout(() => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)), delay));
          };
          send({ type: "start", requestId: `browser-stream-${current}`, language: "en" }, 0);
          if (current === 1) {
            send({ type: "delta", text: "Old answer begins. ", provider: "gemini" }, 40);
            send({ type: "delta", text: "STALE CHUNK MUST NOT APPEAR.", provider: "gemini" }, 1_500);
            timers.push(window.setTimeout(() => controller.close(), 1_600));
          } else {
            send({ type: "delta", text: "New simple answer wins.", provider: "nvidia" }, 40);
            send({ type: "final", mode: "keyword-context", chat: { id: null, created_at: new Date().toISOString(), answer: { short_answer: "New simple answer wins.", simple_explanation: "New simple answer wins.", response_mode: "ai" } } }, 80);
            timers.push(window.setTimeout(() => controller.close(), 100));
          }
          init?.signal?.addEventListener("abort", () => {
            target.__streamAborts = Number(target.__streamAborts) + 1;
            timers.forEach(window.clearTimeout);
            try { controller.error(new DOMException("Aborted", "AbortError")); } catch { /* already closed */ }
          }, { once: true });
        },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { "content-type": "application/x-ndjson" } }));
    };
  });

  await page.getByRole("switch", { name: /jarvis off/i }).click();
  await expect(page.getByRole("button", { name: /stop listening/i })).toBeEnabled();
  await emit(page, "Explain set operators", true);
  await page.getByRole("button", { name: /stop listening/i }).click();
  await expect(page.getByText("Old answer begins.", { exact: false })).toBeVisible();

  await expect(page.getByRole("button", { name: /stop listening/i })).toBeEnabled({ timeout: 10_000 });
  await emit(page, "Wait explain simpler", true);
  await page.getByRole("button", { name: /stop listening/i }).click();

  await expect(page.getByText("New simple answer wins.", { exact: false })).toBeVisible();
  await page.waitForTimeout(1_700);
  await expect(page.getByText("STALE CHUNK MUST NOT APPEAR.", { exact: false })).toHaveCount(0);
  expect(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__streamAborts))).toBeGreaterThan(0);
  expect(await page.evaluate(() => Number((window as unknown as Record<string, unknown>).__speechCancels))).toBeGreaterThan(0);
});
