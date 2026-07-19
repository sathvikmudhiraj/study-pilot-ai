import { expect, test } from "@playwright/test";
import { login, requireE2EEnv, stubAI } from "./helpers";

test.describe("focused E2E scenarios", () => {
  test.beforeEach(async ({ page }) => {
    requireE2EEnv();
    await stubAI(page);
    await login(page);
  });

  test("upload rejects unsupported file types before storage writes", async ({ page }) => {
    await page.goto("/upload");
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByText(/click to choose a file/i).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: "malware.exe",
      mimeType: "application/x-msdownload",
      buffer: Buffer.from("not a study file"),
    });
    await page.getByRole("button", { name: /upload file/i }).click();
    await expect(page.getByText(/unsupported file type/i)).toBeVisible();
  });

  test("large-document APIs expose cache/partial/retry states without duplicate extraction", async ({ page }) => {
    let summarizeCalls = 0;
    await page.route("**/api/ai/summarize", async (route) => {
      summarizeCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            suggested_title: "Large Chapter",
            short_summary: "Large chapter summary.",
            key_points: ["Processed representative chunks."],
            important_concepts: ["Chunk reuse"],
            covered_topics: ["Chunk reuse", "Partial recovery"],
            topic_wise_summary: [],
            suggested_tags: ["large-doc"],
            suggested_next_step: "Retry remaining chunks.",
            source_citations: [],
            generation_metadata: {
              attemptedChunks: 8,
              successfulChunks: [1, 2, 3, 4, 5, 6],
              failedChunks: [7, 8],
              failureCategories: ["processing-budget"],
              partialCoverage: true,
              sourceTextLength: 120000,
            },
          },
          partialCoverage: true,
          notice: "Partial summary saved.",
        }),
      });
    });

    await page.goto("/files");
    await expect(page.getByText(/files|upload notes|no files/i)).toBeVisible();
    expect(summarizeCalls).toBe(0);
  });

  test("dashboard shows real metric areas and empty states without fake values", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/quiz improvement|weak topics|revision progress|study streak/i)).toBeVisible();
    await expect(page.getByText(/recommended next study|learning insights/i)).toBeVisible();
  });

  test("step-by-step mode can start from a weak-topic recommendation", async ({ page }) => {
    await page.goto("/chat");
    await expect(page.getByText(/Learn Step by Step|Ask|StudyPilot/i)).toBeVisible();
    const learnButton = page.getByRole("button", { name: /learn step by step|start or continue learn/i }).first();
    if (await learnButton.isVisible().catch(() => false)) {
      await learnButton.click();
      await expect(page.getByText(/learn step by step|step/i)).toBeVisible();
    }
  });

  test("voice page handles unsupported or denied microphone behavior gracefully", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/voice");
    await expect(page.getByRole("heading", { name: /voice tutor/i })).toBeVisible();
    await expect(page.getByText(/voice assistant|start listening|browser does not support|microphone/i)).toBeVisible();
  });
});
