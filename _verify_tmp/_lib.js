// Shared helpers for StudyPilot runtime verification. Reads credentials from
// .env.local but NEVER prints them. Temporary verification artifact - to be removed.
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BASE_URL = "http://localhost:3000";
const EVIDENCE_FILE = path.join(__dirname, "evidence.jsonl");
const SHOTS = path.join(__dirname, "shots");

function loadEnv() {
  const raw = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

function evidence(step, data) {
  const row = { ts: new Date().toISOString(), step, ...data };
  fs.appendFileSync(EVIDENCE_FILE, JSON.stringify(row) + "\n");
  console.log(`[EVIDENCE] ${step}: ${JSON.stringify(data).slice(0, 1200)}`);
}

function shotName(name) {
  return path.join(SHOTS, `${name}.png`);
}

function getCredentials() {
  const env = loadEnv();
  if (!env.STUDYPILOT_E2E_EMAIL || !env.STUDYPILOT_E2E_PASSWORD) {
    throw new Error("E2E credentials missing in .env.local");
  }
  return { email: env.STUDYPILOT_E2E_EMAIL, password: env.STUDYPILOT_E2E_PASSWORD };
}

// Records API traffic for /api/ routes. Bodies are capped; secrets never appear
// because these routes never return secrets.
function trackApi(page) {
  const calls = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("/api/")) return;
    const entry = {
      method: res.request().method(),
      url: url.replace(BASE_URL, ""),
      status: res.status(),
      contentType: res.headers()["content-type"] || "",
    };
    try {
      if (entry.contentType.includes("application/json")) {
        const body = await res.json();
        entry.jsonPreview = JSON.stringify(body).slice(0, 2000);
        entry._json = body; // full body kept in-memory only for assertions
      }
    } catch {}
    calls.push(entry);
  });
  return calls;
}

async function login(page) {
  const { email, password } = getCredentials();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"]', { timeout: 30000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Log in")');
  await page.waitForURL(/\/dashboard/, { timeout: 60000 });
  await page.waitForSelector("text=Student dashboard", { timeout: 60000 });
}

module.exports = { ROOT, BASE_URL, EVIDENCE_FILE, SHOTS, loadEnv, evidence, shotName, getCredentials, trackApi, login };
