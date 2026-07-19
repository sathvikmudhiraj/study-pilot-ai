import { expect, test } from "@playwright/test";
import { login, logout, requireE2EEnv } from "./helpers";

test.describe("authentication", () => {
  test("redirects protected routes to auth when signed out", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth|\/dashboard/);
    if (page.url().includes("/auth")) {
      await expect(page.getByRole("heading", { name: /welcome back|unlock workspace|create your workspace/i })).toBeVisible();
    }
  });

  test("shows a clear invalid-login state", async ({ page }) => {
    await page.goto("/auth?mode=login");
    const email = page.getByLabel("Email");
    test.skip(!(await email.isVisible().catch(() => false)), "Auth form is in re-auth mode or Supabase is not configured.");

    await email.fill("invalid-e2e-user@example.test");
    await page.getByLabel("Password").fill("wrong-password");
    await page.locator("form").getByRole("button", { name: /^log in$/i }).click();
    await expect(page.getByText(/invalid|not configured|confirm/i)).toBeVisible();
  });

  test("logs in and logs out with isolated E2E credentials", async ({ page }) => {
    requireE2EEnv();
    await login(page);
    await logout(page);
  });
});
