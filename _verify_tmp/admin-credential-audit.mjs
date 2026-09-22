import nextEnv from "@next/env";
import { chromium } from "@playwright/test";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const email = process.env.STUDYPILOT_ADMIN_AUDIT_EMAIL;
const password = process.env.STUDYPILOT_ADMIN_AUDIT_PASSWORD;
if (!email?.trim() || !password) throw new Error("Admin credentials were not supplied.");

const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
const browser = await chromium.launch();
const context = await browser.newContext({ baseURL });
const page = await context.newPage();

const result = {
  login: false,
  trustedAdminRole: false,
  pages: {},
  apis: {},
  selfDemotionBlocked: false,
  authorizedRoleUpdate: false,
  roleUpdatePreservedStudent: false,
  roleUpdateRestored: false,
  exactAuthError: "",
};

try {
  await page.goto("/auth?mode=login");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) }).first();
  await form.getByLabel("Email").fill(email.trim());
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: /^log in$/i }).click();

  try {
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    result.login = true;
  } catch {
    const alert = await page.getByRole("alert").textContent().catch(() => "");
    result.exactAuthError = alert?.trim() || "Authentication did not reach the dashboard.";
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 2;
  }

  if (result.login) {
    const meResponse = await context.request.get(`${baseURL}/api/auth/me`);
    const me = await meResponse.json().catch(() => ({}));
    result.trustedAdminRole = meResponse.status() === 200 && me?.role === "admin";

    if (result.trustedAdminRole) {
      for (const path of ["/admin", "/admin/users", "/admin/files", "/admin/analytics", "/admin/monitoring", "/admin/audit-logs"]) {
        const response = await page.goto(path);
        await page.waitForLoadState("domcontentloaded");
        const finalPath = new URL(page.url()).pathname;
        result.pages[path] = {
          status: response?.status() ?? null,
          loaded: response?.status() === 200 && finalPath === path,
        };
      }

      for (const path of [
        "/api/admin/overview",
        "/api/admin/users",
        "/api/admin/files",
        "/api/admin/analytics",
        "/api/admin/monitoring",
        "/api/admin/audit-logs",
      ]) {
        const response = await context.request.get(`${baseURL}${path}`);
        result.apis[path] = { status: response.status(), loaded: response.status() === 200 };
      }

      const selfDemotion = await context.request.patch(`${baseURL}/api/admin/users/${me.id}/role`, {
        data: { role: "student" },
      });
      result.selfDemotionBlocked = [400, 403].includes(selfDemotion.status());

      const usersResponse = await context.request.get(`${baseURL}/api/admin/users`);
      const usersBody = await usersResponse.json().catch(() => ({}));
      const student = Array.isArray(usersBody?.users)
        ? usersBody.users.find((user) => user?.role === "student")
        : null;
      if (student?.id) {
        let promoted = false;
        try {
          const update = await context.request.patch(`${baseURL}/api/admin/users/${student.id}/role`, {
            data: { role: "admin" },
          });
          promoted = update.status() === 200;
          result.authorizedRoleUpdate = promoted;
          if (promoted) {
            const refreshedUsers = await context.request.get(`${baseURL}/api/admin/users`);
            const refreshedBody = await refreshedUsers.json().catch(() => ({}));
            const refreshedStudent = Array.isArray(refreshedBody?.users)
              ? refreshedBody.users.find((user) => user?.id === student.id)
              : null;
            result.roleUpdatePreservedStudent = refreshedStudent?.role === "admin";
          }
        } finally {
          if (promoted) {
            const restore = await context.request.patch(`${baseURL}/api/admin/users/${student.id}/role`, {
              data: { role: "student" },
            });
            result.roleUpdateRestored = restore.status() === 200;
          }
        }
      }
    }

    console.log(JSON.stringify(result, null, 2));
    if (!result.trustedAdminRole) process.exitCode = 3;
  }
} finally {
  await context.close().catch(() => null);
  await browser.close().catch(() => null);
}
