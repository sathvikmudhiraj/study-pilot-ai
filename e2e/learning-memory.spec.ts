import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { e2eEnv, login, openLoginForm, requireE2EEnv } from "./helpers";

async function scopedClient(email: string, password: string) {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  expect(signedIn.error).toBeNull();
  return { client, userId: signedIn.data.user!.id };
}

async function cleanup(client: SupabaseClient, topicKey: string, quizId?: string, revisionPlanId?: string) {
  await client.from("learning_states").delete().eq("topic_key", topicKey);
  if (revisionPlanId) await client.from("revision_plans").delete().eq("id", revisionPlanId);
  if (quizId) await client.from("quizzes").delete().eq("id", quizId);
}

test("real quiz grading creates owner-only weak-topic evidence", async ({ page, browser }) => {
  test.setTimeout(120_000);
  requireE2EEnv();
  const otherEmail = process.env.STUDYPILOT_E2E_OTHER_EMAIL;
  const otherPassword = process.env.STUDYPILOT_E2E_OTHER_PASSWORD;
  test.skip(!otherEmail || !otherPassword, "Two isolated E2E users are required.");
  await login(page);
  const owner = await scopedClient(e2eEnv.email, e2eEnv.password);
  const topic = `Evidence Topic ${Date.now()}`;
  const topicKey = topic.toLocaleLowerCase();
  const quiz = await owner.client.from("quizzes").insert({
    user_id: owner.userId,
    quiz_title: "Evidence E2E Quiz",
    difficulty: "medium",
    language_code: "en",
    questions: [{ id: "q1", type: "mcq", topic, topic_id: topicKey, question: "Choose the correct answer.", options: ["Correct", "Incorrect"] }],
    answer_key: [{ id: "q1", type: "mcq", correct_index: 0 }],
  }).select("id").single();
  expect(quiz.error).toBeNull();
  const quizId = quiz.data!.id;
  const otherContext = await browser.newContext();
  try {
    const attempt = await page.request.post("/api/quiz/attempts", { data: { quizId, answers: [{ questionId: "q1", selectedAnswer: "1" }] } });
    expect(attempt.ok(), await attempt.text()).toBe(true);
    const body = await attempt.json();
    expect(body.learningMemory).toEqual(expect.arrayContaining([expect.objectContaining({ topic, status: "NEEDS_REVISION", incorrect_count: 1 })]));

    const ownerMemory = await page.request.get(`/api/learning-memory?topic=${encodeURIComponent(topic)}`);
    expect(ownerMemory.ok()).toBe(true);
    expect((await ownerMemory.json()).states).toEqual(expect.arrayContaining([expect.objectContaining({ topic, status: "NEEDS_REVISION" })]));

    const recommendation = await page.request.post("/api/ai/ask", { data: { question: "What am I weak in?", language: "en" } });
    expect(recommendation.ok(), await recommendation.text()).toBe(true);
    const recommendationBody = await recommendation.json();
    expect(recommendationBody.mode).toBe("learning_memory");
    expect(recommendationBody.chat.answer.short_answer).toContain(topic);
    expect(recommendationBody.chat.answer.short_answer).toContain("1 incorrect answer");

    const otherPage = await otherContext.newPage();
    const form = await openLoginForm(otherPage);
    await form.getByLabel("Email").fill(otherEmail!);
    await form.getByLabel("Password").fill(otherPassword!);
    await form.getByRole("button", { name: /^log in$/i }).click();
    await expect(otherPage).toHaveURL(/\/dashboard/);
    const foreignRead = await otherPage.request.get(`/api/learning-memory?topic=${encodeURIComponent(topic)}`);
    expect(foreignRead.ok()).toBe(true);
    expect((await foreignRead.json()).states).toEqual([]);
  } finally {
    await cleanup(owner.client, topicKey, quizId);
    await otherContext.close();
  }
});

test("revision state changes only after explicit completion", async ({ page }) => {
  requireE2EEnv();
  await login(page);
  const owner = await scopedClient(e2eEnv.email, e2eEnv.password);
  const topic = `Revision Evidence ${Date.now()}`;
  const topicKey = topic.toLocaleLowerCase();
  const plan = await owner.client.from("revision_plans").insert({
    user_id: owner.userId,
    title: "Evidence E2E Revision",
    important_topics: [topic],
    revise_first: [topic],
    pending_topics: [],
    daily_plan: [],
    plan: {},
  }).select("id, completion_status").single();
  expect(plan.error).toBeNull();
  const planId = plan.data!.id;
  try {
    expect(plan.data!.completion_status).toBe("pending");
    const before = await page.request.get(`/api/learning-memory?topic=${encodeURIComponent(topic)}`);
    expect((await before.json()).states).toEqual([]);

    const completed = await page.request.post(`/api/revision/${planId}/complete`);
    expect(completed.ok(), await completed.text()).toBe(true);
    const body = await completed.json();
    expect(body.plan.completion_status).toBe("completed");
    expect(body.learningMemory).toEqual(expect.arrayContaining([expect.objectContaining({ topic, revision_status: "completed" })]));
  } finally {
    await cleanup(owner.client, topicKey, undefined, planId);
  }
});

test("chat updates the active topic from explicit confusion without an AI provider", async ({ page }) => {
  requireE2EEnv();
  await login(page);
  const owner = await scopedClient(e2eEnv.email, e2eEnv.password);
  const topic = `Chat Evidence ${Date.now()}`;
  const topicKey = topic.toLocaleLowerCase();
  let conversationId = "";
  try {
    const created = await page.request.post("/api/conversations", {
      data: { title: "Learning memory E2E", context_mode: "general", study_state: { active_topic: topic, active_task: "explain" } },
    });
    expect(created.ok(), await created.text()).toBe(true);
    conversationId = (await created.json()).conversation.id;
    const response = await page.request.post("/api/ai/ask", {
      data: { question: "I still don't understand", conversationId, language: "en" },
    });
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json();
    expect(body.mode).toBe("learning_memory");
    expect(body.chat.answer.conversation_result).toMatchObject({
      kind: "learning_state_result",
      status: "completed",
      payload: { intent: "explicit_confusion", states: [expect.objectContaining({ topic, status: "NEEDS_REVISION" })] },
    });
    const messages = await page.request.get(`/api/conversations/${conversationId}/messages`);
    expect(messages.ok()).toBe(true);
    expect((await messages.json()).messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ answer: expect.objectContaining({ conversation_result: expect.objectContaining({ kind: "learning_state_result" }) }) }),
    ]));
  } finally {
    if (conversationId) await page.request.delete(`/api/conversations/${conversationId}`);
    await cleanup(owner.client, topicKey);
  }
});
