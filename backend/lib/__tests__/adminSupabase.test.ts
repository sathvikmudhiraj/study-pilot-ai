import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSupabaseEnv: vi.fn(),
  hasSupabaseEnv: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("../supabase/env", () => ({
  getSupabaseEnv: mocks.getSupabaseEnv,
  hasSupabaseEnv: mocks.hasSupabaseEnv,
}));

vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

import { createAdminSupabaseClient, getAdminSupabaseClient, hasAdminSupabaseEnv, resetAdminSupabaseClientForTests } from "../adminSupabase";

describe("Admin Supabase Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAdminSupabaseClientForTests();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
    mocks.getSupabaseEnv.mockReturnValue({ url: "https://test.supabase.co", anonKey: "test-anon-key" });
    mocks.hasSupabaseEnv.mockReturnValue(true);
    mocks.createClient.mockReturnValue({ from: vi.fn() });
  });

  it("creates a client with service role key", () => {
    const client = createAdminSupabaseClient();
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://test.supabase.co",
      "test-service-role-key",
      expect.objectContaining({
        auth: { autoRefreshToken: false, persistSession: false },
      })
    );
    expect(client).toBeDefined();
  });

  it("returns cached client on subsequent calls", () => {
    const client1 = createAdminSupabaseClient();
    const client2 = createAdminSupabaseClient();
    expect(client1).toBe(client2);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });

  it("getAdminSupabaseClient returns the same client", async () => {
    const client = await getAdminSupabaseClient();
    expect(client).toBeDefined();
  });

  it("hasAdminSupabaseEnv returns true when configured", () => {
    expect(hasAdminSupabaseEnv()).toBe(true);
  });

  it("hasAdminSupabaseEnv returns false when service role key missing", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(hasAdminSupabaseEnv()).toBe(false);
  });

  it("hasAdminSupabaseEnv returns false when supabase env missing", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    mocks.getSupabaseEnv.mockImplementation(() => {
      throw new Error("Supabase missing");
    });
    expect(hasAdminSupabaseEnv()).toBe(false);
  });

  it("throws when service role key is missing", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createAdminSupabaseClient()).toThrow("SUPABASE_SERVICE_ROLE_KEY is not configured");
  });
});
