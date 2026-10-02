import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

test("long history, global search, universal artifacts, and drafts persist", async ({ page }) => {
  test.setTimeout(180_000);
  requireE2EEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) test.skip(true, "Supabase service setup is required for isolated bulk fixtures.");

  await login(page);
  const me = await page.request.get("/api/auth/me");
  expect(me.ok(), await me.text()).toBe(true);
  const userId = (await me.json() as { id: string }).id;
  const admin = createClient(url!, serviceKey!, { auth: { persistSession: false, autoRefreshToken: false } });
  const marker = `persistence-${Date.now()}`;
  const now = Date.now();
  const conversations = Array.from({ length: 56 }, (_, index) => ({
    user_id: userId,
    title: index === 55 ? `${marker} hidden SLR conversation` : `${marker} conversation ${index + 1}`,
    pinned: index === 54,
    context_mode: "general",
    active_file_ids: [],
    active_note_ids: [],
    language_code: "en",
    study_state: index === 0 ? { active_topic: "SLR parsing", active_task: "viva_questions" } : {},
    created_at: new Date(now - index * 60_000).toISOString(),
    updated_at: new Date(now - index * 60_000).toISOString(),
  }));
  const inserted = await admin.from("conversations").insert(conversations).select("id, title");
  expect(inserted.error?.message ?? "").toBe("");
  const longConversation = inserted.data!.find((item) => item.title === `${marker} conversation 1`)!;
  const hiddenConversation = inserted.data!.find((item) => item.title.includes("hidden SLR"))!;

  const rows = Array.from({ length: 105 }, (_, index) => ({
    user_id: userId,
    conversation_id: longConversation.id,
    question: `${marker} history question ${index + 1}`,
    answer: { short_answer: `${marker} history answer ${index + 1}` },
    related_file_ids: [], related_note_ids: [], mode: "selected-context", status: "answered", language_code: "en",
    created_at: new Date(now + index * 1000).toISOString(),
  }));
  rows.push({
    user_id: userId, conversation_id: hiddenConversation.id,
    question: `${marker} SLR conflict evidence inside an unloaded conversation`,
    answer: { short_answer: "Shift reduce and reduce reduce conflicts." },
    related_file_ids: [], related_note_ids: [], mode: "selected-context", status: "answered", language_code: "en",
    created_at: new Date(now).toISOString(),
  });
  const messages = await admin.from("assistant_questions").insert(rows);
  expect(messages.error?.message ?? "").toBe("");

  const specialRows = [
    {
      question: `${marker} web search`,
      answer: { short_answer: "Cloud answer", conversation_result: { version: 1, kind: "web_search", status: "completed", payload: { query: "cloud", concise_answer: "Cloud computing provides shared resources.", searched_at: new Date().toISOString(), web_citations: [] } } },
    },
    {
      question: `${marker} deep research`,
      answer: { short_answer: "Research answer", conversation_result: { version: 1, kind: "deep_research", status: "completed", payload: { research_question: "SLR parsing", sub_queries: [], executive_summary: "SLR uses LR(0) items with FOLLOW sets.", key_findings: [], detailed_analysis: [], different_viewpoints: [], practical_conclusion: "Practice conflict detection.", research_limitations: [], sources: [], researched_at: new Date().toISOString() } } },
    },
    {
      question: `${marker} diagram`,
      answer: { short_answer: "OSI flow", conversation_result: { version: 1, kind: "diagram", status: "completed", payload: { diagram: { title: "OSI persistence diagram", diagram_type: "flowchart", source_type: "topic", mermaid: "flowchart TD\nA[Application]-->B[Transport]", explanation: "A compact OSI flow.", generated_at: new Date().toISOString() }, request: { diagramType: "flowchart", sourceType: "topic", topic: "OSI" }, sourceLabel: "OSI" } } },
    },
  ].map((item, index) => ({ ...item, user_id: userId, conversation_id: longConversation.id, related_file_ids: [], related_note_ids: [], mode: "voice_tool", status: "answered", language_code: "en", created_at: new Date(now + (110 + index) * 1000).toISOString() }));
  expect((await admin.from("assistant_questions").insert(specialRows)).error?.message ?? "").toBe("");

  try {
    await page.goto(`/chat?conversationId=${longConversation.id}`);
    await expect(page.getByText(`${marker} history answer 105`, { exact: true })).toBeVisible();
    await expect(page.getByText("Cloud computing provides shared resources.", { exact: true })).toBeVisible();
    await expect(page.getByText("SLR uses LR(0) items with FOLLOW sets.", { exact: true })).toBeVisible();
    await expect(page.getByText("OSI persistence diagram", { exact: true })).toBeVisible();
    await expect(page.getByText(`${marker} history answer 1`, { exact: true })).toHaveCount(0);
    await expect(page.getByText(`${marker} conversation 55`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${marker} conversation 31`, { exact: true })).toHaveCount(0);

    for (let pageIndex = 0; pageIndex < 5 && await page.getByText(`${marker} conversation 31`, { exact: true }).count() === 0; pageIndex += 1) {
      const loadOlder = page.getByRole("button", { name: "Load older chats" });
      await expect(loadOlder).toBeVisible();
      await loadOlder.click();
      await expect(loadOlder).toBeEnabled();
    }
    await expect(page.getByText(`${marker} conversation 31`, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Load earlier messages" }).click();
    await expect(page.getByText(`${marker} history answer 1`, { exact: true })).toBeVisible();
    await expect(page.getByText(`${marker} history answer 60`, { exact: true })).toHaveCount(1);

    const search = page.getByRole("searchbox", { name: "Search conversations" });
    await search.fill(`${marker} SLR conflict evidence`);
    await expect(page.getByText(`${marker} hidden SLR conversation`, { exact: true })).toBeVisible();
    await page.getByText(`${marker} hidden SLR conversation`, { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(hiddenConversation.id));
    await expect(page.getByText(/Shift reduce and reduce reduce conflicts/)).toBeVisible();

    await page.goto(`/chat?conversationId=${longConversation.id}`);
    const composer = page.getByPlaceholder(/Ask StudyPilot/);
    await composer.fill(`${marker} unsent independent draft`);
    await expect.poll(async () => {
      const savedDraftResponse = await page.request.get(`/api/conversations/${longConversation.id}`);
      return (await savedDraftResponse.json() as { conversation: { draft_text: string } }).conversation.draft_text;
    }).toBe(`${marker} unsent independent draft`);
    await page.reload();
    await expect(composer).toHaveValue(`${marker} unsent independent draft`);

    const current = await page.request.get(`/api/conversations/${longConversation.id}`);
    const currentConversation = (await current.json() as { conversation: { draft_version: number } }).conversation;
    const stale = await page.request.patch(`/api/conversations/${longConversation.id}/draft`, { data: { draft: "stale overwrite", version: Math.max(0, currentConversation.draft_version - 1) } });
    expect(stale.status()).toBe(409);
    await page.reload();
    await expect(composer).toHaveValue(`${marker} unsent independent draft`);

    await page.goto(`/voice?conversationId=${longConversation.id}`);
    await expect(page.getByText("Cloud computing provides shared resources.", { exact: true })).toBeVisible();
    await expect(page.getByText("SLR uses LR(0) items with FOLLOW sets.", { exact: true })).toBeVisible();
    await expect(page.getByText("OSI persistence diagram", { exact: true })).toBeVisible();
  } finally {
    await admin.from("conversations").delete().like("title", `${marker}%`).eq("user_id", userId);
  }
});
