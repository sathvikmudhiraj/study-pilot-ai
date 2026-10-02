import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { login, openLoginForm, requireE2EEnv } from "./helpers";

async function loginAs(page: Page, email: string, password: string) {
  const form = await openLoginForm(page);
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

test("cross-user diagram read, update, and delete are denied through API and user-scoped Supabase", async ({ page, browser }) => {
  requireE2EEnv();
  const otherEmail = process.env.STUDYPILOT_E2E_OTHER_EMAIL;
  const otherPassword = process.env.STUDYPILOT_E2E_OTHER_PASSWORD;
  test.skip(!otherEmail || !otherPassword, "Two isolated E2E users are required.");
  test.setTimeout(120_000);
  await login(page);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  let diagramId = "";
  try {
    await loginAs(otherPage, otherEmail!, otherPassword!);
    const created = await page.request.post("/api/ai/diagram", { data: { sourceType: "topic", diagramType: "flowchart", topic: "Lexical analysis converts source code into tokens before parsing." }, timeout: 60_000 });
    const createBody = await created.json();
    expect(created.ok(), JSON.stringify(createBody)).toBe(true);
    diagramId = createBody.diagramId;
    expect(diagramId).toMatch(/^[0-9a-f-]{36}$/i);

    const ownerList = await page.request.get("/api/diagrams");
    expect((await ownerList.json()).diagrams.some((item: { id: string }) => item.id === diagramId)).toBe(true);
    const otherList = await otherPage.request.get("/api/diagrams");
    expect((await otherList.json()).diagrams.some((item: { id: string }) => item.id === diagramId)).toBe(false);
    const otherDelete = await otherPage.request.delete(`/api/diagrams/${diagramId}`);
    expect(otherDelete.status()).toBe(404);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const scoped = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const signedIn = await scoped.auth.signInWithPassword({ email: otherEmail!, password: otherPassword! });
    expect(signedIn.error).toBeNull();
    const directRead = await scoped.from("diagrams").select("id").eq("id", diagramId);
    expect(directRead.data ?? []).toHaveLength(0);
    const directUpdate = await scoped.from("diagrams").update({ title: "Unauthorized edit" }).eq("id", diagramId).select("id");
    expect(directUpdate.data ?? []).toHaveLength(0);
    const directDelete = await scoped.from("diagrams").delete().eq("id", diagramId).select("id");
    expect(directDelete.data ?? []).toHaveLength(0);
    const ownerAfter = await page.request.get("/api/diagrams");
    expect((await ownerAfter.json()).diagrams.some((item: { id: string }) => item.id === diagramId)).toBe(true);
    console.log("[Security] cross-user diagram API and user-scoped Supabase denied; owner row intact");
  } finally {
    if (diagramId) {
      const deleted = await page.request.delete(`/api/diagrams/${diagramId}`);
      expect(deleted.ok(), await deleted.text()).toBe(true);
    }
    await otherContext.close();
  }
});

test("global conversation search never returns another user's messages", async ({ page, browser }) => {
  requireE2EEnv();
  const otherEmail = process.env.STUDYPILOT_E2E_OTHER_EMAIL;
  const otherPassword = process.env.STUDYPILOT_E2E_OTHER_PASSWORD;
  test.skip(!otherEmail || !otherPassword, "Two isolated E2E users are required.");
  await login(page);
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const marker = `private-search-${Date.now()}`;
  let conversationId = "";
  try {
    await loginAs(otherPage, otherEmail!, otherPassword!);
    const created = await page.request.post("/api/conversations", {
      data: { title: `${marker} owner conversation`, context_mode: "general" },
    });
    expect(created.ok(), await created.text()).toBe(true);
    conversationId = (await created.json() as { conversation: { id: string } }).conversation.id;
    const message = await page.request.post(`/api/conversations/${conversationId}/messages`, {
      data: {
        question: `${marker} confidential retrieval phrase`,
        answer: { short_answer: "Private study answer." },
      },
    });
    expect(message.ok(), await message.text()).toBe(true);

    const ownerSearch = await page.request.get(`/api/conversations/search?q=${encodeURIComponent(marker)}`);
    expect(ownerSearch.ok(), await ownerSearch.text()).toBe(true);
    expect((await ownerSearch.json() as { results: Array<{ conversation_id: string }> }).results.some((item) => item.conversation_id === conversationId)).toBe(true);

    const otherSearch = await otherPage.request.get(`/api/conversations/search?q=${encodeURIComponent(marker)}`);
    expect(otherSearch.ok(), await otherSearch.text()).toBe(true);
    expect((await otherSearch.json() as { results: Array<{ conversation_id: string }> }).results.some((item) => item.conversation_id === conversationId)).toBe(false);
  } finally {
    if (conversationId) await page.request.delete(`/api/conversations/${conversationId}`);
    await otherContext.close();
  }
});

test("admin role mutation persists, is audited, and cannot be performed by a student", async ({ page, browser }) => {
  requireE2EEnv();
  const adminEmail = process.env.STUDYPILOT_E2E_ADMIN_EMAIL;
  const adminPassword = process.env.STUDYPILOT_E2E_ADMIN_PASSWORD;
  const otherEmail = process.env.STUDYPILOT_E2E_OTHER_EMAIL;
  const otherPassword = process.env.STUDYPILOT_E2E_OTHER_PASSWORD;
  test.skip(!adminEmail || !adminPassword || !otherEmail || !otherPassword, "Dedicated admin and disposable student accounts are required.");
  test.setTimeout(120_000);
  await login(page);
  const otherContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const adminPage = await adminContext.newPage();
  let targetId = "";
  let promoted = false;
  try {
    await loginAs(otherPage, otherEmail!, otherPassword!);
    const target = await (await otherPage.request.get("/api/auth/me")).json();
    targetId = target.id;
    expect(target.role).toBe("student");
    await loginAs(adminPage, adminEmail!, adminPassword!);
    const admin = await (await adminPage.request.get("/api/auth/me")).json();
    expect(admin.role).toBe("admin");
    const route = `/api/admin/users/${targetId}/role`;
    expect((await page.request.patch(route, { data: { role: "admin" } })).status()).toBe(403);
    expect((await adminPage.request.patch(route, { data: { role: "trainer" } })).status()).toBe(400);
    expect((await adminPage.request.patch("/api/admin/users/00000000-0000-4000-8000-000000000000/role", { data: { role: "admin" } })).status()).toBe(404);
    expect((await adminPage.request.patch(`/api/admin/users/${admin.id}/role`, { data: { role: "student" } })).status()).toBe(403);

    const promotion = await adminPage.request.patch(route, { data: { role: "admin" } });
    expect(promotion.ok(), await promotion.text()).toBe(true);
    promoted = true;
    await otherPage.getByRole("button", { name: /sign out/i }).click();
    await loginAs(otherPage, otherEmail!, otherPassword!);
    expect((await (await otherPage.request.get("/api/auth/me")).json()).role).toBe("admin");
    const demotion = await adminPage.request.patch(route, { data: { role: "student" } });
    expect(demotion.ok(), await demotion.text()).toBe(true);
    promoted = false;
    await otherPage.getByRole("button", { name: /sign out/i }).click();
    await loginAs(otherPage, otherEmail!, otherPassword!);
    expect((await (await otherPage.request.get("/api/auth/me")).json()).role).toBe("student");

    const audits = await adminPage.request.get("/api/admin/audit-logs?action=user_role_change&limit=50");
    expect(audits.ok()).toBe(true);
    const logs = (await audits.json()).logs as Array<{ actorUserId: string; targetId: string; result: string; createdAt: string; metadata: { previousRole?: string; newRole?: string } }>;
    expect(logs.some((entry) => entry.actorUserId === admin.id && entry.targetId === targetId && entry.result === "success" && entry.metadata.previousRole === "student" && entry.metadata.newRole === "admin" && entry.createdAt)).toBe(true);
    expect(logs.some((entry) => entry.actorUserId === admin.id && entry.targetId === targetId && entry.result === "success" && entry.metadata.previousRole === "admin" && entry.metadata.newRole === "student" && entry.createdAt)).toBe(true);
    console.log("[Security] admin promotion/demotion persisted and audited; student, invalid role/ID, self-demotion denied");
  } finally {
    if (promoted && targetId) {
      const restored = await adminPage.request.patch(`/api/admin/users/${targetId}/role`, { data: { role: "student" } });
      expect(restored.ok(), `Could not restore disposable test user: ${restored.status()}`).toBe(true);
    }
    await otherContext.close();
    await adminContext.close();
  }
});
