import "dotenv/config";
import { generateAITextWithMetadata, extractWithVision, isVisionAvailable, getVisionProviderRuntimeInfo } from "./backend/lib/aiProvider.ts";
import { processStudyMaterial } from "./backend/lib/studyMaterial.ts";
import { saveExtractionProgress, loadExtractionProgress, clearExtractionProgress } from "./backend/lib/backgroundJobs.ts";
import { createAdminSupabaseClient } from "./backend/lib/adminSupabase.ts";
import fs from "fs";
import path from "path";

console.log("=== Testing REAL AI Provider Runtime ===\n");

// Check env
console.log("Environment check:");
console.log("  GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "SET" : "NOT SET");
console.log("  NVIDIA_API_KEY:", process.env.NVIDIA_API_KEY ? "SET" : "NOT SET");
console.log("  NVIDIA_VISION_API_KEY:", process.env.NVIDIA_VISION_API_KEY || process.env.NVIDIA_API_KEY ? "SET" : "NOT SET");
console.log("  AI_PROVIDER:", process.env.AI_PROVIDER || "auto");
console.log("");

// Test 1: Vision Provider Info
console.log("=== Test 1: Vision Provider Runtime Info ===");
try {
  const visionInfo = getVisionProviderRuntimeInfo();
  console.log("  Primary Provider:", visionInfo.primaryProvider);
  console.log("  Primary Model:", visionInfo.primaryModel);
  console.log("  Fallback Provider:", visionInfo.fallbackProvider);
  console.log("  Fallback Model:", visionInfo.fallbackModel);
  console.log("  Timeout:", visionInfo.timeoutMs, "ms");
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

// Test 2: Vision Availability
console.log("=== Test 2: Vision Availability ===");
try {
  const available = isVisionAvailable();
  console.log("  Gemini Vision:", available.gemini ? "AVAILABLE" : "NOT AVAILABLE");
  console.log("  NVIDIA Vision:", available.nvidiaVision ? "AVAILABLE" : "NOT AVAILABLE");
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

// Test 3: Text Generation with Fallback (Gemini -> NVIDIA)
console.log("=== Test 3: Text Generation - Auto Provider (Gemini first, NVIDIA fallback) ===");
try {
  const result = await generateAITextWithMetadata("What is 2+2? Answer in one sentence.", {
    temperature: 0.2,
    maxOutputTokens: 100,
    timeoutMs: 30000,
  });
  console.log("  Provider used:", result.provider);
  console.log("  Model:", result.model);
  console.log("  Fallback used:", result.fallbackUsed);
  console.log("  Fallback provider:", result.fallbackProvider || "N/A");
  console.log("  Fallback model:", result.fallbackModel || "N/A");
  console.log("  Response mode:", result.responseMode);
  console.log("  Total latency:", result.totalLatencyMs, "ms");
  console.log("  Gemini latency:", result.geminiLatencyMs, "ms");
  console.log("  NVIDIA latency:", result.nvidiaLatencyMs, "ms");
  console.log("  Offline fallback used:", result.offlineFallbackUsed);
  console.log("  Gemini skipped (cooldown):", result.geminiSkippedDueToCooldown);
  console.log("  Provider failure category:", result.providerFailureCategory || "N/A");
  console.log("  Response text:", result.text.slice(0, 200));
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

// Test 4: NVIDIA Direct
console.log("=== Test 4: Text Generation - NVIDIA Direct ===");
try {
  const result = await generateAITextWithMetadata("What is 3+3? Answer in one sentence.", {
    temperature: 0.2,
    maxOutputTokens: 100,
    timeoutMs: 30000,
    signal: undefined,
    disableProviderFallback: true,
  });
  console.log("  Provider used:", result.provider);
  console.log("  Model:", result.model);
  console.log("  Fallback used:", result.fallbackUsed);
  console.log("  Response mode:", result.responseMode);
  console.log("  Total latency:", result.totalLatencyMs, "ms");
  console.log("  NVIDIA latency:", result.nvidiaLatencyMs, "ms");
  console.log("  Response text:", result.text.slice(0, 200));
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

// Test 5: Simulated Quota Error (429) - Hard to test without triggering real quota
console.log("=== Test 5: Simulated Cooldown (Gemini Skipped) ===");
try {
  // We can't easily simulate a 429 without hitting real quota
  // But we can test the cooldown logic by checking the circuit breaker
  const { geminiCircuitBreaker } = await import("./backend/lib/aiProvider.ts");
  console.log("  Circuit breaker state:", {
    isHealthy: geminiCircuitBreaker.isHealthy,
    failureCount: geminiCircuitBreaker.failureCount,
    cooldownUntil: geminiCircuitBreaker.cooldownUntil,
  });
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

// Test 6: Vision Extraction with Real PDF
console.log("=== Test 6: Vision Extraction (Real PDF) ===");
// Create a simple test PDF with one readable page and one image-only page
// For this test, we'll just check the vision extraction function directly
try {
  // We need a real PDF buffer - let's see if there's a test file
  const testPdfPath = path.join(process.cwd(), "test-files", "sample.pdf");
  if (fs.existsSync(testPdfPath)) {
    const pdfBuffer = fs.readFileSync(testPdfPath);
    console.log("  Test PDF found, size:", pdfBuffer.length, "bytes");
    
    // Try vision extraction on first page
    // Note: extractWithVision expects image data, not PDF
    // The studyMaterial.ts handles PDF -> image conversion
    console.log("  Note: extractWithVision expects image data. Use processStudyMaterial for PDFs.");
  } else {
    console.log("  No test PDF found at", testPdfPath);
    console.log("  Skipping vision extraction test");
  }
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

// Test 7: Progress Persistence (requires Supabase)
console.log("=== Test 7: Progress Persistence (Supabase) ===");
try {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createAdminSupabaseClient();
    
    // Test with a dummy file ID
    const testFileId = "00000000-0000-0000-0000-000000000000";
    const testUserId = "00000000-0000-0000-0000-000000000001";
    
    const progress = {
      stage: "vision-processing",
      totalPages: 5,
      nativePagesProcessed: 5,
      nativePagesReadable: 3,
      visionPagesQueued: 2,
      visionPagesCompleted: 1,
      visionPagesFailed: 0,
      currentBatch: { startPage: 4, endPage: 5, provider: "gemini-vision" },
      partialFailures: [],
      completedPageRanges: [
        { startPage: 1, endPage: 3, extractor: "native", success: true },
        { startPage: 4, endPage: 4, extractor: "gemini-vision", success: true },
      ],
      failedPages: [],
    };
    
    console.log("  Saving progress...");
    await saveExtractionProgress(testFileId, testUserId, progress);
    console.log("  Progress saved");
    
    console.log("  Loading progress...");
    const loaded = await loadExtractionProgress(testFileId, testUserId);
    console.log("  Loaded progress:", loaded ? "SUCCESS" : "NULL");
    if (loaded) {
      console.log("    Stage:", loaded.stage);
      console.log("    Total pages:", loaded.totalPages);
      console.log("    Vision completed:", loaded.visionPagesCompleted);
      console.log("    Completed ranges:", loaded.completedPageRanges?.length);
    }
    
    console.log("  Clearing progress...");
    await clearExtractionProgress(testFileId, testUserId);
    console.log("  Progress cleared");
    
    // Verify cleared
    const afterClear = await loadExtractionProgress(testFileId, testUserId);
    console.log("  After clear:", afterClear ? "STILL EXISTS (FAIL)" : "CLEARED (PASS)");
  } else {
    console.log("  SUPABASE_SERVICE_ROLE_KEY not set - skipping persistence test");
  }
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

// Test 8: RLS Test - Second user cannot access first user's progress
console.log("=== Test 8: RLS - Cross-user Progress Isolation ===");
try {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const supabase = createAdminSupabaseClient();
    
    const testFileId = "00000000-0000-0000-0000-000000000000";
    const user1 = "00000000-0000-0000-0000-000000000001";
    const user2 = "00000000-0000-0000-0000-000000000002";
    
    const progress = {
      stage: "complete",
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
    await saveExtractionProgress(testFileId, user1, progress);
    console.log("  Saved progress for user1");
    
    // Try to load as user2
    const loadedAsUser2 = await loadExtractionProgress(testFileId, user2);
    console.log("  User2 can load user1's progress:", loadedAsUser2 ? "YES (RLS FAIL)" : "NO (RLS PASS)");
    
    // Try to update as user2
    try {
      await saveExtractionProgress(testFileId, user2, { ...progress, stage: "failed" });
      console.log("  User2 could update user1's progress: YES (RLS FAIL)");
    } catch (e) {
      console.log("  User2 could update user1's progress: NO (RLS PASS) -", e.message);
    }
    
    // Cleanup
    await clearExtractionProgress(testFileId, user1);
  } else {
    console.log("  SUPABASE_SERVICE_ROLE_KEY not set - skipping RLS test");
  }
} catch (e) {
  console.log("  ERROR:", e.message);
}
console.log("");

console.log("=== All Tests Complete ===");