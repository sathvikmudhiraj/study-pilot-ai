import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

async function moduleConversation(page: import("@playwright/test").Page) {
  await page.goto("/files");
  const link = page.getByRole("link", { name: /Module-3\.docx/i }).first();
  await expect(link).toBeVisible();
  const fileId = (await link.getAttribute("href"))?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
  expect(fileId).toBeTruthy();
  const created = await page.request.post("/api/conversations", {
    data: { title: "Intent routing E2E", context_mode: "file", active_file_ids: [fileId], language_code: "en" },
  });
  expect(created.ok(), await created.text()).toBe(true);
  return (await created.json()).conversation.id as string;
}

test("Study Chat keeps normal questions in notes and routes explicit web commands", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(150_000);
  await login(page);
  const conversationId = await moduleConversation(page);
  const hydration = page.waitForResponse((response) => response.url().includes(`/api/conversations/${conversationId}/messages`) && response.request().method() === "GET");
  await page.goto(`/chat?conversationId=${conversationId}`);
  await hydration;
  const composer = page.getByRole("textbox", { name: /type your question/i });
  await expect(composer).toBeVisible();
  await expect(page.getByText("Using Module-3.docx")).toBeVisible();
  const requests: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/ai\/(ask|web-search)/.test(request.url())) requests.push(request.url()); });

  await composer.fill("Explain what is C language");
  const notesResponsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/ask") && response.request().method() === "POST", { timeout: 35_000 });
  await page.getByRole("button", { name: "Send message" }).click();
  const notesResponse = await notesResponsePromise;
  const notes = await notesResponse.json();
  console.log(`[Intent] notes response: mode=${notes.mode} short=${notes.chat?.answer?.short_answer} citations=${notes.chat?.answer?.source_citations?.length ?? 0} next=${notes.chat?.answer?.next_step}`);
  expect(notesResponse.ok(), JSON.stringify(notes).slice(0, 300)).toBe(true);
  expect(notes.chat.answer.short_answer).toMatch(/not found in .*study material/i);
  expect(notes.chat.answer.next_step).toMatch(/Web Search.*C language/i);
  expect(notes.chat.answer.source_citations ?? []).toHaveLength(0);
  await expect(page.getByRole("button", { name: /search outside my notes/i })).toBeVisible();
  const askCount = requests.filter((url) => url.includes("/api/ai/ask")).length;

  await composer.fill("web search C language");
  const webResponsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/web-search") && response.request().method() === "POST", { timeout: 65_000 });
  await page.getByRole("button", { name: "Send message" }).click();
  const webResponse = await webResponsePromise;
  const web = await webResponse.json();
  expect(webResponse.ok(), JSON.stringify(web).slice(0, 300)).toBe(true);
  expect(web.answer.query).toBe("C language");
  expect(requests.filter((url) => url.includes("/api/ai/ask"))).toHaveLength(askCount);
  await expect(page.getByRole("region", { name: /web sources/i }).getByRole("link").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible();

  await composer.fill("tell me more");
  const followUpPromise = page.waitForResponse((response) => response.url().includes("/api/ai/web-search") && response.request().method() === "POST", { timeout: 65_000 });
  await page.getByRole("button", { name: "Send message" }).click();
  const followUp = await followUpPromise;
  expect(followUp.ok()).toBe(true);
  expect((await followUp.json()).answer.query).toMatch(/C language.*more detail/i);
  expect(requests.filter((url) => url.includes("/api/ai/ask"))).toHaveLength(askCount);
  console.log("[Intent] Chat notes-not-found, explicit web search, and web follow-up passed");
});

test("Voice Tutor routes a spoken web command to web results in the same conversation", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(100_000);
  await login(page);
  const conversationId = await moduleConversation(page);
  await page.addInitScript(() => {
    class Recognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onspeechend: (() => void) | null = null;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() { (window as unknown as { __recognition: Recognition }).__recognition = this; this.onstart?.(); }
      stop() { this.onspeechend?.(); this.onend?.(); }
      abort() { this.stop(); }
      emit(text: string) { this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: true, length: 1 }] }); }
    }
    (window as unknown as { SpeechRecognition: typeof Recognition }).SpeechRecognition = Recognition;
  });
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  let askCalls = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/ai/ask")) askCalls += 1; });
  await page.getByRole("button", { name: /start listening/i }).click();
  const webResponsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/web-search") && response.request().method() === "POST", { timeout: 65_000 });
  await page.evaluate(() => {
    const recognition = (window as unknown as { __recognition: { emit: (text: string) => void; stop: () => void } }).__recognition;
    recognition.emit("search the web for C language");
    recognition.stop();
  });
  const webResponse = await webResponsePromise;
  const web = await webResponse.json();
  expect(webResponse.ok(), JSON.stringify(web).slice(0, 300)).toBe(true);
  expect(web.answer.query).toBe("C language");
  expect(askCalls).toBe(0);
  await expect(page.getByRole("region", { name: /web sources/i }).getByRole("link").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /return to ai chat/i })).toHaveAttribute("href", new RegExp(conversationId));
  console.log("[Intent] Voice transcript used shared web resolver; citations rendered in the same conversation");
});

test("natural Chat phrases use the correct live endpoint and render web sources", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(180_000);
  await login(page);
  const conversationId = await moduleConversation(page);
  const hydration = page.waitForResponse((response) => response.url().includes(`/api/conversations/${conversationId}/messages`) && response.request().method() === "GET");
  await page.goto(`/chat?conversationId=${conversationId}`);
  await hydration;
  const composer = page.getByRole("textbox", { name: /type your question/i });
  await expect(page.getByText("Using Module-3.docx")).toBeVisible();

  for (const [question, endpoint] of [
    ["okay what is C language", "/api/ai/ask"],
    ["search in a web about C language", "/api/ai/web-search"],
    ["okay do a website of what is C language", "/api/ai/web-search"],
    ["What is a website?", "/api/ai/ask"],
    ["build a website about C language", "/api/ai/ask"],
  ] as const) {
    await composer.fill(question);
    const startedAt = Date.now();
    const requestPromise = page.waitForRequest((request) => request.url().includes(endpoint) && request.method() === "POST", { timeout: 20_000 });
    await page.getByRole("button", { name: "Send message" }).click();
    const request = await requestPromise;
    const delayToRequestMs = Date.now() - startedAt;
    const response = await request.response();
    expect(response).not.toBeNull();
    expect(response!.ok(), `${question}: ${await response!.text()}`).toBe(true);
    const body = await response!.json();
    if (endpoint.endsWith("web-search")) {
      expect(body.answer.query).toMatch(/C language/i);
      await expect(page.getByRole("region", { name: /web sources/i }).last().getByRole("link").first()).toBeVisible();
    } else if (question.includes("C language") && !question.includes("website")) {
      expect(body.chat.answer.short_answer).toMatch(/not found in .*study material/i);
      expect(body.chat.answer.source_citations ?? []).toHaveLength(0);
    }
    const intentMs = await page.evaluate(() => performance.getEntriesByName("studypilot.chat.intent").at(-1)?.duration ?? -1);
    console.log(`[Intent latency] ${question}: route=${endpoint} intentMs=${intentMs.toFixed(2)} requestDelayMs=${delayToRequestMs} totalToResponseMs=${Date.now() - startedAt}`);
    await expect(composer).toBeEnabled();
  }
});
