import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

test.describe("Real AI runtime trace", () => {
  test.beforeEach(async ({ page }) => {
    requireE2EEnv();
    await login(page);
  });

  test("trace all three features with RelationalAlgebra.pptx", async ({ page }) => {
    test.setTimeout(600000);
    // ===== SETUP: Find RelationalAlgebra.pptx =====
    await page.goto("/files");
    await expect(page.getByRole("heading", { name: /my library/i })).toBeVisible();

    const fileLink = page.getByRole("link", { name: /Relational Algebra/i }).first();
    await expect(fileLink).toBeVisible({ timeout: 10000 });

    const href = await fileLink.getAttribute("href");
    const fileIdMatch = href?.match(/\/files\/([a-f0-9-]+)/);
    const fileId = fileIdMatch?.[1];
    expect(fileId, "Relational Algebra file link should include a file id").toBeTruthy();
    console.log("[TRACE] Found file:", { fileId, href });

    // ===== 1. LEARN STEP BY STEP =====
    console.log("[TRACE] === Starting Learn Step by Step ===");
    await page.goto("/chat");
    await expect(page.getByRole("heading", { name: /what would you like to study/i })).toBeVisible();

    // Click the Add attachment button (plus icon) to open the menu
    const addAttachmentButton = page.getByRole("button", { name: /add attachment/i });
    await expect(addAttachmentButton).toBeVisible({ timeout: 10000 });
    await addAttachmentButton.click();

    // Select "Attach from My Files" from the menu
    await page.getByRole("menu", { name: /attach options/i }).evaluate((element) => {
      element.scrollTop = 0;
    });
    const attachFromFilesItem = page.getByRole("menuitem", { name: /attach from my files/i });
    await expect(attachFromFilesItem).toBeVisible({ timeout: 10000 });
    await attachFromFilesItem.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await expect(page.getByRole("heading", { name: /attach from my files/i })).toBeVisible({ timeout: 10000 });

    // In the file picker, select the Relational Algebra file (could be button, link, or option)
    const fileOption = page.getByRole("button", { name: /Relational\s*Algebra.*\.pptx/i }).first();
    await expect(fileOption).toBeVisible({ timeout: 10000 });
    await fileOption.click();
    await page.getByRole("button", { name: /^done$/i }).click();

    // Wait for attachment to be processed
    await page.waitForTimeout(3000);

    // Click Learn Step by Step from the menu (it's a menuitem)
    await addAttachmentButton.click(); // Re-open menu
    const learnButton = page.getByRole("menuitem", { name: /learn step by step/i });
    await expect(learnButton).toBeVisible({ timeout: 10000 });
    await learnButton.click();

    // Ask a question to trigger Learn Step by Step
    const textbox = page.getByRole("textbox", { name: /type your question/i });
    await expect(textbox).toBeVisible({ timeout: 10000 });
    await textbox.fill("Teach me relational algebra step by step");
    
    // In Learn Step by Step mode, the button is "Start or continue Learn Step by Step"
    const sendButton = page.getByRole("button", { name: /start or continue learn step by step/i });
    await expect(sendButton).toBeVisible({ timeout: 10000 });
    await sendButton.click();

    // Wait for the response to appear (with longer timeout for real AI)
    let responseText = "";
    try {
      await expect(page.locator("[data-testid='chat-message'], .chat-message, [role='article']").last()).toBeVisible({ timeout: 180000 });
      responseText = (await page.locator("[data-testid='chat-message'], .chat-message, [role='article']").last().textContent()) ?? "";
      console.log("[TRACE] Learn Step response preview:", responseText?.slice(0, 500));
    } catch (e) {
      console.log("[TRACE] Learn Step by Step timed out or failed - checking for error message");
      // Check for any error state
      const errorText = (await page.locator("[role='alert'], .error, [data-testid='error']").first().textContent()) ?? "";
      console.log("[TRACE] Learn Step error:", errorText);
    }

    // ===== 2. QUIZ GENERATION =====
    console.log("[TRACE] === Starting Quiz Generation ===");
    await page.goto("/quiz");
    await expect(page.getByRole("heading", { name: /quiz generator/i })).toBeVisible({ timeout: 10000 });

    // Select file if needed - look for file selector
    const fileSelector = page.getByRole("button", { name: /attach file|select file|choose file/i }).first();
    if (await fileSelector.isVisible().catch(() => false)) {
      await fileSelector.click();
      await page.getByRole("option", { name: /Relational Algebra/i }).click();
    }

    // Generate quiz
    const generateButton = page.getByRole("button", { name: /generate quiz|create quiz/i }).first();
    await expect(generateButton).toBeVisible({ timeout: 10000 });
    await generateButton.click();

    // Wait for generation
    await page.waitForTimeout(120000);

    // Check for quiz result
    const quizContent = await page.locator("article").first().textContent();
    console.log("[TRACE] Quiz response preview:", quizContent?.slice(0, 500));

    // ===== 3. REVISION PLAN =====
    console.log("[TRACE] === Starting Revision Plan ===");
    await page.goto(`/revision?fileId=${encodeURIComponent(fileId ?? "")}`);
    await expect(page.getByRole("heading", { name: /^revision planner$/i })).toBeVisible({ timeout: 10000 });

    const revisionLoading = page.getByText(/creating revision plan from/i).first();
    const revGenerateButton = page.getByRole("button", { name: /generate plan|regenerate plan|generate revision|create revision|revision plan/i }).first();
    if (await revGenerateButton.isVisible().catch(() => false)) {
      await revGenerateButton.click();
    } else {
      await expect(revisionLoading).toBeVisible({ timeout: 10000 });
    }

    const revisionError = page.getByText(/could not generate|could not refresh|could not load/i).first();
    await expect(page.locator("article").first().or(revisionError)).toBeVisible({ timeout: 180000 });
    if (await revisionError.isVisible().catch(() => false)) {
      throw new Error(`Revision generation failed: ${(await revisionError.textContent()) ?? "unknown error"}`);
    }

    // Check for revision result
    const revisionContent = await page.locator("article").first().textContent();
    console.log("[TRACE] Revision response preview:", revisionContent?.slice(0, 500));
  });
});
