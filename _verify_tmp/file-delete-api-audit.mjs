import nextEnv from "@next/env";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "STUDYPILOT_E2E_EMAIL",
  "STUDYPILOT_E2E_PASSWORD",
  "STUDYPILOT_E2E_OTHER_EMAIL",
  "STUDYPILOT_E2E_OTHER_PASSWORD",
]) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required environment variable: ${name}`);
}

const baseURL = process.env.STUDYPILOT_E2E_BASE_URL || "http://127.0.0.1:3210";
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const primary = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, clientOptions);
const secondary = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, clientOptions);
const primaryLogin = await primary.auth.signInWithPassword({
  email: process.env.STUDYPILOT_E2E_EMAIL,
  password: process.env.STUDYPILOT_E2E_PASSWORD,
});
const secondaryLogin = await secondary.auth.signInWithPassword({
  email: process.env.STUDYPILOT_E2E_OTHER_EMAIL,
  password: process.env.STUDYPILOT_E2E_OTHER_PASSWORD,
});
if (primaryLogin.error || !primaryLogin.data.user) throw new Error(`Primary login failed: ${primaryLogin.error?.message ?? "unknown"}`);
if (secondaryLogin.error || !secondaryLogin.data.user) throw new Error(`Secondary login failed: ${secondaryLogin.error?.message ?? "unknown"}`);

const browser = await chromium.launch();
const primaryContext = await browser.newContext({ baseURL });
const secondaryContext = await browser.newContext({ baseURL });
const marker = `file-delete-audit-${crypto.randomUUID()}`;
const storagePath = `${primaryLogin.data.user.id}/${marker}.txt`;
const created = [];

async function browserLogin(context, email, password) {
  const page = await context.newPage();
  await page.goto("/auth?mode=login");
  const form = page.locator("form").filter({ has: page.getByRole("button", { name: /^log in$/i }) }).first();
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: /^log in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  return page;
}

async function insert(table, payload) {
  const result = await primary.from(table).insert(payload).select("*").single();
  if (result.error || !result.data?.id) throw new Error(`${table} insert failed: ${result.error?.message ?? "missing id"}`);
  created.push({ table, id: result.data.id });
  return result.data;
}

try {
  await browserLogin(primaryContext, process.env.STUDYPILOT_E2E_EMAIL, process.env.STUDYPILOT_E2E_PASSWORD);
  await browserLogin(secondaryContext, process.env.STUDYPILOT_E2E_OTHER_EMAIL, process.env.STUDYPILOT_E2E_OTHER_PASSWORD);

  const upload = await primary.storage.from("study-files").upload(storagePath, new TextEncoder().encode(marker), {
    contentType: "text/plain",
    upsert: false,
  });
  if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

  const file = await insert("files", {
    user_id: primaryLogin.data.user.id,
    file_name: `${marker}.txt`,
    original_file_name: `${marker}.txt`,
    file_type: "text",
    content_type: "text",
    mime_type: "text/plain",
    file_size: marker.length,
    storage_path: storagePath,
    extracted_text: marker,
    processing_status: "completed",
    status: "completed",
  });
  const note = await insert("notes", {
    user_id: primaryLogin.data.user.id,
    title: marker,
    topic: marker,
    raw_notes: marker,
    content: marker,
    source_type: "file",
    file_id: file.id,
  });
  const output = await insert("ai_outputs", {
    user_id: primaryLogin.data.user.id,
    file_id: file.id,
    note_id: note.id,
    short_summary: marker,
    output_type: "summary",
    content: marker,
    model: "audit",
  });
  const quiz = await insert("quizzes", {
    user_id: primaryLogin.data.user.id,
    file_id: file.id,
    note_id: note.id,
    title: marker,
    quiz_title: marker,
    difficulty: "easy",
    questions: [{ id: "q1", question: marker }],
    answer_key: [{ id: "q1", answer: "A" }],
  });
  const conversation = await insert("conversations", {
    user_id: primaryLogin.data.user.id,
    title: marker,
    context_mode: "file",
    active_file_ids: [file.id],
  });
  const message = await insert("assistant_questions", {
    user_id: primaryLogin.data.user.id,
    conversation_id: conversation.id,
    question: marker,
    answer: { short_answer: marker },
    mode: "selected-context",
    related_file_ids: [file.id],
  });

  const [conversationProbe, messageProbe] = await Promise.all([
    primary.from("conversations").select("id").eq("user_id", primaryLogin.data.user.id).filter("active_file_ids", "cs", JSON.stringify([file.id])),
    primary.from("assistant_questions").select("id").eq("user_id", primaryLogin.data.user.id).filter("related_file_ids", "cs", JSON.stringify([file.id])),
  ]);

  const unauthorized = await secondaryContext.request.delete(`${baseURL}/api/files/${file.id}`);
  const ownerBefore = await primary.from("files").select("id").eq("id", file.id).maybeSingle();
  const ownerDelete = await primaryContext.request.delete(`${baseURL}/api/files/${file.id}`);
  const ownerDeleteBody = await ownerDelete.json().catch(() => ({}));

  const [fileAfter, noteAfter, outputAfter, quizAfter, conversationAfter, messageAfter, storageAfter] = await Promise.all([
    primary.from("files").select("id").eq("id", file.id),
    primary.from("notes").select("id").eq("id", note.id),
    primary.from("ai_outputs").select("id").eq("id", output.id),
    primary.from("quizzes").select("file_id, note_id").eq("id", quiz.id).maybeSingle(),
    primary.from("conversations").select("active_file_ids").eq("id", conversation.id).maybeSingle(),
    primary.from("assistant_questions").select("related_file_ids").eq("id", message.id).maybeSingle(),
    primary.storage.from("study-files").download(storagePath),
  ]);

  console.log(JSON.stringify({
    unauthorizedDeleteBlocked: [403, 404].includes(unauthorized.status()) && Boolean(ownerBefore.data),
    conversationProbeError: conversationProbe.error?.message ?? null,
    messageProbeError: messageProbe.error?.message ?? null,
    ownerDeleteStatus: ownerDelete.status(),
    ownerDeleteError: ownerDeleteBody?.error ?? null,
    fileRowRemoved: !fileAfter.error && fileAfter.data.length === 0,
    noteCascaded: !noteAfter.error && noteAfter.data.length === 0,
    aiOutputCascaded: !outputAfter.error && outputAfter.data.length === 0,
    quizSourceCleared: !quizAfter.error && quizAfter.data?.file_id === null && quizAfter.data?.note_id === null,
    conversationReferenceCleared: !conversationAfter.error && !conversationAfter.data?.active_file_ids?.includes(file.id),
    messageReferenceCleared: !messageAfter.error && !messageAfter.data?.related_file_ids?.includes(file.id),
    storageObjectRemoved: Boolean(storageAfter.error),
  }, null, 2));
} finally {
  await primary.storage.from("study-files").remove([storagePath]).catch(() => null);
  for (const item of created.reverse()) {
    try {
      await primary.from(item.table).delete().eq("id", item.id);
    } catch {
      // Best-effort cleanup for disposable audit data.
    }
  }
  await primaryContext.close().catch(() => null);
  await secondaryContext.close().catch(() => null);
  await browser.close().catch(() => null);
  await primary.auth.signOut().catch(() => null);
  await secondary.auth.signOut().catch(() => null);
}
