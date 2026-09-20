import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

/**
 * Voice Tutor end-to-end with a mocked SpeechRecognition engine.
 *
 * What IS mocked: the browser speech-recognition hardware layer only
 * (window.SpeechRecognition + a speechSynthesis.speak recorder).
 * What is NOT mocked: the network. The transcript goes through the real
 * /api/ai/ask endpoint on the dev server, which calls the real AI provider
 * (Gemini primary, NVIDIA fallback) — we assert response_mode === "ai".
 */

test.describe("voice tutor mocked-speech pipeline (real AI backend)", () => {
  test.beforeEach(async ({ page }) => {
    requireE2EEnv();

    await page.addInitScript(() => {
      // -------------------------------------------------------------------
      // Mock SpeechRecognition (hardware layer only)
      // -------------------------------------------------------------------
      class MockSpeechRecognition {
        lang = "";
        continuous = false;
        interimResults = false;
        maxAlternatives = 1;
        onresult: ((event: unknown) => void) | null = null;
        onerror: ((event: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        onstart: (() => void) | null = null;
        onaudiostart: (() => void) | null = null;
        onaudioend: (() => void) | null = null;
        onsoundstart: (() => void) | null = null;
        onsoundend: (() => void) | null = null;
        onspeechstart: (() => void) | null = null;
        onspeechend: (() => void) | null = null;
        private started = false;

        start() {
          this.started = true;
          (window as unknown as { __mockRecognition: MockSpeechRecognition }).__mockRecognition = this;
          setTimeout(() => {
            this.onstart?.();
            this.onspeechstart?.();
          }, 25);
        }

        stop() {
          if (!this.started) return;
          this.started = false;
          setTimeout(() => {
            this.onspeechend?.();
            this.onend?.();
          }, 25);
        }

        abort() {
          this.stop();
        }

        /** Called from the test to push one final transcript into the app. */
        __emitFinal(transcript: string) {
          const result = { 0: { transcript, confidence: 0.98 }, isFinal: true, length: 1 };
          this.onresult?.({ resultIndex: 0, results: [result] });
        }
      }

      const speechWindow = window as unknown as Record<string, unknown>;
      speechWindow.SpeechRecognition = MockSpeechRecognition;
      speechWindow.webkitSpeechRecognition = MockSpeechRecognition;

      // -------------------------------------------------------------------
      // TTS recorder — count and capture speak() calls without real audio
      // -------------------------------------------------------------------
      speechWindow.__ttsCalls = [] as string[];
      const record = (utterance: SpeechSynthesisUtterance) => {
        (speechWindow.__ttsCalls as string[]).push(utterance.text);
        setTimeout(() => utterance.onend?.({} as SpeechSynthesisEvent), 25);
      };
      if (window.speechSynthesis && typeof window.speechSynthesis.speak === "function") {
        window.speechSynthesis.speak = record;
      } else {
        speechWindow.speechSynthesis = {
          speak: record,
          cancel: () => undefined,
          getVoices: () => [],
        };
      }
    });

    await login(page);
  });

  test("start listening -> final transcript -> real /api/ai/ask -> mode ai -> answer rendered -> TTS fired", async ({ page }) => {
    test.setTimeout(420_000);

    // Unique token keeps the question off the answer cache, so the answer must
    // come from the live AI provider (asserted via answer.response_mode below).
    const question = `Explain what recursion means in programming in one short paragraph. Token ${Date.now()}`;

    // --- UI ---------------------------------------------------------------
    await page.goto("/voice");
    await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();

    // --- Start listening ---------------------------------------------------
    await page.getByRole("button", { name: /start listening/i }).click();
    await expect(page.getByRole("button", { name: /stop listening/i })).toBeVisible();

    // --- Feed a final transcript, then end the session --------------------
    const askResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/ai/ask") && response.request().method() === "POST",
      { timeout: 360_000 },
    );

    await page.evaluate((spoken) => {
      const recognition = (window as unknown as {
        __mockRecognition: { __emitFinal: (text: string) => void; stop: () => void };
      }).__mockRecognition;
      recognition.__emitFinal(spoken);
      recognition.stop();
    }, question);

    // --- Real backend response --------------------------------------------
    const askResponse = await askResponsePromise;
    expect(askResponse.ok(), `ask failed: ${askResponse.status()} ${await askResponse.text()}`).toBeTruthy();
    const payload = await askResponse.json();

    // `chat.answer.response_mode === "ai"` proves a real AI provider generated
    // the answer (Gemini, or NVIDIA fallback). Top-level `mode` carries the
    // context strategy ("keyword-context" / "selected-context" / "ai").
    expect(payload.chat?.answer?.response_mode).toBe("ai");
    expect(payload.mode).not.toBe("offline_fallback");

    const shortAnswer = String(payload.chat?.answer?.short_answer ?? "");
    expect(shortAnswer.trim().length).toBeGreaterThan(0);
    console.log(`[voice-mocked] provider mode=${payload.mode} short_answer=${shortAnswer.slice(0, 120)}`);

    // --- Answer rendered ---------------------------------------------------
    // The question text can also appear inside the model's answer (it quotes
    // the user), so target the first match (the user turn bubble) only.
    await expect(page.getByText(question).first()).toBeVisible();
    await expect(page.getByText("Short Answer").first()).toBeVisible({ timeout: 15_000 });
    const anchorWord = shortAnswer.split(/\s+/).find((word) => word.replace(/[^A-Za-z]/g, "").length >= 6) ?? shortAnswer;
    await expect(page.getByText(anchorWord, { exact: false }).first()).toBeVisible();

    // --- TTS triggered ------------------------------------------------------
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as { __ttsCalls: string[] }).__ttsCalls.length))
      .toBeGreaterThan(0);
    const ttsCalls = await page.evaluate(() => (window as unknown as { __ttsCalls: string[] }).__ttsCalls);
    const lastSpoken = ttsCalls[ttsCalls.length - 1] ?? "";
    expect(lastSpoken.trim().length).toBeGreaterThan(10);
    console.log(`[voice-mocked] TTS speak() called ${ttsCalls.length}x, text starts: "${lastSpoken.slice(0, 80)}"`);
  });
});
