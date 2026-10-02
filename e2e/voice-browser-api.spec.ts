import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

test("native browser speech synthesis controls work without an audio mock", async ({ page, context }) => {
  requireE2EEnv();
  test.setTimeout(90_000);
  await login(page);
  await context.clearPermissions();
  await page.goto("/voice");
  await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
  const support = await page.evaluate(() => ({
    recognition: typeof (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition === "function" || typeof (window as Window & { SpeechRecognition?: unknown }).SpeechRecognition === "function",
    synthesis: typeof window.speechSynthesis?.speak === "function",
    voices: window.speechSynthesis?.getVoices?.().length ?? 0,
  }));
  console.log(`[Voice browser API] recognition=${support.recognition} synthesis=${support.synthesis} installedVoices=${support.voices}`);
  expect(support.synthesis).toBe(true);
  if (support.recognition) {
    await page.getByRole("button", { name: /start listening/i }).click();
    await page.waitForTimeout(1_000);
    const stopped = page.getByRole("button", { name: /stop listening/i });
    if (await stopped.isVisible()) await stopped.click();
    console.log("[Voice browser API] physical microphone transcript not verifiable in headless Chromium");
  }

  const fileLink = page.getByRole("link", { name: /my files/i });
  await fileLink.click();
  const moduleLink = page.getByRole("link", { name: /Module-3\.docx/i }).first();
  await expect(moduleLink).toBeVisible();
  const fileId = (await moduleLink.getAttribute("href"))?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
  expect(fileId).toBeTruthy();
  const created = await page.request.post("/api/conversations", { data: { title: "Native voice browser audit", context_mode: "file", active_file_ids: [fileId], language_code: "en" } });
  expect(created.ok()).toBe(true);
  const conversationId = (await created.json()).conversation.id as string;
  const answered = await page.request.post("/api/ai/ask", { data: { question: "Explain set operators simply", fileIds: [fileId], conversationId, language: "en" }, timeout: 30_000 });
  expect(answered.ok(), await answered.text()).toBe(true);
  await page.goto(`/voice?conversationId=${conversationId}`);
  await expect(page.getByRole("button", { name: /read aloud/i })).toBeEnabled();
  await page.evaluate(() => {
    const originalSpeak = window.speechSynthesis.speak.bind(window.speechSynthesis);
    const originalCancel = window.speechSynthesis.cancel.bind(window.speechSynthesis);
    const state = { speaks: 0, cancels: 0, lastLanguage: "" };
    (window as Window & { __speechAudit?: typeof state }).__speechAudit = state;
    window.speechSynthesis.speak = (utterance) => {
      state.speaks += 1;
      state.lastLanguage = utterance.lang;
      originalSpeak(utterance);
    };
    window.speechSynthesis.cancel = () => {
      state.cancels += 1;
      window.sessionStorage.setItem("voiceAuditCancels", String(state.cancels));
      originalCancel();
    };
  });
  await page.getByRole("button", { name: /read aloud/i }).click();
  const afterSpeak = await page.evaluate(() => (window as unknown as { __speechAudit: { speaks: number; cancels: number; lastLanguage: string } }).__speechAudit);
  expect(afterSpeak.speaks).toBe(1);
  expect(afterSpeak.lastLanguage).toMatch(/^en/i);
  await expect(page.getByLabel("Voice tutor is speaking")).toBeVisible();
  await expect(page.getByRole("button", { name: /stop speaking/i })).toBeEnabled();
  await page.getByRole("button", { name: /stop speaking/i }).click();
  const afterStop = await page.evaluate(() => (window as unknown as { __speechAudit: { speaks: number; cancels: number } }).__speechAudit);
  expect(afterStop.cancels).toBeGreaterThan(afterSpeak.cancels);
  await expect(page.getByRole("button", { name: /stop speaking/i })).toBeDisabled();
  await page.getByRole("button", { name: /read aloud/i }).click();
  const secondSpeak = await page.evaluate(() => (window as unknown as { __speechAudit: { speaks: number; cancels: number } }).__speechAudit);
  expect(secondSpeak.speaks).toBe(2);
  expect(secondSpeak.cancels).toBeGreaterThan(afterStop.cancels);
  await page.getByRole("button", { name: /stop speaking/i }).click();
  await page.getByRole("combobox", { name: /speaking language/i }).selectOption("te");
  await page.getByRole("button", { name: /read aloud/i }).click();
  const teluguSpeak = await page.evaluate(() => (window as unknown as { __speechAudit: { speaks: number; cancels: number; lastLanguage: string } }).__speechAudit);
  expect(teluguSpeak.speaks).toBe(3);
  expect(teluguSpeak.lastLanguage).toMatch(/^te/i);
  await page.getByRole("button", { name: /stop speaking/i }).click();
  await page.getByRole("button", { name: /^replay$/i }).click();
  const replaySpeak = await page.evaluate(() => (window as unknown as { __speechAudit: { speaks: number; cancels: number; lastLanguage: string } }).__speechAudit);
  expect(replaySpeak.speaks).toBe(4);
  expect(replaySpeak.lastLanguage).toMatch(/^te/i);
  await page.getByRole("link", { name: /my files/i }).click();
  await expect(page).toHaveURL(/\/files$/);
  const cancelsAfterNavigation = await page.evaluate(() => Number(window.sessionStorage.getItem("voiceAuditCancels") ?? 0));
  expect(cancelsAfterNavigation).toBeGreaterThan(replaySpeak.cancels);
  console.log("[Voice browser API] native speechSynthesis speak/stop controls operated; audible output remains unverified");
});
