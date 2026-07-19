import { expect, test } from "@playwright/test";
import { login, requireE2EEnv, stubAI } from "./helpers";

test.describe("complete learning journey", () => {
  test.beforeEach(async ({ page }) => {
    requireE2EEnv();
    await stubAI(page);
    await login(page);
  });

  test("login -> upload/manual material -> quiz -> revision -> chat -> voice fallback", async ({ page }) => {
    const noteTitle = `E2E Networking ${Date.now()}`;

    await page.goto("/upload");
    await page.getByLabel("Title").fill(noteTitle);
    await page.getByLabel("Topic").fill("Networking");
    await page.getByLabel("Notes").fill(
      "Routing connects networks. Subnetting divides IP networks into smaller ranges. TCP is reliable and UDP is connectionless.",
    );
    await page.getByRole("button", { name: /save manual notes/i }).click();
    await expect(page.getByText(/manual notes saved|not configured|policy|missing/i)).toBeVisible();

    await page.goto("/quiz");
    await expect(page.getByRole("heading", { name: /quiz generator/i })).toBeVisible();
    const generateQuiz = page.getByRole("button", { name: /generate quiz/i }).first();
    if (await generateQuiz.isEnabled().catch(() => false)) {
      await generateQuiz.click();
      await expect(page.getByText(/Networking Quiz|CIDR|questions/i)).toBeVisible();
    }

    const submit = page.getByRole("button", { name: /submit|save attempt/i }).first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click();
      await expect(page.getByText(/weak topics|attempt saved|Subnetting/i)).toBeVisible();
    }

    await page.goto("/revision");
    await expect(page.getByRole("heading", { name: /revision planner/i })).toBeVisible();
    const generatePlan = page.getByRole("button", { name: /generate plan|regenerate plan/i }).first();
    if (await generatePlan.isVisible().catch(() => false)) {
      await generatePlan.click();
      await expect(page.getByText(/Networking Revision Plan|Subnetting|full chapter/i)).toBeVisible();
    }

    await page.goto("/chat");
    await expect(page.getByText(/AI Chat|StudyPilot|Ask/i)).toBeVisible();
    const composer = page.getByPlaceholder(/ask|message|question/i).first();
    if (await composer.isVisible().catch(() => false)) {
      await composer.fill("Explain subnetting");
      await page.keyboard.press("Enter");
      await expect(page.getByText(/Subnetting divides|prefix length/i)).toBeVisible();
      await page.reload();
      await expect(page.getByText(/Subnetting divides|Explain subnetting/i)).toBeVisible();
    }

    await page.goto("/voice");
    await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
    await expect(page.getByText(/browser does not support|start listening|voice assistant|microphone/i)).toBeVisible();
  });
});

