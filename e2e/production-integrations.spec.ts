import { expect, test } from "@playwright/test";
import { login, openLoginForm, requireE2EEnv } from "./helpers";

test("live web search renders three compact linked sources", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(90_000);
  await login(page);
  await page.goto("/chat");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("heading", { name: /what would you like to study/i })).toBeVisible();
  await page.getByRole("button", { name: /add attachment/i }).click();
  await page.getByRole("menuitem", { name: /web search/i }).click();
  await page.getByRole("textbox", { name: /type your question/i }).fill("what is cloud");
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/web-search") && response.request().method() === "POST", { timeout: 65_000 });
  await page.getByRole("button", { name: "Search the web" }).click();
  const response = await responsePromise;
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body).slice(0, 500)).toBe(true);
  expect(body.answer?.web_citations?.length).toBeGreaterThanOrEqual(3);
  const sources = page.getByRole("region", { name: /web sources/i });
  await expect(sources).toBeVisible();
  await expect(sources.getByRole("link")).toHaveCount(3);
  for (const link of await sources.getByRole("link").all()) {
    expect(await link.getAttribute("href")).toMatch(/^https?:\/\//);
  }
  expect(await sources.textContent()).not.toMatch(/\bsvg\b/i);
  console.log(`[Production] web search: ${body.answer.web_citations.map((item: { domain: string }) => item.domain).join(", ")}`);
});

test("live Module-3 summary reports fresh success or a clean provider failure", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(150_000);
  await login(page);
  await page.goto("/files");
  const fileLink = page.getByRole("link", { name: /Module-3\.docx/i }).first();
  await expect(fileLink).toBeVisible();
  const fileId = (await fileLink.getAttribute("href"))?.match(/\/files\/([0-9a-f-]{36})/i)?.[1];
  expect(fileId).toBeTruthy();
  const started = Date.now();
  const response = await page.request.post("/api/ai/summarize", { data: { fileId, language: "en" }, timeout: 130_000 });
  const body = await response.json();
  console.log(`[Production] summary: status=${response.status()} elapsed=${Date.now() - started}ms fresh=${body.regenerationSucceeded} stale=${body.staleSummary} error=${String(body.error ?? "").slice(0, 180)}`);
  if (response.ok()) {
    expect(body.regenerationSucceeded).toBe(true);
    expect(body.staleSummary).toBe(false);
    expect(body.summary).toBeTruthy();
    expect(String(body.summary.summary ?? body.summary.short_summary ?? "").length).toBeGreaterThan(20);
    expect(body.summary.keyPoints ?? body.summary.key_points).toEqual(expect.any(Array));
    expect(body.summary.importantConcepts ?? body.summary.important_concepts).toEqual(expect.any(Array));
    expect(body.summary.studyAreas ?? body.summary.covered_topics).toEqual(expect.any(Array));
    expect(body.summary.examQuestions ?? body.summary.exam_focus_points).toEqual(expect.any(Array));
    expect(body.summary.suggestedTags ?? body.summary.suggested_tags).toEqual(expect.any(Array));
    expect(String(body.summary.suggestedNextStep ?? body.summary.suggested_next_step ?? "").length).toBeGreaterThan(10);
    expect(body.summary.sources ?? body.summary.source_citations).toEqual(expect.any(Array));
    await page.goto(`/files/${fileId}`);
    await expect(page.getByText(/AI summary/i).first()).toBeVisible();
    await expect(page.getByText("Summary: Ready", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Summary: Ready", { exact: true })).toBeVisible();
    await expect(page.getByText(/older summary shown/i)).toHaveCount(0);
  } else {
    expect(body.regenerationSucceeded).toBe(false);
    expect(String(body.error ?? "")).toMatch(/timed out|quota|busy|provider|service/i);
    expect(String(body.error ?? "")).not.toMatch(/format.*could not read/i);
  }
});

test("admin protected PDF preview streams PDF bytes without exposing storage JSON", async ({ page }) => {
  const email = process.env.STUDYPILOT_E2E_ADMIN_EMAIL;
  const password = process.env.STUDYPILOT_E2E_ADMIN_PASSWORD;
  test.skip(!email || !password, "Set dedicated admin E2E credentials in the process environment.");
  test.setTimeout(90_000);
  const loginForm = await openLoginForm(page);
  await loginForm.getByLabel("Email").fill(email!);
  await loginForm.getByLabel("Password").fill(password!);
  await loginForm.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const fileId = "9603b520-bc5d-4ecf-a65f-ba89c697e00b";
  await page.goto(`/files/${fileId}`);
  const frame = page.locator(`iframe[src^="/api/files/${fileId}/preview"]`);
  await expect(frame).toBeVisible();
  const response = await page.request.get(`/api/files/${fileId}/preview?variant=original`);
  expect(response.ok(), `preview status ${response.status()}: ${(await response.text()).slice(0, 180)}`).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  const bytes = await response.body();
  expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
  await page.getByRole("button", { name: /refresh preview/i }).click();
  await expect(frame).toHaveAttribute("src", /r=1/);
  console.log(`[Production] admin PDF preview: ${bytes.length} bytes, PDF signature valid`);
});

test("current 19-page PDF summary completes in the browser or shows a clean failure", async ({ page }) => {
  const email = process.env.STUDYPILOT_E2E_ADMIN_EMAIL;
  const password = process.env.STUDYPILOT_E2E_ADMIN_PASSWORD;
  test.skip(!email || !password, "Set dedicated admin E2E credentials in the process environment.");
  test.setTimeout(160_000);
  const loginForm = await openLoginForm(page);
  await loginForm.getByLabel("Email").fill(email!);
  await loginForm.getByLabel("Password").fill(password!);
  await loginForm.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/files/9603b520-bc5d-4ecf-a65f-ba89c697e00b");
  await expect(page.getByRole("heading", { name: "Study Summary", exact: true })).toBeVisible();
  const started = Date.now();
  const responsePromise = page.waitForResponse((response) => response.url().includes("/api/ai/summarize") && response.request().method() === "POST", { timeout: 140_000 });
  await page.getByRole("button", { name: /(?:re)?generate summary/i }).click();
  const response = await responsePromise;
  const body = await response.json();
  console.log(`[Production] current PDF browser summary: status=${response.status()} elapsed=${Date.now() - started}ms fresh=${body.regenerationSucceeded} stale=${body.staleSummary} error=${String(body.error ?? "").slice(0, 180)}`);
  if (response.ok()) {
    expect(body.regenerationSucceeded).toBe(true);
    expect(String(body.summary?.short_summary ?? "").length).toBeGreaterThan(10);
    await expect(page.getByText(/summary generation timed out|format.*could not read/i)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Study Summary", exact: true })).toBeVisible();
    await expect(page.getByText(/Last summary generated in/i)).toBeVisible({ timeout: 15_000 });
  } else {
    expect(body.regenerationSucceeded).toBe(false);
    expect(String(body.error ?? "")).toMatch(/timed out|quota|busy|provider|service|access/i);
    await expect(page.getByText(/format.*could not read/i)).toHaveCount(0);
  }
});
