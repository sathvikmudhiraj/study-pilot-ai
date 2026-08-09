import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn() }));

vi.mock("@/backend/lib/auth", () => ({ requireUser: mocks.requireUser }));

import { POST } from "../route";

describe("AI ask request observability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue(null);
  });

  it("returns a validated request ID and does not log the raw prompt", async () => {
    const privatePrompt = "PRIVATE_STUDY_PROMPT_DO_NOT_LOG";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await POST(new Request("http://localhost/api/ai/ask", {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "req-ai-test" },
      body: JSON.stringify({ question: privatePrompt }),
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get("x-request-id")).toBe("req-ai-test");
    expect(logSpy.mock.calls.flat().join(" ")).not.toContain(privatePrompt);
    logSpy.mockRestore();
  });
});
