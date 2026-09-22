import nextEnv from "@next/env";
import { chromium } from "@playwright/test";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
const credentials = [
  { name: "primary", email: process.env.STUDYPILOT_E2E_EMAIL, password: process.env.STUDYPILOT_E2E_PASSWORD },
  { name: "secondary", email: process.env.STUDYPILOT_E2E_OTHER_EMAIL, password: process.env.STUDYPILOT_E2E_OTHER_PASSWORD },
];
if (credentials.some((item) => !item.email || !item.password)) throw new Error("E2E credentials are missing.");

const browser = await chromium.launch();

async function login(account) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/auth?mode=login");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) }).first();
  await form.getByLabel("Email").fill(account.email);
  await form.getByLabel("Password").fill(account.password);
  await form.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  const me = await page.evaluate(async () => {
    const response = await fetch("/api/auth/me");
    return { status: response.status, body: await response.json().catch(() => ({})) };
  });
  return { ...account, context, page, me };
}

const signedOutContext = await browser.newContext({ baseURL });
const signedOutPage = await signedOutContext.newPage();
const signedOutResponse = await signedOutPage.goto("/admin");
await signedOutPage.waitForLoadState("domcontentloaded");
const signedOutUrl = signedOutPage.url();
const signedOutApi = await signedOutPage.evaluate(async () => {
  const response = await fetch("/api/admin/users");
  return response.status;
});

const sessions = [];
try {
  for (const account of credentials) sessions.push(await login(account));

  const accountResults = [];
  for (const session of sessions) {
    const role = session.me.body?.role ?? null;
    const beforeId = session.me.body?.id ?? "";
    const pageResponse = await session.page.goto("/admin");
    await session.page.waitForLoadState("domcontentloaded");
    await session.page.waitForURL(role === "student" ? /\/dashboard(?:\?|$)/ : /\/admin(?:\/|\?|$)/, { timeout: 10_000 });
    const finalUrl = session.page.url();
    const adminUsersResponse = await session.context.request.get(`${baseURL}/api/admin/users`);
    const adminUsersStatus = adminUsersResponse.status();
    const selfPromotionStatus = beforeId
      ? (await session.context.request.patch(`${baseURL}/api/admin/users/${beforeId}/role`, { data: { role: "admin" } })).status()
      : null;
    const afterMeResponse = await session.context.request.get(`${baseURL}/api/auth/me`);
    const afterMe = { status: afterMeResponse.status(), body: await afterMeResponse.json().catch(() => ({})) };
    accountResults.push({
      account: session.name,
      role,
      adminPageStatus: pageResponse?.status() ?? null,
      adminPageBlocked: role === "student" ? /\/dashboard(?:\?|$)/.test(finalUrl) : finalUrl.includes("/admin"),
      adminUsersStatus,
      selfPromotionStatus,
      roleUnchanged: afterMe.body?.role === role,
    });
  }

  const adminSession = sessions.find((session) => session.me.body?.role === "admin");
  const adminPages = {};
  let selfDemotionStatus = null;
  if (adminSession) {
    for (const path of ["/admin", "/admin/users", "/admin/files", "/admin/analytics", "/admin/monitoring", "/admin/audit-logs"]) {
      const response = await adminSession.page.goto(path);
      await adminSession.page.waitForLoadState("domcontentloaded");
      adminPages[path] = {
        status: response?.status() ?? null,
        finalPath: new URL(adminSession.page.url()).pathname,
      };
    }
    const adminId = adminSession.me.body?.id;
    selfDemotionStatus = (await adminSession.context.request.patch(`${baseURL}/api/admin/users/${adminId}/role`, { data: { role: "student" } })).status();
  }

  console.log(JSON.stringify({
    unauthenticated: {
      pageInitialStatus: signedOutResponse?.status() ?? null,
      pageBlocked: /\/auth(?:\?|$)/.test(signedOutUrl),
      apiStatus: signedOutApi,
    },
    accounts: accountResults,
    adminAvailable: Boolean(adminSession),
    adminPages,
    adminSelfDemotionStatus: selfDemotionStatus,
  }, null, 2));
} finally {
  for (const session of sessions) await session.context.close().catch(() => null);
  await signedOutContext.close().catch(() => null);
  await browser.close().catch(() => null);
}
