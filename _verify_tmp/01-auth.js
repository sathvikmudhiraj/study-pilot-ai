// 01-auth.js - Verify homepage is StudyPilot, real UI login, dashboard loads.
const { chromium } = require("playwright");
const path = require("path");
const { BASE_URL, evidence, shotName, login, trackApi } = require("./_lib");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const api = trackApi(page);

  // 1. Homepage
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  const title = await page.title();
  const bodyText = (await page.textContent("body")) || "";
  const isStudyPilot = title.includes("StudyPilot") && bodyText.includes("StudyPilot");
  evidence("homepage", { url: page.url(), title, isStudyPilot });
  await page.screenshot({ path: shotName("01-homepage") });

  // 2. Login page renders
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  const hasEmail = await page.locator('input[type="email"]').count();
  const hasPw = await page.locator('input[type="password"]').count();
  const loginHeading = await page.locator("text=Welcome back").count();
  evidence("login-page", { hasEmail, hasPw, loginHeading });
  await page.screenshot({ path: shotName("01-login") });

  // 3. Real login through UI
  await login(page);
  const dashUrl = page.url();
  const dashHeading = await page.locator("text=Student dashboard").count();
  evidence("dashboard", { url: dashUrl, dashHeadingVisible: dashHeading > 0 });
  await page.screenshot({ path: shotName("01-dashboard"), fullPage: false });

  // 4. Authenticated API session check
  const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
  let meJson = null;
  try { meJson = await meRes.json(); } catch {}
  const authed = meRes.status() === 200 && !!(meJson && (meJson.user || meJson.id || meJson.email));
  evidence("auth-me", { status: meRes.status(), authenticated: authed, keys: meJson ? Object.keys(meJson) : [] });

  // Save session for later phases
  await context.storageState({ path: path.join(__dirname, "auth-state.json") });

  const pass = isStudyPilot && hasEmail > 0 && hasPw > 0 && dashHeading > 0 && authed;
  evidence("01-RESULT", { pass, note: "homepage+login+dashboard+api-session" });
  console.log(JSON.stringify({ pass }));
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error("FATAL", e.message); process.exit(2); });
