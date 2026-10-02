import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

async function findModule3FileId(page: import("@playwright/test").Page) {
  await page.goto("/files");
  const link = page.getByRole("link", { name: /Module-3\.docx/i }).first();
  test.skip(!(await link.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)), "Upload Module-3.docx to the E2E account first.");
  const href = await link.getAttribute("href");
  const fileId = href?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
  expect(fileId, "Module-3.docx must link to its file detail page").toBeTruthy();
  return fileId!;
}

test("Module-3 remains usable when study providers are unavailable", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(240_000);
  await login(page);
  const fileId = await findModule3FileId(page);
  await page.goto(`/files/${fileId}`);
  await expect(page.getByText(/Module-3\.docx/i).first()).toBeVisible();

  const conversationResponse = await page.request.post("/api/conversations", { data: { title: "Module-3 fallback E2E", context_mode: "file", active_file_ids: [fileId], language_code: "en" } });
  expect(conversationResponse.ok(), await conversationResponse.text()).toBe(true);
  const conversationId = (await conversationResponse.json()).conversation.id as string;

  async function ask(question: string, language = "en", deferPersistence = false) {
    const started = Date.now();
    const response = await page.request.post("/api/ai/ask", { data: { question, fileIds: [fileId], conversationId, language, deferPersistence }, timeout: 30_000 });
    const body = await response.json();
    expect(response.ok(), `${question}: ${JSON.stringify(body).slice(0, 500)}`).toBe(true);
    expect(String(body.chat?.answer?.short_answer ?? "").length).toBeGreaterThan(10);
    console.log(`[Module-3] ${question}: ${Date.now() - started}ms mode=${body.mode} items=${body.chat?.answer?.fallback_item_ids?.length ?? 0} preview=${String(body.chat?.answer?.simple_explanation ?? "").slice(0, 180)}`);
    return body;
  }

  const notes = await ask("Give important notes");
  expect(notes.chat.answer.source_citations?.length).toBeGreaterThan(0);
  const nextNotes = await ask("next");
  if (notes.mode === "offline_fallback" && nextNotes.mode === "offline_fallback") {
    const first = new Set(notes.chat.answer.fallback_item_ids as string[]);
    expect((nextNotes.chat.answer.fallback_item_ids as string[]).every((id) => !first.has(id))).toBe(true);
  }

  const exam = await ask("Generate exam questions");
  const nextExam = await ask("next");
  if (exam.mode === "offline_fallback" && nextExam.mode === "offline_fallback") {
    const first = new Set(exam.chat.answer.fallback_item_ids as string[]);
    expect((nextExam.chat.answer.fallback_item_ids as string[]).every((id) => !first.has(id))).toBe(true);
  }

  const viva = await ask("Give viva questions");
  expect(viva.chat.answer.step_by_step.length).toBeGreaterThan(0);
  const beginner = await ask("Explain this file like a beginner");
  expect(beginner.chat.answer.step_by_step.length).toBeGreaterThan(0);
  const topicWise = await ask("Summarize topic-wise");
  expect(topicWise.chat.answer.step_by_step.length).toBeGreaterThan(0);

  const telugu = await ask("Give important notes", "te");
  expect(telugu.chat.answer.short_answer).toMatch(/[\u0c00-\u0c7f]/);

  const quizStarted = Date.now();
  const quizResponse = await page.request.post("/api/quiz", { data: { fileId, count: 8, difficulty: "medium", questionTypes: ["mcq", "short"], language: "en" }, timeout: 45_000 });
  const quiz = await quizResponse.json();
  expect(quizResponse.ok(), JSON.stringify(quiz).slice(0, 500)).toBe(true);
  expect(quiz.quiz?.questions?.length).toBeGreaterThan(0);
  console.log(`[Module-3] quiz: ${Date.now() - quizStarted}ms questions=${quiz.quiz.questions.length} first=${quiz.quiz.questions[0]?.question}`);

  const revisionStarted = Date.now();
  const revisionResponse = await page.request.post("/api/revision", { data: { fileId, language: "en", force: true }, timeout: 45_000 });
  const revision = await revisionResponse.json();
  expect(revisionResponse.ok(), JSON.stringify(revision).slice(0, 500)).toBe(true);
  expect(revision.plan?.daily_plan?.length).toBe(7);
  expect(revision.reused).toBe(false);
  console.log(`[Module-3] revision: ${Date.now() - revisionStarted}ms days=${revision.plan.daily_plan.length} topics=${revision.plan.important_topics?.slice(0, 5).join(" | ")}`);

  const matchingAsk = await ask("What are set operators in this file?");
  expect(matchingAsk.chat.answer.source_citations?.length).toBeGreaterThan(0);
  expect(matchingAsk.chat.answer.source_citations.every((citation: { source_id?: string }) => citation.source_id === fileId)).toBe(true);

  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onstart: (() => void) | null = null;
      onspeechstart: (() => void) | null = null;
      onspeechend: (() => void) | null = null;
      start() { (window as unknown as { __recognition: MockSpeechRecognition }).__recognition = this; setTimeout(() => { this.onstart?.(); this.onspeechstart?.(); }, 25); }
      stop() { setTimeout(() => { this.onspeechend?.(); this.onend?.(); }, 25); }
      abort() { this.stop(); }
      emit(transcript: string) { this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript, confidence: 0.99 }, isFinal: true, length: 1 }] }); }
    }
    const speech = window as unknown as Record<string, unknown>;
    speech.SpeechRecognition = MockSpeechRecognition;
    speech.webkitSpeechRecognition = MockSpeechRecognition;
    speech.__ttsCalls = [] as string[];
    if (window.speechSynthesis) window.speechSynthesis.speak = (utterance: SpeechSynthesisUtterance) => {
      (speech.__ttsCalls as string[]).push(utterance.text);
      setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 25);
    };
  });
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  await page.getByRole("button", { name: /start listening/i }).click();
  const voiceResponsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/ask") && response.request().method() === "POST", { timeout: 30_000 });
  await page.evaluate(() => { const recognition = (window as unknown as { __recognition: { emit: (text: string) => void; stop: () => void } }).__recognition; recognition.emit("What are set operators in this file?"); recognition.stop(); });
  const voiceResponse = await voiceResponsePromise;
  expect(voiceResponse.ok(), await voiceResponse.text()).toBe(true);
  const voicePayload = await voiceResponse.json();
  expect(String(voicePayload.chat?.answer?.short_answer ?? "").length).toBeGreaterThan(10);
  expect(voicePayload.chat.answer.source_citations?.length).toBeGreaterThan(0);
  expect(voicePayload.chat.answer.source_citations.every((citation: { source_id?: string }) => citation.source_id === fileId)).toBe(true);
  expect(
    new Set(voicePayload.chat.answer.source_citations.map((citation: { source_id?: string }) => citation.source_id)),
  ).toEqual(new Set(matchingAsk.chat.answer.source_citations.map((citation: { source_id?: string }) => citation.source_id)));
  await expect(page.getByText(/What are set operators in this file\?/i).first()).toBeVisible();
  await expect(page.getByText(/Important points from the selected material|Short Answer/i).first()).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ttsCalls: string[] }).__ttsCalls.length)).toBeGreaterThan(0);
  console.log(`[Module-3] voice UI: mode=${voicePayload.mode} answer=${String(voicePayload.chat.answer.short_answer).slice(0, 120)}`);

  await page.goto(`/chat?conversationId=${conversationId}`);
  await expect(page.getByText(/Give important notes/i).first()).toBeVisible();
  await page.goto(`/quiz?fileId=${fileId}`);
  await expect(page.getByRole("heading", { name: /quiz generator/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /take quiz/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /take quiz/i }).first().click();
  await expect(page.getByText(/Which term in the material|According to the material/i).first()).toBeVisible();
  const questionCards = page.locator("article").filter({ hasText: /Multiple choice|Short answer/i });
  const questionCount = await questionCards.count();
  expect(questionCount).toBeGreaterThan(0);
  for (let index = 0; index < questionCount; index += 1) {
    const card = questionCards.nth(index);
    if (/Multiple choice/i.test(await card.innerText())) {
      await card.locator("button").first().click();
    } else {
      await card.getByPlaceholder("Type your answer...").fill("SQL set operators");
    }
  }
  await page.getByRole("button", { name: /submit answers/i }).click();
  await expect(page.getByText(/attempt saved/i)).toBeVisible();
  await expect(page.getByText(/Score:/i).first()).toBeVisible();
  await page.goto(`/revision?fileId=${fileId}`);
  await expect(page.getByRole("heading", { name: /revision planner/i })).toBeVisible();
});

test("Module-3 fresh revision uses specific source topics", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(45_000);
  await login(page);
  const fileId = await findModule3FileId(page);
  const started = Date.now();
  const response = await page.request.post("/api/revision", { data: { fileId, language: "en", force: true }, timeout: 45_000 });
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body).slice(0, 500)).toBe(true);
  expect(body.reused).toBe(false);
  expect(body.plan?.daily_plan).toHaveLength(7);
  const topics = body.plan.important_topics as string[];
  expect(topics.slice(0, 5).every((topic) => !/^(same|records?|result|operators?|features?|tables?|queries?)$/i.test(topic))).toBe(true);
  expect(topics.some((topic) => /set operators|union|intersect|sql/i.test(topic))).toBe(true);
  console.log(`[Module-3] fresh revision: ${Date.now() - started}ms topics=${topics.slice(0, 8).join(" | ")}`);
  await page.goto(`/revision?fileId=${fileId}`);
  await expect(page.getByText(/Relational set operators|Set Operators/i).first()).toBeVisible();
});
