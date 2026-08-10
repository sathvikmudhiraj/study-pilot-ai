import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminSupabaseClient: vi.fn(),
}));

vi.mock("@/backend/lib/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/backend/lib/adminSupabase", () => ({ createAdminSupabaseClient: mocks.createAdminSupabaseClient }));

import { GET } from "../route";

describe("admin files API authorization", () => {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    then: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "admin-1", name: "Admin", role: "admin" } });
    mocks.createAdminSupabaseClient.mockReturnValue({
      from: vi.fn().mockReturnValue(mockChain),
    });
    mockChain.select.mockReturnValue(mockChain);
    mockChain.eq.mockReturnValue(mockChain);
    mockChain.ilike.mockReturnValue(mockChain);
    mockChain.order.mockReturnValue(mockChain);
    mockChain.range.mockReturnValue(mockChain);
    mockChain.then.mockImplementation((resolve) =>
      Promise.resolve(
        resolve({
          data: [
            {
              id: "file-1",
              created_at: "2024-01-01T00:00:00Z",
              file_name: "test.pdf",
              file_type: "pdf",
              file_size: 1024,
              mime_type: "application/pdf",
              processing_status: "completed",
              chunks_count: 5,
              user_id: "user-123",
            },
          ],
          error: null,
          count: 1,
        })
      )
    );
  });

  it("returns 401 before creating privileged access", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 401, message: "Please log in first." });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.createAdminSupabaseClient).not.toHaveBeenCalled();
  });

  it("returns 403 to students", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, status: 403, message: "Admin access required." });
    const response = await GET();
    expect(response.status).toBe(403);
  });

  it("returns paginated file metadata to admin", async () => {
    const response = await GET(new Request("http://localhost/api/admin/files?page=1&limit=50", { headers: { "x-request-id": "req-files-test" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-files-test");

    const body = await response.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0]).toMatchObject({
      id: "file-1",
      fileName: "test.pdf",
      fileType: "pdf",
      fileSize: 1024,
      processingStatus: "completed",
      chunksCount: 5,
      userRef: "user-123…",
    });
    expect(body.files[0]).not.toHaveProperty("extracted_text");
    expect(body.files[0]).not.toHaveProperty("storage_path");
    expect(body.pagination.total).toBe(1);
  });

  it("supports status filter", async () => {
    await GET(new Request("http://localhost/api/admin/files?status=completed"));
    expect(mockChain.eq).toHaveBeenCalledWith("processing_status", "completed");
  });

  it("supports search filter", async () => {
    await GET(new Request("http://localhost/api/admin/files?search=test"));
    expect(mockChain.ilike).toHaveBeenCalledWith("file_name", "%test%");
  });

  it("handles database error gracefully", async () => {
    mockChain.then.mockImplementation((resolve) =>
      Promise.resolve(resolve({ data: null, error: { message: "DB error" }, count: 0 }))
    );
    const response = await GET();
    expect(response.status).toBe(503);
  });
});