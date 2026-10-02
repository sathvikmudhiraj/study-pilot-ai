import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

test("Voice notes UI commands operate on a simulated provider draft", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(100_000);
  await login(page);
  await page.goto("/files");
  const file = page.getByRole("link", { name: /Module-3\.docx/i }).first();
  await expect(file).toBeVisible();
  const fileId = (await file.getAttribute("href"))?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
  expect(fileId).toBeTruthy();
  const created = await page.request.post("/api/conversations", {
    data: { title: "Voice notes UI simulation", context_mode: "file", active_file_ids: [fileId], language_code: "en" },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const conversationId = (await created.json()).conversation.id as string;

  await page.addInitScript(() => {
    class Recognition {
      onstart: (() => void) | null = null;
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
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/notes/generate", async (route) => {
    const payload = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(payload);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ draft: {
        title: "Set operators exam notes",
        topic: "Set operators",
        content: "# Set operators\n\nUNION combines rows from two compatible query results.",
        sourceType: payload.sourceType,
        fileId,
        sourceLabel: "Module-3.docx",
      } }),
    });
  });
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();

  async function speak(text: string) {
    await page.getByRole("button", { name: /start listening/i }).click();
    await page.evaluate((value) => {
      const recognition = (window as unknown as { __recognition: { emit: (text: string) => void; stop: () => void } }).__recognition;
      recognition.emit(value);
      recognition.stop();
    }, text);
  }

  const askPromise = page.waitForRequest((request) => request.url().includes("/api/ai/ask") && request.method() === "POST");
  await speak("give important notes");
  const ask = await askPromise;
  const answer = await ask.response();
  expect(answer?.ok(), await answer?.text()).toBe(true);
  const answerId = (await answer!.json()).chat.id as string;
  expect(answerId).toBeTruthy();
  await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();

  for (const [command, sourceType, style] of [
    ["create notes from this answer", "answer", "standard"],
    ["create notes from this summary", "summary", "standard"],
    ["make exam notes", "answer", "exam"],
    ["create one-page revision notes", "answer", "one_page"],
  ] as const) {
    const previousCount = requests.length;
    await speak(command);
    await expect.poll(() => requests.length).toBe(previousCount + 1);
    const payload = requests.at(-1)!;
    expect(payload.sourceType).toBe(sourceType);
    expect(payload.style).toBe(style);
    if (sourceType === "answer") expect(payload.answerId).toBe(answerId);
    await expect(page.getByRole("button", { name: /start listening/i })).toBeEnabled();
  }

  page.once("dialog", (dialog) => dialog.dismiss());
  await speak("save this as notes");
  await expect(page.getByText(/save cancelled/i).last()).toBeVisible();

  for (const [command, extension] of [
    ["download notes as pdf", ".pdf"],
    ["download notes as docx", ".docx"],
    ["download notes as markdown", ".md"],
    ["download notes as text", ".txt"],
  ] as const) {
    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await speak(command);
    expect((await downloadPromise).suggestedFilename().toLowerCase()).toContain(extension);
  }
  console.log("[Voice notes UI] handlers, confirmation, and local exports worked with a simulated notes provider; real generation remains unverified");
});
