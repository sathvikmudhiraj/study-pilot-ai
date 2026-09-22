import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";
import crypto from "node:crypto";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.STUDYPILOT_E2E_EMAIL;
const password = process.env.STUDYPILOT_E2E_PASSWORD;
if (!url || !key || !email || !password) throw new Error("Required E2E environment is missing.");

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const login = await supabase.auth.signInWithPassword({ email, password });
if (login.error || !login.data.user) throw new Error(`Primary login failed: ${login.error?.message ?? "unknown"}`);

const marker = `large-audit-${crypto.randomUUID()}`;
const fileName = `${marker}.txt`;
const storagePath = `${login.data.user.id}/${fileName}`;
const paragraphs = Array.from({ length: 320 }, (_, index) =>
  `Section ${index + 1}: StudyPilot performance audit topic ${index + 1}. Routing concept ${index + 1} links packets, subnet masks, gateways, reliable transport, and revision checkpoint ${index + 1}. The controlled marker is PERF-${String(index + 1).padStart(4, "0")}.`,
);
const content = paragraphs.join("\n\n");
let fileId = "";
let browser;

try {
  const uploadStarted = Date.now();
  const upload = await supabase.storage.from("study-files").upload(storagePath, new TextEncoder().encode(content), {
    contentType: "text/plain",
    upsert: false,
  });
  if (upload.error) throw new Error(`Large upload failed: ${upload.error.message}`);
  const fileInsert = await supabase.from("files").insert({
    user_id: login.data.user.id,
    file_name: fileName,
    original_file_name: fileName,
    file_type: "text",
    content_type: "text",
    mime_type: "text/plain",
    file_size: Buffer.byteLength(content),
    storage_path: storagePath,
    processing_status: "uploaded",
    status: "uploaded",
  }).select("id").single();
  if (fileInsert.error || !fileInsert.data?.id) throw new Error(`Large file row failed: ${fileInsert.error?.message ?? "missing id"}`);
  fileId = fileInsert.data.id;
  const uploadLatencyMs = Date.now() - uploadStarted;

  browser = await chromium.launch();
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.goto("/auth?mode=login");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) }).first();
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  const extractionStarted = Date.now();
  const extractionResponse = await context.request.post(`${baseURL}/api/ai/summarize`, {
    data: { fileId, reextractOnly: true, language: "en" },
    timeout: 120_000,
  });
  const extractionLatencyMs = Date.now() - extractionStarted;
  const extractionBody = await extractionResponse.json().catch(() => ({}));

  const summaryStarted = Date.now();
  const firstSummaryPromise = context.request.post(`${baseURL}/api/ai/summarize`, {
    data: { fileId, language: "en" },
    timeout: 130_000,
  });

  let summarizingObserved = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await supabase.from("files").select("processing_status").eq("id", fileId).single();
    if (state.data?.processing_status === "summarizing") {
      summarizingObserved = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const duplicateResponse = await context.request.post(`${baseURL}/api/ai/summarize`, {
    data: { fileId, language: "en" },
    timeout: 30_000,
  });
  const duplicateBody = await duplicateResponse.json().catch(() => ({}));
  const firstSummaryResponse = await firstSummaryPromise;
  const summaryLatencyMs = Date.now() - summaryStarted;
  const firstSummaryBody = await firstSummaryResponse.json().catch(() => ({}));

  const finalFile = await supabase.from("files").select("processing_status, extracted_text, chunks_count").eq("id", fileId).single();
  const outputCount = await supabase.from("ai_outputs").select("id", { count: "exact", head: true }).eq("file_id", fileId);

  console.log(JSON.stringify({
    inputBytes: Buffer.byteLength(content),
    upload: { status: "PASS", latencyMs: uploadLatencyMs },
    extraction: {
      httpStatus: extractionResponse.status(),
      latencyMs: extractionLatencyMs,
      extractedChars: extractionBody?.extraction?.textLength ?? finalFile.data?.extracted_text?.length ?? null,
      chunks: extractionBody?.extraction?.chunksCount ?? finalFile.data?.chunks_count ?? null,
    },
    summary: {
      httpStatus: firstSummaryResponse.status(),
      latencyMs: summaryLatencyMs,
      providerLatencyMs: firstSummaryBody?.elapsedMs ?? firstSummaryBody?.debug?.summaryElapsedMs ?? null,
      responsePresent: Boolean(firstSummaryBody?.summary),
    },
    duplicatePrevention: {
      summarizingObserved,
      httpStatus: duplicateResponse.status(),
      expectedConflict: duplicateResponse.status() === 409,
      messagePresent: Boolean(duplicateBody?.error),
      persistedOutputCount: outputCount.count ?? null,
    },
    terminalStatus: finalFile.data?.processing_status ?? null,
  }, null, 2));

  await context.close();
} finally {
  if (fileId) {
    await supabase.from("ai_outputs").delete().eq("file_id", fileId);
    await supabase.from("files").delete().eq("id", fileId);
  }
  await supabase.storage.from("study-files").remove([storagePath]);
  await supabase.auth.signOut().catch(() => null);
  if (browser) await browser.close().catch(() => null);
}
