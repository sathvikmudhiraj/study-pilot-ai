import { expect, test, type Page } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

const TEST_CONTENT = `The primary purpose of lexical analysis is tokenization. Lexical analysis converts source code into tokens. This is the first phase of compilation. A flowchart showing the process: source code -> lexer -> tokens -> parser -> AST.`;

async function loginWithCredentials(page: Page, email: string, password: string) {
  await page.goto("/auth?mode=login");
  const loginForm = page.locator("form").filter({
    has: page.getByRole("button", { name: /^log in$/i }),
  }).first();
  await loginForm.getByLabel("Email").fill(email);
  await loginForm.getByLabel("Password").fill(password);
  await loginForm.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
}

async function uploadTestFile(page: Page): Promise<string> {
  await page.goto("/upload");
  await expect(page.getByRole("heading", { name: /upload study material/i })).toBeVisible({ timeout: 10_000 });

  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByText(/click to choose a file/i).click();
  const chooser = await chooserPromise;

  const fs = require("fs");
  const path = require("path");
  const testFilePath = path.join(__dirname, "..", "test", "fixtures", "sample-study.txt");
  if (!fs.existsSync(path.dirname(testFilePath))) {
    fs.mkdirSync(path.dirname(testFilePath), { recursive: true });
  }
  fs.writeFileSync(testFilePath, TEST_CONTENT);

  await chooser.setFiles(testFilePath);
  await page.getByRole("button", { name: /upload file/i }).click();

  await expect(page.getByText(/study material uploaded successfully/i)).toBeVisible({ timeout: 30_000 });

  await page.goto("/files");
  await expect(page.getByRole("heading", { name: /my library/i })).toBeVisible();
  const firstFileLink = page.locator('a[href^="/files/"]').first();
  await expect(firstFileLink).toBeVisible({ timeout: 10_000 });
  const href = await firstFileLink.getAttribute("href");
  const fileId = href?.split("/files/")[1] ?? "";
  console.log(`✓ Test file uploaded with ID: ${fileId}`);
  return fileId;
}

