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

async function login(page, email, password) {
  await page.goto("/auth?mode=login");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) }).first();
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: /^log in$/i }).click();
  try {
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    return true;
  } catch {
    return false;
  }
}

async function postJson(page, url, data) {
  return page.evaluate(
    async ({ url, data }) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await response.json().catch(async () => ({ raw: await response.text() }));
      return { status: response.status, body };
    },
    { url, data },
  );
}

async function getJson(page, url) {
  return page.evaluate(async (url) => {
    const response = await fetch(url);
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    return { status: response.status, body };
  }, url);
}

async function deleteJson(page, url) {
  return page.evaluate(async (url) => {
    const response = await fetch(url, { method: "DELETE" });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    return { status: response.status, body };
  }, url);
}

function hasDiagram(listResult, diagramId) {
  return Array.isArray(listResult.body?.diagrams)
    && listResult.body.diagrams.some((diagram) => diagram?.id === diagramId);
}

const env = readEnvFiles([".env.staging.local", ".env.local"]);
Object.assign(env, process.env);
const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
const results = {
  secondUserLogin: "FAIL",
  rlsSelect: "NOT VERIFIED",
  rlsDelete: "NOT VERIFIED",
  primaryOwnershipPreserved: "NOT VERIFIED",
  primaryCleanup: "NOT VERIFIED",
};

if (!env.STUDYPILOT_E2E_EMAIL || !env.STUDYPILOT_E2E_PASSWORD || !env.STUDYPILOT_E2E_OTHER_EMAIL || !env.STUDYPILOT_E2E_OTHER_PASSWORD) {
  console.log(JSON.stringify({ results, diagnostic: "missing_e2e_credentials" }, null, 2));
  process.exit(0);
}

const browser = await chromium.launch();
const primaryContext = await browser.newContext({ baseURL });
const secondaryContext = await browser.newContext({ baseURL });
const primaryPage = await primaryContext.newPage();
const secondaryPage = await secondaryContext.newPage();

let diagramId = "";

try {
  const primaryLogin = await login(primaryPage, env.STUDYPILOT_E2E_EMAIL, env.STUDYPILOT_E2E_PASSWORD);
  const secondLogin = await login(secondaryPage, env.STUDYPILOT_E2E_OTHER_EMAIL, env.STUDYPILOT_E2E_OTHER_PASSWORD);
  results.secondUserLogin = secondLogin ? "PASS" : "FAIL";

  if (!primaryLogin || !secondLogin) {
    console.log(JSON.stringify({ results, diagnostic: primaryLogin ? "second_user_login_failed" : "primary_login_failed" }, null, 2));
    process.exit(0);
  }

  const create = await postJson(primaryPage, "/api/ai/diagram", {
    diagramType: "flowchart",
    sourceType: "topic",
    topic: "Lexical analysis converts source code into tokens before parsing and abstract syntax tree construction.",
  });

  if (create.status !== 200 || !create.body?.persisted || !create.body?.diagramId) {
    console.log(JSON.stringify({ results, diagnostic: "primary_create_failed", createStatus: create.status, createError: create.body?.error ?? null }, null, 2));
    process.exit(0);
  }

  diagramId = create.body.diagramId;

  const secondaryList = await getJson(secondaryPage, "/api/diagrams?limit=100");
  results.rlsSelect = secondaryList.status === 200 && !hasDiagram(secondaryList, diagramId) ? "PASS" : "FAIL";

  const secondaryDelete = await deleteJson(secondaryPage, `/api/diagrams/${diagramId}`);
  const primaryAfterSecondaryDelete = await getJson(primaryPage, "/api/diagrams?limit=100");
  const stillOwnedByPrimary = primaryAfterSecondaryDelete.status === 200 && hasDiagram(primaryAfterSecondaryDelete, diagramId);

  results.rlsDelete = stillOwnedByPrimary ? "PASS" : "FAIL";
  results.primaryOwnershipPreserved = stillOwnedByPrimary ? "PASS" : "FAIL";

  if (stillOwnedByPrimary) {
    const primaryDelete = await deleteJson(primaryPage, `/api/diagrams/${diagramId}`);
    const primaryAfterCleanup = await getJson(primaryPage, "/api/diagrams?limit=100");
    results.primaryCleanup =
      primaryDelete.status === 200
      && primaryAfterCleanup.status === 200
      && !hasDiagram(primaryAfterCleanup, diagramId)
        ? "PASS"
        : "FAIL";
  }

  console.log(JSON.stringify({
    results,
    evidence: {
      createStatus: create.status,
      diagramIdPresent: Boolean(diagramId),
      secondaryListStatus: secondaryList.status,
      secondaryDeleteStatus: secondaryDelete.status,
      primaryAfterSecondaryDeleteStatus: primaryAfterSecondaryDelete.status,
    },
  }, null, 2));
} finally {
  if (diagramId && results.primaryCleanup !== "PASS") {
    await deleteJson(primaryPage, `/api/diagrams/${diagramId}`).catch(() => null);
  }
  await primaryContext.close().catch(() => null);
  await secondaryContext.close().catch(() => null);
  await browser.close().catch(() => null);
}
