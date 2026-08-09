import { describe, expect, it } from "vitest";
import { GET } from "../route";

describe("Liveness Health Endpoint", () => {
  it("returns 200 with status ok", async () => {
    const response = await GET(new Request("http://localhost/api/health/live", {
      headers: { "x-request-id": "req-live-test" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-live-test");
    
    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
    expect(JSON.stringify(body)).not.toMatch(/key|secret|token/i);
  });
});
