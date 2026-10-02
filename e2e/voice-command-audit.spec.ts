import { expect, test, type Page } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

async function askPayload(response: import("@playwright/test").Response) {
  const raw = await response.text();
  const contentType = response.headers()["content-type"] ?? "";
  if (!contentType.includes("application/x-ndjson")) return JSON.parse(raw);
  const events = raw.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  return events.findLast((event) => event.type === "final") ?? {};
}

async function installRecognition(page: Page) {
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
}

async function speak(page: Page, transcript: string) {
  const startedAt = Date.now();
  await page.getByRole("button", { name: /start listening/i }).click();
  await expect(page.getByLabel("Voice tutor is listening")).toBeVisible();
  await page.evaluate((text) => {
    const recognition = (window as unknown as { __recognition: { emit: (value: string) => void; stop: () => void } }).__recognition;
    recognition.emit(text);
    recognition.stop();
  }, transcript);
  return startedAt;
}

async function selectedVoiceConversation(page: Page) {
  await page.goto("/files");
  const file = page.getByRole("link", { name: /Module-3\.docx/i }).first();
  await expect(file).toBeVisible();
  const fileId = (await file.getAttribute("href"))?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
  expect(fileId).toBeTruthy();
  const response = await page.request.post("/api/conversations", {
    data: { title: "Voice command audit", context_mode: "file", active_file_ids: [fileId], language_code: "en" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return { conversationId: (await response.json()).conversation.id as string, fileId: fileId! };
}

test("advertised Voice navigation commands reach their pages", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(90_000);
  await login(page);
  await installRecognition(page);
  for (const [command, path] of [
    ["open dashboard", "/dashboard"], ["open files", "/files"],
    ["open quiz", "/quiz"], ["open revision", "/revision"],
  ]) {
    await page.goto("/voice");
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
    await speak(page, command);
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    console.log(`[Voice command] ${command} -> ${path}`);
  }
});

test("Voice study commands send their prepared questions with selected-file context", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(180_000);
  await login(page);
  await installRecognition(page);
  const { conversationId, fileId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  for (const [command, expectedQuestion] of [
    ["give important notes", /important notes and key points/i],
    ["explain this file", /explain this file in simple words/i],
  ] as const) {
    const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/ask") && request.method() === "POST", { timeout: 20_000 });
    const startedAt = await speak(page, command);
    const request = await requestPromise;
    const delayMs = Date.now() - startedAt;
    await expect(page.getByLabel("Voice tutor is thinking")).toBeVisible();
    const payload = request.postDataJSON();
    expect(payload.question).toMatch(expectedQuestion);
    expect(payload.fileIds).toContain(fileId);
    expect(payload.conversationId).toBe(conversationId);
    const response = await request.response();
    expect(response?.ok(), `${command}: ${await response?.text()}`).toBe(true);
    const chat = (await askPayload(response!)).chat;
    expect(chat?.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(chat?.answer?.short_answer).not.toMatch(/not found in the selected study material/i);
    await expect(page.getByText(command, { exact: true }).last()).toBeVisible();
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
    console.log(`[Voice latency] ${command}: requestDelayMs=${delayMs} apiAndRenderMs=${Date.now() - startedAt - delayMs} totalToVisibleMs=${Date.now() - startedAt}`);
  }
});

test("Voice generate quiz opens the file-backed quiz generator and renders questions", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(150_000);
  await login(page);
  await installRecognition(page);
  const { conversationId, fileId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/api/quiz") && request.method() === "POST", { timeout: 25_000 });
  const startedAt = await speak(page, "generate quiz");
  await expect(page).toHaveURL(new RegExp(`/quiz\\?fileId=${fileId}$`));
  const request = await requestPromise;
  const requestDelayMs = Date.now() - startedAt;
  expect(request.postDataJSON().fileId).toBe(fileId);
  const response = await request.response();
  const responseAt = Date.now();
  console.log(`[Voice quiz] status=${response?.status()} body=${(await response?.text())?.slice(0, 250)}`);
  expect(response?.ok(), await response?.text()).toBe(true);
  const quiz = (await response!.json()).quiz;
  expect(quiz?.questions?.length).toBeGreaterThan(0);
  await expect(page.getByText(quiz.questions[0].question, { exact: true })).toBeVisible();
  console.log(`[Voice latency] generate quiz: requestDelayMs=${requestDelayMs} apiMs=${responseAt - startedAt - requestDelayMs} totalToVisibleMs=${Date.now() - startedAt}`);
  await page.goto(`/quiz?fileId=${fileId}`);
  await expect(page.getByText(quiz.title, { exact: true }).first()).toBeVisible();
});

test("Voice create revision plan opens the file-backed planner and renders a fresh plan", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(120_000);
  await login(page);
  await installRecognition(page);
  const { conversationId, fileId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  const requestPromise = page.waitForRequest((request) => request.url().endsWith("/api/revision") && request.method() === "POST", { timeout: 25_000 });
  await speak(page, "create revision plan");
  await expect(page).toHaveURL(new RegExp(`/revision\\?fileId=${fileId}$`));
  const request = await requestPromise;
  expect(request.postDataJSON()).toMatchObject({ fileId, force: true });
  const response = await request.response();
  console.log(`[Voice revision] status=${response?.status()} body=${(await response?.text())?.slice(0, 250)}`);
  expect(response?.ok(), await response?.text()).toBe(true);
  const plan = (await response!.json()).plan;
  expect(plan?.daily_plan?.length).toBeGreaterThan(0);
  await expect(page.getByText(plan.title, { exact: true })).toBeVisible();
  await page.goto(`/revision?fileId=${fileId}`);
  await expect(page.getByText(plan.title, { exact: true })).toBeVisible();
});

test("natural Voice web phrases bypass notes and show live linked sources", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(140_000);
  await login(page);
  await installRecognition(page);
  const { conversationId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  let askCalls = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/ai/ask")) askCalls += 1; });

  for (const command of ["search in a web about C language", "okay do a website of what is C language"]) {
    const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/web-search") && request.method() === "POST", { timeout: 20_000 });
    const startedAt = await speak(page, command);
    const request = await requestPromise;
    const delayMs = Date.now() - startedAt;
    const response = await request.response();
    expect(response?.ok(), `${command}: ${await response?.text()}`).toBe(true);
    const result = await response!.json();
    expect(result.answer.query).toMatch(/C language/i);
    expect(askCalls).toBe(0);
    await expect(page.getByRole("region", { name: /web sources/i }).last().getByRole("link").first()).toBeVisible();
    const intentMs = await page.evaluate(() => performance.getEntriesByName("studypilot.voice.intent").at(-1)?.duration ?? -1);
    console.log(`[Voice latency] ${command}: intentMs=${intentMs.toFixed(2)} requestDelayMs=${delayMs} totalToVisibleMs=${Date.now() - startedAt}`);
  }
});

test("Voice notes commands prepare a preview and export the same note", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(260_000);
  await login(page);
  await installRecognition(page);
  const { conversationId, fileId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();

  const generatePromise = page.waitForRequest((request) => request.url().includes("/api/notes/generate") && request.method() === "POST", { timeout: 20_000 });
  await speak(page, "make exam notes");
  const request = await generatePromise;
  expect(request.postDataJSON()).toMatchObject({ style: "exam", sourceType: "file", fileId });
  const response = await request.response();
  expect(response?.ok(), await response?.text()).toBe(true);
  await expect(page.getByText(/editable notes preview is ready/i)).toBeVisible();

  for (const [command, extension] of [
    ["download notes as pdf", ".pdf"],
    ["download notes as docx", ".docx"],
    ["download notes as markdown", ".md"],
  ] as const) {
    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await speak(page, command);
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase()).toContain(extension);
    console.log(`[Voice command] ${command} -> ${download.suggestedFilename()}`);
  }
});

test("Voice follow-ups retain the selected file and switch language in one conversation", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(150_000);
  await login(page);
  await installRecognition(page);
  const { conversationId, fileId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  let previousVivaIds: string[] = [];

  for (const [command, language] of [
    ["Explain set operators", "en"],
    ["simple ga cheppu", "en"],
    ["Telugu lo simple ga cheppu", "te"],
    ["English lo cheppu", "en"],
    ["generate viva questions", "en"],
    ["next", "en"],
  ] as const) {
    const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/ask") && request.method() === "POST", { timeout: 20_000 });
    const startedAt = await speak(page, command);
    const request = await requestPromise;
    const payload = request.postDataJSON();
    expect(payload.fileIds).toContain(fileId);
    expect(payload.conversationId).toBe(conversationId);
    expect(payload.language).toBe(language);
    expect(payload.question).toContain(command);
    const response = await request.response();
    expect(response?.ok(), `${command}: ${await response?.text()}`).toBe(true);
    const chat = (await askPayload(response!)).chat;
    expect(chat?.id).toMatch(/^[0-9a-f-]{36}$/i);
    const answer = chat?.answer;
    expect(answer?.short_answer?.trim()).toBeTruthy();
    if (command === "Explain set operators") {
      await expect(page.getByText("Short Answer", { exact: true })).toHaveCount(0);
    }
    if (command === "generate viva questions" || command === "next") {
      expect(answer.short_answer).toMatch(/questions?/i);
      expect(answer.step_by_step?.length).toBeGreaterThan(0);
      const currentIds = answer.fallback_item_ids ?? [];
      if (command === "next" && previousVivaIds.length && currentIds.length) {
        expect(currentIds.filter((id: string) => previousVivaIds.includes(id))).toHaveLength(0);
      }
      previousVivaIds = currentIds;
    }
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
    console.log(`[Voice follow-up] ${command}: language=${language} totalToResponseMs=${Date.now() - startedAt} short=${String(answer.short_answer).slice(0, 90)}`);
  }
});

test("Voice Deep Research invokes the real research workflow", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(170_000);
  await login(page);
  await installRecognition(page);
  const { conversationId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/deep-research") && request.method() === "POST", { timeout: 20_000 });
  const startedAt = await speak(page, "research compiler optimization in detail");
  const request = await requestPromise;
  const requestDelayMs = Date.now() - startedAt;
  const response = await request.response();
  expect(response?.ok(), await response?.text()).toBe(true);
  await expect(page.getByText("Deep research", { exact: true }).last()).toBeVisible();
  console.log(`[Voice latency] deep research: requestDelayMs=${requestDelayMs} totalToVisibleMs=${Date.now() - startedAt}`);
});

test("Voice Diagram invokes the real diagram workflow", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(120_000);
  await login(page);
  await installRecognition(page);
  const { conversationId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/diagram") && request.method() === "POST", { timeout: 20_000 });
  const startedAt = await speak(page, "generate a diagram for set operators");
  const request = await requestPromise;
  const requestDelayMs = Date.now() - startedAt;
  const response = await request.response();
  expect(response?.ok(), await response?.text()).toBe(true);
  await expect(page.getByText("Generated diagram", { exact: true })).toBeVisible();
  console.log(`[Voice latency] diagram: requestDelayMs=${requestDelayMs} totalToVisibleMs=${Date.now() - startedAt}`);
});

test("remaining Voice web variants route to live sources without notes retrieval", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(220_000);
  await login(page);
  await installRecognition(page);
  const { conversationId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  let askCalls = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/ai/ask")) askCalls += 1; });
  for (const command of [
    "web search C language",
    "search the web for C language",
    "search online for C language",
    "look up C language online",
  ]) {
    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/web-search") && response.request().method() === "POST", { timeout: 65_000 });
    const startedAt = await speak(page, command);
    const response = await responsePromise;
    expect(response.ok(), `${command}: ${await response.text()}`).toBe(true);
    expect((await response.json()).answer.query).toMatch(/C language/i);
    await expect(page.getByRole("region", { name: /web sources/i }).last().getByRole("link").first()).toBeVisible();
    expect(askCalls).toBe(0);
    console.log(`[Voice web] ${command}: request and sources visible in ${Date.now() - startedAt}ms`);
  }
});

test("Voice tell me more continues the live web-search context", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(100_000);
  await login(page);
  await installRecognition(page);
  const { conversationId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  let askCalls = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/ai/ask")) askCalls += 1; });
  for (const [command, query] of [
    ["search the web for C language", /C language/],
    ["tell me more", /C language.*more detail/],
  ] as const) {
    const responsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/web-search") && response.request().method() === "POST", { timeout: 65_000 });
    await speak(page, command);
    const response = await responsePromise;
    expect(response.ok(), `${command}: ${await response.text()}`).toBe(true);
    expect((await response.json()).answer.query).toMatch(query);
    await expect(page.getByRole("region", { name: /web sources/i }).last().getByRole("link").first()).toBeVisible();
  }
  expect(askCalls).toBe(0);
});

test("normal Voice C query stays in selected notes and offers Web Search", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(80_000);
  await login(page);
  await installRecognition(page);
  const { conversationId, fileId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  let webCalls = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/ai/web-search")) webCalls += 1; });
  const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/ask") && request.method() === "POST");
  await speak(page, "okay what is C language");
  const request = await requestPromise;
  expect(request.postDataJSON().fileIds).toContain(fileId);
  const response = await request.response();
  expect(response?.ok(), await response?.text()).toBe(true);
  const answer = (await askPayload(response!)).chat.answer;
  expect(answer.short_answer).toMatch(/not found in .*study material/i);
  expect(answer.next_step).toMatch(/Web Search/i);
  expect(answer.source_citations ?? []).toHaveLength(0);
  expect(webCalls).toBe(0);
  await expect(page.getByText(/not found in .*study material/i).last()).toBeVisible();
});

test("Voice false positives remain normal study questions", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(180_000);
  await login(page);
  await installRecognition(page);
  const { conversationId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  let webCalls = 0;
  page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/ai/web-search")) webCalls += 1; });
  for (const command of [
    "What is a quiz?",
    "What is web search?",
    "What is a website?",
    "build a website about C language",
    "create a website about C language",
    "what is a text file?",
  ]) {
    const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/ask") && request.method() === "POST");
    await speak(page, command);
    const request = await requestPromise;
    expect(request.postDataJSON().question).toContain(command);
    const response = await request.response();
    expect(response?.ok(), `${command}: ${await response?.text()}`).toBe(true);
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
  }
  expect(webCalls).toBe(0);
});

test("Voice follow-up wording keeps file context and response language", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(180_000);
  await login(page);
  await installRecognition(page);
  const { conversationId, fileId } = await selectedVoiceConversation(page);
  await page.goto(`/voice?conversationId=${conversationId}`);
  for (const [command, language] of [
    ["Explain set operators", "en"],
    ["tell me more", "en"],
    ["short ga cheppu", "en"],
    ["detail ga cheppu", "en"],
    ["Telugu lo cheppu", "te"],
    ["English lo cheppu", "en"],
  ] as const) {
    const requestPromise = page.waitForRequest((request) => request.url().includes("/api/ai/ask") && request.method() === "POST");
    await speak(page, command);
    const request = await requestPromise;
    expect(request.postDataJSON()).toMatchObject({ question: command, conversationId, language });
    expect(request.postDataJSON().fileIds).toContain(fileId);
    const response = await request.response();
    expect(response?.ok(), `${command}: ${await response?.text()}`).toBe(true);
    expect((await askPayload(response!)).chat.answer.short_answer.trim()).toBeTruthy();
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
  }
});
