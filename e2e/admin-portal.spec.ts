import { expect, test } from "@playwright/test";
import { login, openLoginForm, requireE2EEnv } from "./helpers";

const adminPages = [
  { path: "/admin", title: "Admin Overview", api: "/api/admin/overview" },
  { path: "/admin/users", title: "Admin Users", api: "/api/admin/users" },
  { path: "/admin/files", title: "File Operations", api: "/api/admin/files" },
  { path: "/admin/analytics", title: "Learning Analytics", api: "/api/admin/analytics" },
  { path: "/admin/monitoring", title: "Monitoring", api: "/api/admin/monitoring" },
  { path: "/admin/audit-logs", title: "Audit Logs", api: "/api/admin/audit-logs" },
] as const;

test("student cannot open admin pages or APIs", async ({ page }) => {
  requireE2EEnv();
  test.setTimeout(120_000);
  await login(page);
  for (const { path, api } of adminPages) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/dashboard/);
    const response = await page.request.get(api);
    expect(response.status(), `${api} must reject a student`).toBe(403);
  }
});

test("admin can use all portal pages and return to the same StudyPilot page", async ({ page }) => {
  const email = process.env.STUDYPILOT_E2E_ADMIN_EMAIL;
  const password = process.env.STUDYPILOT_E2E_ADMIN_PASSWORD;
  test.skip(!email || !password, "Set dedicated admin E2E credentials in the process environment.");
  test.setTimeout(120_000);

  const loginForm = await openLoginForm(page);
  await loginForm.getByLabel("Email").fill(email!);
  await loginForm.getByLabel("Password").fill(password!);
  await loginForm.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  const meResponse = await page.request.get("/api/auth/me");
  expect(meResponse.ok()).toBe(true);
  expect((await meResponse.json()).role).toBe("admin");

  for (const { path, title, api } of adminPages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title, exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /back to studypilot/i })).toBeVisible();
    const response = await page.request.get(api);
    expect(response.ok(), `${api}: ${response.status()} ${await response.text()}`).toBe(true);
  }

  await page.goto("/chat");
  const conversationResponse = await page.request.post("/api/conversations", { data: { title: "Admin navigation E2E", context_mode: "general" } });
  expect(conversationResponse.ok()).toBe(true);
  const conversationId = (await conversationResponse.json()).conversation.id as string;
  await page.goto(`/chat?conversationId=${conversationId}`);
  await page.getByRole("link", { name: /^admin$/i }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: /back to studypilot/i }).click();
  await expect(page).toHaveURL(new RegExp(`/chat\\?conversationId=${conversationId}$`));

  await page.goto("/admin/files");
  await page.getByRole("button", { name: /back to studypilot/i }).click();
  await expect(page).toHaveURL(new RegExp(`/chat\\?conversationId=${conversationId}$`));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/monitoring");
  await expect(page.getByRole("navigation", { name: /admin quick navigation/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /back/i })).toBeVisible();
});