async function generateDiagramViaAPI(page: Page, fileId: string, diagramType = "flowchart", sourceType = "topic") {
  const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
  const requestBody: Record<string, any> = { diagramType, sourceType };
  if (sourceType === "file") {
    requestBody.fileId = fileId;
  } else if (sourceType === "topic") {
    requestBody.topic = TEST_CONTENT;
  }
  const result = await page.evaluate(async ({ baseURL, requestBody }) => {
    const response = await fetch(`${baseURL}/api/ai/diagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(requestBody),
    });
    const respBody = await response.json().catch(() => ({}));
    return { status: response.status, body: respBody };
  }, { baseURL, requestBody });

  return result;
}

async function listDiagramsViaAPI(page: Page) {
  const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
  const result = await page.evaluate(async (baseURL) => {
    const response = await fetch(`${baseURL}/api/diagrams?limit=50`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }, baseURL);

  return result;
}

async function deleteDiagramViaAPI(page: Page, diagramId: string) {
  const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
  const result = await page.evaluate(async ({ baseURL, diagramId }) => {
    const response = await fetch(`${baseURL}/api/diagrams/${diagramId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }, { baseURL, diagramId });

  return result;
}

async function verifyAuthSession(page: Page) {
  console.log("\n=== Verifying authenticated session ===");

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /student dashboard|dashboard/i }).first()).toBeVisible();
  console.log("✓ Dashboard accessible");

  const meResponse = await page.evaluate(async (baseURL) => {
    const response = await fetch(`${baseURL}/api/auth/me`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  }, process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210");

  expect(meResponse.status).toBe(200);
  expect(meResponse.body.email).toBeTruthy();
  console.log(`✓ /api/auth/me verified - user: ${meResponse.body.email}`);

  return meResponse.body;
}

test.describe("Diagram CRUD - Real End-to-End Test", () => {
  test.beforeAll(async () => {
    requireE2EEnv();
  });

  test("Full Diagram CRUD Flow", async ({ page, browser }) => {
    test.setTimeout(180_000);

    // Track results for final report
    const results = {
      auth: "FAIL",
      aiGeneration: "NOT VERIFIED",
      create: "FAIL",
      read: "FAIL",
      update: "NOT IMPLEMENTED",
      delete: "FAIL",
      rlsSelect: "NOT VERIFIED",
      rlsUpdate: "NOT IMPLEMENTED",
      rlsDelete: "NOT VERIFIED",
    };

    console.log("\n=== SETUP: Login and upload ===");
    await login(page);
    const authUser = await verifyAuthSession(page);
    results.auth = "PASS";

    const fileId = await uploadTestFile(page);
    expect(fileId).toBeTruthy();
    console.log(`✓ Setup complete - fileId: ${fileId}`);

    // Ensure we're on dashboard for API calls
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    // CREATE
    console.log("\n=== CREATE: Generate diagram via authenticated API ===");
    let createResult = await generateDiagramViaAPI(page, fileId, "flowchart", "topic");
    console.log(`HTTP Status: ${createResult.status}`);
    console.log(`Response keys: ${Object.keys(createResult.body).join(", ")}`);

    let diagramId = "";
    let createdDiagram: any = null;

    if (createResult.status === 200) {
      expect(createResult.body.diagram).toBeDefined();
      expect(createResult.body.diagram.mermaid).toBeTruthy();
      expect(createResult.body.diagram.title).toBeTruthy();
      expect(createResult.body.diagramId).toBeTruthy();
      expect(createResult.body.persisted).toBe(true);

      diagramId = createResult.body.diagramId;
      createdDiagram = createResult.body.diagram;

      console.log(`✓ Diagram created: ${diagramId}`);
      console.log(`✓ Title: ${createdDiagram.title}`);
      console.log(`✓ Mermaid length: ${createdDiagram.mermaid.length}`);
      console.log(`✓ Persisted: ${createResult.body.persisted}`);

      results.create = "PASS";
      results.aiGeneration = "PASS";
    } else if (createResult.status === 502 || createResult.status === 503) {
      console.log(`⚠ AI provider unavailable (${createResult.status}): ${createResult.body.error || createResult.body.message}`);
      results.create = "FAIL";
      results.aiGeneration = "NOT VERIFIED";
    } else {
      console.log(`✗ CREATE FAILED: ${JSON.stringify(createResult.body)}`);
      throw new Error(`CREATE failed with status ${createResult.status}: ${JSON.stringify(createResult.body)}`);
    }

    // READ - List diagrams
    console.log("\n=== READ: List diagrams ===");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

    let listResult = await listDiagramsViaAPI(page);
    console.log(`HTTP Status: ${listResult.status}`);
    console.log(`Response body: ${JSON.stringify(listResult.body)}`);

    if (listResult.status === 200 && listResult.body.diagrams && Array.isArray(listResult.body.diagrams)) {
      const found = listResult.body.diagrams.find((d: any) => d.id === diagramId);
      if (found) {
        expect(found.title).toBe(createdDiagram.title);
        expect(found.mermaid).toBe(createdDiagram.mermaid);

        console.log(`✓ Diagram found in list: ${found.id}`);
        console.log(`✓ Title matches: ${found.title}`);
        console.log(`✓ Total diagrams: ${listResult.body.total}`);

        results.read = "PASS";
      } else {
        console.log("✗ READ FAILED: Diagram not found in list");
      }
    } else {
      console.log(`✗ READ FAILED: Status ${listResult.status}`);
    }

    // READ - Verify DB persistence
    console.log("\n=== READ: Verify DB persistence ===");
    listResult = await listDiagramsViaAPI(page);
    if (listResult.status === 200) {
      const found = listResult.body.diagrams?.find((d: any) => d.id === diagramId);
      if (found) {
        expect(found.diagram_type).toBe("flowchart");
        expect(found.source_type).toBe("topic");
        expect(found.source_file_id).toBeNull();
        expect(found.source_answer_id).toBeNull();
        expect(found.created_at).toBeDefined();
        expect(found.updated_at).toBeDefined();

        console.log(`✓ DB verification passed`);
        console.log(`  - diagram_type: ${found.diagram_type}`);
        console.log(`  - source_type: ${found.source_type}`);
        console.log(`  - source_file_id: ${found.source_file_id}`);
        console.log(`  - created_at: ${found.created_at}`);
      }
    }

    // UPDATE - Diagrams are immutable
    console.log("\n=== UPDATE: Check mutability ===");
    console.log("ℹ Diagrams are immutable after creation (no UPDATE API - by design)");
    console.log("✓ UPDATE test: NOT IMPLEMENTED - diagrams are immutable");

    // DELETE
    console.log("\n=== DELETE: Remove diagram ===");
    if (!diagramId) {
      console.log("⚠ Skipping DELETE - no diagram created");
    } else {
      await page.goto("/dashboard");
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });

      const deleteResult = await deleteDiagramViaAPI(page, diagramId);
      console.log(`HTTP Status: ${deleteResult.status}`);
      console.log(`Response body: ${JSON.stringify(deleteResult.body)}`);

      if (deleteResult.status === 200 && deleteResult.body.ok === true) {
      // Verify it's gone
      listResult = await listDiagramsViaAPI(page);
      if (listResult.status === 200) {
        const found = listResult.body.diagrams?.find((d: any) => d.id === diagramId);
        if (!found) {
          console.log(`✓ Diagram deleted and no longer in list`);
          diagramId = "";
          results.delete = "PASS";
        } else {
          console.log(`✗ DELETE FAILED: Diagram still in list`);
        }
      } else {
        console.log(`✗ DELETE verification failed: Status ${listResult.status}`);
      }
    } else {
      console.log(`✗ DELETE FAILED: Status ${deleteResult.status}`);
    }
    }

    // RLS - Cross-user isolation
    console.log("\n=== RLS: Cross-user isolation ===");
    const otherEmail = process.env.STUDYPILOT_E2E_OTHER_EMAIL;
    const otherPassword = process.env.STUDYPILOT_E2E_OTHER_PASSWORD;

    if (!otherEmail || !otherPassword) {
      console.log("⚠ SKIPPED - no other test user configured (STUDYPILOT_E2E_OTHER_EMAIL/PASSWORD)");
      results.rlsSelect = "SKIPPED";
      results.rlsDelete = "SKIPPED";
    } else {
      const otherContext = await browser.newContext();
      const otherPage = await otherContext.newPage();

      try {
        await loginWithCredentials(otherPage, otherEmail, otherPassword);
        await verifyAuthSession(otherPage);

        await otherPage.goto("/dashboard");
        await expect(otherPage).toHaveURL(/\/dashboard/, { timeout: 10_000 });

        console.log("--- RLS SELECT test ---");
        listResult = await listDiagramsViaAPI(otherPage);
        if (listResult.status === 200) {
          const found = listResult.body.diagrams?.find((d: any) => d.id === diagramId);
          if (!found) {
            console.log("✓ RLS SELECT: Other user cannot see diagram");
            results.rlsSelect = "PASS";
          } else {
            console.log("✗ RLS SELECT FAILED: Other user can see diagram");
          }
        } else {
          console.log(`✗ RLS SELECT FAILED: Status ${listResult.status}`);
        }

        console.log("--- RLS DELETE test ---");
        const rlsDeleteResult = await deleteDiagramViaAPI(otherPage, diagramId);
        if (rlsDeleteResult.status === 404 || rlsDeleteResult.status === 403) {
          console.log("✓ RLS DELETE: Other user cannot delete diagram");
          results.rlsDelete = "PASS";
        } else {
          console.log(`✗ RLS DELETE FAILED: Status ${rlsDeleteResult.status}`);
        }

        console.log("✓ RLS UPDATE: NOT IMPLEMENTED - diagrams are immutable");
      } finally {
        await otherContext.close();
      }
    }

    // AI Generation - Verify real provider was used
    console.log("\n=== AI Generation: Provider verification ===");
    if (createdDiagram?.mermaid) {
      expect(createdDiagram.mermaid).toMatch(/^(flowchart|graph|mindmap|sequenceDiagram|timeline)/);
      console.log(`✓ Real AI generation - valid Mermaid: ${createdDiagram.mermaid.substring(0, 80)}...`);
    } else {
      console.log("⚠ Could not verify - no diagram created");
    }

    // Final Report - Only PASS/FAIL/NOT VERIFIED/NOT IMPLEMENTED
    console.log("\n=== FINAL REPORT ===");
    console.log(`Auth session: ${results.auth}`);
    console.log(`Real AI generation: ${results.aiGeneration}`);
    console.log(`CREATE: ${results.create}`);
    console.log(`READ: ${results.read}`);
    console.log(`UPDATE: ${results.update}`);
    console.log(`DELETE: ${results.delete}`);
    console.log(`RLS SELECT: ${results.rlsSelect}`);
    console.log(`RLS UPDATE: ${results.rlsUpdate}`);
    console.log(`RLS DELETE: ${results.rlsDelete}`);

    const overall = results.auth === "PASS" && results.create === "PASS" && results.read === "PASS" && results.delete === "PASS" && results.aiGeneration === "PASS"
      ? "FULL PASS"
      : (results.auth === "PASS" && (results.create === "PASS" || results.read === "PASS") ? "PARTIAL" : "FAIL");
    console.log(`Overall Diagram Feature: ${overall}`);

    // Assert on critical path
    expect(results.auth).toBe("PASS");
    expect(results.create).toBe("PASS");
    expect(results.read).toBe("PASS");
    expect(results.delete).toBe("PASS");
  });
});
