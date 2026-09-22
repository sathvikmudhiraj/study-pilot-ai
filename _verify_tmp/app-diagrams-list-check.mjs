import fs from "node:fs";
import { chromium } from "@playwright/test";

function readEnvFiles(files) {
  const env = {};
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = readEnvFiles([".env.local", ".env.staging.local"]);
const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
const browser = await chromium.launch();
const page = await browser.newPage({ baseURL });

await page.goto("/auth?mode=login");
const loginForm = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) }).first();
await loginForm.getByLabel("Email").fill(env.STUDYPILOT_E2E_EMAIL);
await loginForm.getByLabel("Password").fill(env.STUDYPILOT_E2E_PASSWORD);
await loginForm.getByRole("button", { name: /^log in$/i }).click();
await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

const result = await page.evaluate(async () => {
  const response = await fetch("/api/diagrams?limit=50");
  const body = await response.json().catch(async () => ({ raw: await response.text() }));
  return { status: response.status, body };
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
