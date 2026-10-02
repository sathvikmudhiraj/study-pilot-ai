import { expect, test } from "@playwright/test";
import { login, requireE2EEnv } from "./helpers";

test("real NVIDIA image generation persists, renders, reloads, and cleans up", async ({ page }) => {
  test.skip(process.env.STUDYPILOT_REAL_IMAGE_E2E !== "1", "Set STUDYPILOT_REAL_IMAGE_E2E=1 for the provider-backed image test.");
  requireE2EEnv();
  await login(page);

  const conversationResponse = await page.request.post("/api/conversations", {
    data: { title: "Generated image E2E", context_mode: "general", language_code: "en" },
  });
  expect(conversationResponse.ok()).toBe(true);
  const conversation = await conversationResponse.json() as { conversation: { id: string } };
  const conversationId = conversation.conversation.id;
  let imageId = "";

  try {
    const generatedResponse = await page.request.post("/api/ai/image", {
      data: {
        prompt: "Generate an image for deadlock prevention",
        topic: "deadlock prevention in operating systems",
        conversationId,
        language: "en",
      },
      timeout: 180_000,
    });
    const payload = await generatedResponse.json() as {
      error?: string;
      image?: { id: string; url: string; mime_type: string };
      messageId?: string;
    };
    expect(generatedResponse.ok(), payload.error).toBe(true);
    expect(payload.messageId).toBeTruthy();
    expect(payload.image?.url).toBe(`/api/generated-images/${payload.image?.id}/content`);
    imageId = payload.image?.id ?? "";

    const content = await page.request.get(payload.image!.url);
    expect(content.ok()).toBe(true);
    expect(content.headers()["content-type"]).toMatch(/^image\/(?:jpeg|png|webp)$/);
    expect((await content.body()).byteLength).toBeGreaterThan(1_000);

    await page.goto(`/chat?conversationId=${encodeURIComponent(conversationId)}`);
    await expect(page.getByText("StudyPilot Image")).toBeVisible({ timeout: 30_000 });
    const image = page.getByRole("img", { name: /deadlock prevention/i });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);

    await page.reload();
    await expect(page.getByText("StudyPilot Image")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.getByRole("img", { name: /deadlock prevention/i }).evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  } finally {
    await page.request.delete(`/api/conversations/${conversationId}`);
    if (imageId) {
      const removedContent = await page.request.get(`/api/generated-images/${imageId}/content`);
      expect(removedContent.status()).toBe(404);
    }
  }
});
