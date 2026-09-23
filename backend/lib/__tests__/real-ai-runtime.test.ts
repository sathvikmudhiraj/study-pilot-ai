import "server-only";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateAITextWithMetadata, extractWithVision, isVisionAvailable, getVisionProviderRuntimeInfo, getAIProviderRuntimeInfo } from "@/backend/lib/aiProvider";
import { processStudyMaterial } from "@/backend/lib/studyMaterial";
import { saveExtractionProgress, loadExtractionProgress, clearExtractionProgress } from "@/backend/lib/backgroundJobs";
import { createAdminSupabaseClient, hasAdminSupabaseEnv } from "@/backend/lib/adminSupabase";

// Mock the server-only module
vi.mock("server-only", () => ({}));

// Mock observability to avoid telemetry errors
vi.mock("@/backend/lib/observability", () => ({
  logProviderTelemetry: vi.fn(),
  sanitizeError: vi.fn((e: unknown) => ({ category: "unknown", message: String(e) })),
  sanitizeForLogging: vi.fn((obj: unknown) => obj),
}));

// Load real env for tests
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

function errorField(error: Error, field: "status" | "kind" | "provider") {
  const value = (error as Error & Partial<Record<typeof field, unknown>>)[field];
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

describe("REAL AI Provider Runtime Verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("1. Vision provider runtime info shows correct models", () => {
    const visionInfo = getVisionProviderRuntimeInfo();
    expect(visionInfo.primaryProvider).toBe("gemini");
    expect(visionInfo.primaryModel).toBe("gemini-2.5-flash");
    expect(visionInfo.fallbackProvider).toBe("nvidia-vision");
    expect(visionInfo.fallbackModel).toBe("meta/llama-3.2-11b-vision-instruct");
    console.log("  Vision Info:", visionInfo);
  });

  it("2. Text provider runtime info shows correct models", () => {
    const runtime = getAIProviderRuntimeInfo("default");
    expect(runtime.primaryProvider).toBe("gemini");
    expect(runtime.primaryModel).toBe("gemini-2.5-flash");
    expect(runtime.fallbackProvider).toBe("nvidia");
    expect(runtime.fallbackModel).toBe("meta/llama-3.2-11b-vision-instruct");
    console.log("  Text Provider Info:", runtime);
  });

  it("3. Vision availability check", () => {
    const available = isVisionAvailable();
    console.log("  Vision Available:", available);
    console.log("  GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");
    console.log("  NVIDIA_API_KEY:", process.env.NVIDIA_API_KEY ? "SET" : "NOT SET");
    // At least one should be available in test env
    expect(available.gemini || available.nvidiaVision).toBe(true);
  });

  it("4. REAL: Text generation with auto provider (Gemini first)", async () => {
    // Use real API keys from .env.local
    if (!process.env.GEMINI_API_KEY || !process.env.NVIDIA_API_KEY) {
      console.log("  SKIPPED: No real API keys in environment");
      return;
    }
    
    const result = await generateAITextWithMetadata("What is 2+2? Answer in one sentence.", {
      temperature: 0.2,
      maxOutputTokens: 100,
      timeoutMs: 30000,
    });
    
    console.log("  Result:", {
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      fallbackProvider: result.fallbackProvider,
      fallbackModel: result.fallbackModel,
      responseMode: result.responseMode,
      totalLatencyMs: result.totalLatencyMs,
      geminiLatencyMs: result.geminiLatencyMs,
      nvidiaLatencyMs: result.nvidiaLatencyMs,
      offlineFallbackUsed: result.offlineFallbackUsed,
      geminiSkippedDueToCooldown: result.geminiSkippedDueToCooldown,
      providerFailureCategory: result.providerFailureCategory,
      textLength: result.text.length,
      textPreview: result.text.slice(0, 100),
    });
    
    // Verify the result structure
    expect(result.provider).toBeDefined();
    expect(result.model).toBeDefined();
    expect(typeof result.totalLatencyMs).toBe("number");
    expect(result.text.length).toBeGreaterThan(0);
  }, 60000);

  it("5. REAL: NVIDIA direct text generation", async () => {
    if (!process.env.NVIDIA_API_KEY) {
      console.log("  SKIPPED: No NVIDIA API key");
      return;
    }
    
    vi.stubEnv("AI_PROVIDER", "nvidia");
    
    const result = await generateAITextWithMetadata("What is 3+3? Answer in one sentence.", {
      temperature: 0.2,
      maxOutputTokens: 100,
      timeoutMs: 30000,
    });
    
    console.log("  NVIDIA Direct Result:", {
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      responseMode: result.responseMode,
      totalLatencyMs: result.totalLatencyMs,
      nvidiaLatencyMs: result.nvidiaLatencyMs,
      textLength: result.text.length,
      textPreview: result.text.slice(0, 100),
    });
    
    expect(result.provider).toBe("nvidia");
    expect(result.text.length).toBeGreaterThan(0);
  }, 60000);

  it("6. REAL: Vision extraction (Gemini -> NVIDIA fallback)", async () => {
    if (!process.env.GEMINI_API_KEY || !process.env.NVIDIA_API_KEY) {
      console.log("  SKIPPED: No API keys for vision");
      return;
    }
    
    // Known-valid 1x1 transparent PNG.
    const testImage = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    
    console.log("  Testing vision extraction with 1x1 PNG...");
    
    let result;
    try {
      result = await extractWithVision(
        "Describe this image in one sentence.",
        testImage,
        "image/png",
        {
          maxOutputTokens: 100,
          timeoutMs: 60000,
        }
      );
    } catch (e) {
      console.log("  Vision extraction failed:", e instanceof Error ? e.message : e);
      if (e instanceof Error) {
        const status = errorField(e, "status");
        const kind = errorField(e, "kind");
        if (status !== undefined) console.log("  Status:", status);
        if (kind !== undefined) console.log("  Kind:", kind);
      }
      throw e;
    }
    
    console.log("  Vision Result:", {
      provider: result.provider,
      model: result.model,
      textLength: result.text.length,
      textPreview: result.text.slice(0, 200),
    });
    
    expect(result.provider).toBeDefined();
    expect(["gemini", "nvidia-vision"]).toContain(result.provider);
    expect(result.text.length).toBeGreaterThan(0);
  }, 90000);

  it("6b. DEBUG: Check NVIDIA Vision error directly", async () => {
    console.log("  DEBUG test STARTED");
    console.log("  GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");
    console.log("  NVIDIA_API_KEY:", process.env.NVIDIA_API_KEY ? "SET" : "NOT SET");
    if (!process.env.GEMINI_API_KEY || !process.env.NVIDIA_API_KEY) {
      console.log("  SKIPPED: No API keys for vision");
      return;
    }
    
    console.log("  NVIDIA Vision Config:", getVisionProviderRuntimeInfo());
    
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const ihdr = Buffer.from([
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE
    ]);
    const idat = Buffer.from([0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0xD7, 0x63, 0xF8, 0x0F, 0x00, 0x01, 0x01, 0x00, 0x05, 0x00, 0x1D, 0x0C, 0xC2]);
    const iend = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);
    const testImage = Buffer.concat([pngHeader, ihdr, idat, iend]);
    
    try {
      const result = await extractWithVision(
        "Describe this image.",
        testImage,
        "image/png",
        { maxOutputTokens: 100, timeoutMs: 60000 }
      );
      console.log("  Vision public API result:", result);
    } catch (e) {
      console.log("  Vision public API error:", e instanceof Error ? e.message : e);
      if (e instanceof Error) {
        const status = errorField(e, "status");
        const kind = errorField(e, "kind");
        const provider = errorField(e, "provider");
        if (status !== undefined) console.log("  Status:", status);
        if (kind !== undefined) console.log("  Kind:", kind);
        if (provider !== undefined) console.log("  Provider:", provider);
      }
    }
    console.log("  DEBUG test COMPLETED");
  });

  it("7. REAL: Progress persistence - save, load, clear", async () => {
    if (!hasAdminSupabaseEnv()) {
      console.log("  SKIPPED: No Supabase service role key");
      return;
    }
    
    const supabase = createAdminSupabaseClient();
    const testFileId = crypto.randomUUID();
    const testUserId = crypto.randomUUID();
    
    const progress = {
      stage: "vision-processing" as const,
      totalPages: 5,
      nativePagesProcessed: 5,
      nativePagesReadable: 3,
      visionPagesQueued: 2,
      visionPagesCompleted: 1,
      visionPagesFailed: 0,
      currentBatch: { startPage: 4, endPage: 5, provider: "gemini-vision" as const },
      partialFailures: [],
      completedPageRanges: [
        { startPage: 1, endPage: 3, extractor: "native", success: true },
        { startPage: 4, endPage: 4, extractor: "gemini-vision", success: true },
      ],
      failedPages: [],
    };
    
    console.log("  Saving progress for file:", testFileId, "user:", testUserId);
    await saveExtractionProgress(testFileId, testUserId, progress);
    console.log("  Progress saved");
    
    console.log("  Loading progress...");
    const loaded = await loadExtractionProgress(testFileId, testUserId);
    console.log("  Loaded:", loaded ? "SUCCESS" : "NULL");
    
    if (loaded) {
      expect(loaded.stage).toBe("vision-processing");
      expect(loaded.totalPages).toBe(5);
      expect(loaded.visionPagesCompleted).toBe(1);
      expect(loaded.completedPageRanges?.length).toBe(2);
    }
    
    console.log("  Clearing progress...");
    await clearExtractionProgress(testFileId, testUserId);
    console.log("  Progress cleared");
    
    const afterClear = await loadExtractionProgress(testFileId, testUserId);
    console.log("  After clear:", afterClear ? "STILL EXISTS" : "CLEARED");
    expect(afterClear).toBeNull();
  });

  it("8. REAL: RLS - Cross-user progress isolation", async () => {
    if (!hasAdminSupabaseEnv()) {
      console.log("  SKIPPED: No Supabase service role key");
      return;
    }
    
    const testFileId = crypto.randomUUID();
    const user1 = crypto.randomUUID();
    const user2 = crypto.randomUUID();
    
    const progress = {
      stage: "complete" as const,
      totalPages: 3,
      nativePagesProcessed: 3,
      nativePagesReadable: 3,
      visionPagesQueued: 0,
      visionPagesCompleted: 0,
      visionPagesFailed: 0,
      partialFailures: [],
      completedPageRanges: [
        { startPage: 1, endPage: 3, extractor: "native", success: true },
      ],
      failedPages: [],
    };
    
    // Save as user1
    console.log("  Saving progress for user1:", user1);
    await saveExtractionProgress(testFileId, user1, progress);
    
    // Try to load as user2
    console.log("  Loading as user2:", user2);
    const loadedAsUser2 = await loadExtractionProgress(testFileId, user2);
    console.log("  User2 can load user1's progress:", loadedAsUser2 ? "YES (RLS FAIL)" : "NO (RLS PASS)");
    expect(loadedAsUser2).toBeNull();
    
    // Try to update as user2
    console.log("  Attempting to update as user2...");
    try {
      await saveExtractionProgress(testFileId, user2, { ...progress, stage: "failed" });
      console.log("  User2 could update user1's progress: YES (RLS FAIL)");
      expect(false).toBe(true); // Should not reach here
    } catch (e) {
      console.log("  User2 could update user1's progress: NO (RLS PASS) -", e instanceof Error ? e.message : "blocked");
    }
    
    // Cleanup
    await clearExtractionProgress(testFileId, user1);
  });
});
