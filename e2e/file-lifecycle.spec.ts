import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

test.describe("file lifecycle", () => {
  test.beforeAll(() => {
    requireE2EEnv();
  });

  test("owner can delete an uploaded file from the library", async ({ page }) => {
    const fileName = `lifecycle-${Date.now()}.txt`;
    await login(page);
    await page.goto("/upload");

    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByText(/click to choose a file/i).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from("StudyPilot lifecycle test material."),
    });
    await page.getByRole("button", { name: /upload file/i }).click();
    await expect(page.getByText(/study material uploaded successfully/i)).toBeVisible({ timeout: 30_000 });

    await page.goto("/files");
    const card = page.locator("article").filter({ hasText: fileName });
    await expect(card).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: `Delete ${fileName}` }).click();

    await expect(card).toHaveCount(0, { timeout: 15_000 });
  });
});
