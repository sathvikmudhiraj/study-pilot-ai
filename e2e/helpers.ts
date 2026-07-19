import { expect, type Page, test } from "@playwright/test";

export const e2eEnv = {
  email: process.env.STUDYPILOT_E2E_EMAIL ?? "",
  password: process.env.STUDYPILOT_E2E_PASSWORD ?? "",
};

export function requireE2EEnv() {
  test.skip(
    !e2eEnv.email || !e2eEnv.password,
    "Set STUDYPILOT_E2E_EMAIL and STUDYPILOT_E2E_PASSWORD for isolated E2E data. Tests never use personal production data by default.",
  );
}

export async function login(page: Page) {
  requireE2EEnv();
  await page.goto("/auth?mode=login");
  await page.getByLabel("Email").fill(e2eEnv.email);
  await page.getByLabel("Password").fill(e2eEnv.password);
  await page.locator("form").getByRole("button", { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard|\/auth/);
  await expect(page.getByText(/StudyPilot AI|Dashboard|Welcome/i)).toBeVisible();
}

export async function logout(page: Page) {
  await page.goto("/auth");
  const signOut = page.getByRole("button", { name: /sign out/i });
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click();
    await expect(page).toHaveURL(/\/$/);
  }
}

export async function stubAI(page: Page) {
  await page.route("**/api/ai/summarize", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          suggested_title: "Networking Chapter",
          short_summary: "Networking covers routing, subnetting, TCP, and UDP.",
          key_points: ["Routing connects networks.", "Subnetting is a weak-topic practice target."],
          important_concepts: ["Routing", "Subnetting", "TCP"],
          covered_topics: ["Routing", "Subnetting", "Transport protocols"],
          topic_wise_summary: [
            { topic: "Routing", explanation: "Routers forward packets.", important_points: ["Use routing tables."] },
            { topic: "Subnetting", explanation: "Networks are divided with prefixes.", important_points: ["CIDR controls range size."] },
          ],
          suggested_tags: ["networking"],
          suggested_next_step: "Take a balanced quiz.",
          source_citations: [],
          generation_metadata: {
            attemptedChunks: 2,
            successfulChunks: [1, 2],
            failedChunks: [],
            failureCategories: [],
            partialCoverage: false,
            sourceTextLength: 900,
          },
        },
        regenerationSucceeded: true,
        staleSummary: false,
        partialCoverage: false,
      }),
    });
  });

  await page.route("**/api/quiz", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        quiz: {
          id: "e2e-quiz",
          title: "Networking Quiz",
          difficulty: "medium",
          questions: [
            {
              id: "q1",
              type: "mcq",
              topic: "Subnetting",
              question: "What does CIDR notation describe?",
              options: ["Prefix length", "MAC address", "Port number"],
              explanation: "CIDR notation describes the network prefix length.",
            },
          ],
          source_summary: "Balanced chapter quiz with weak-topic emphasis.",
        },
      }),
    });
  });

  await page.route("**/api/quiz/attempts", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        attempt: { id: "e2e-attempt", percentage: 0, weak_topics: ["Subnetting"], strong_topics: [] },
        analytics: { weakTopics: ["Subnetting"], strongTopics: [], lastQuizScore: { percentage: 0 } },
        learnerProfile: { weakTopics: [{ topic: "Subnetting", accuracy: 0, misses: 1 }], strongTopics: [] },
        revisionRecommendations: [{ topic: "Subnetting", reason: "Recent quiz miss" }],
      }),
    });
  });

  await page.route("**/api/revision", async (route) => {
    if (route.request().method() === "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: {
          title: "Networking Revision Plan",
          important_topics: ["Routing", "Subnetting", "TCP", "UDP"],
          revise_first: ["Subnetting", "Routing"],
          pending_topics: ["TCP", "UDP"],
          daily_plan: [{ day: 1, focus_topics: ["Subnetting", "Routing"], tasks: ["Revise full chapter", "Practice weak topic"], estimated_time: "45 minutes" }],
        },
      }),
    });
  });

  await page.route("**/api/ai/ask", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chat: {
          id: "e2e-chat",
          question: "Explain subnetting",
          answer: {
            short_answer: "Subnetting divides a network into smaller ranges.",
            simple_explanation: "Use the prefix length to determine network size.",
            step_by_step: ["Identify prefix.", "Calculate host bits."],
            example: "192.168.1.0/24",
            memory_line: "Prefix decides range.",
            common_mistake: "Confusing host bits and network bits.",
            exam_viva_answer: "Subnetting improves address planning.",
            practice_question: "What does /24 mean?",
            related_files_notes: ["Networking notes"],
            next_step: "Try a weak-topic lesson.",
            learning_step: {
              current_step: 1,
              total_steps: 7,
              step_title: "Topic introduction",
              session_status: "active",
              expects_answer: false,
              feedback: null,
            },
          },
          related_file_ids: [],
          related_note_ids: [],
          created_at: new Date().toISOString(),
        },
        related: [],
        mode: "selected-context",
      }),
    });
  });
}
