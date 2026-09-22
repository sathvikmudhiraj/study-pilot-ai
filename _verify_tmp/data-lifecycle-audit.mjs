import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "STUDYPILOT_E2E_EMAIL",
  "STUDYPILOT_E2E_PASSWORD",
]) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required environment variable: ${name}`);
}

const client = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);
const login = await client.auth.signInWithPassword({
  email: process.env.STUDYPILOT_E2E_EMAIL,
  password: process.env.STUDYPILOT_E2E_PASSWORD,
});
if (login.error || !login.data.user) throw new Error(`Primary login failed: ${login.error?.message ?? "unknown"}`);

const userId = login.data.user.id;
const marker = `lifecycle-audit-${crypto.randomUUID()}`;
const storagePath = `${userId}/${marker}.txt`;
const cleanup = [];

async function insert(table, payload) {
  const result = await client.from(table).insert(payload).select("*").single();
  if (result.error || !result.data?.id) throw new Error(`${table} insert failed: ${result.error?.message ?? "missing id"}`);
  cleanup.push({ table, id: result.data.id });
  return result.data;
}

try {
  const upload = await client.storage.from("study-files").upload(
    storagePath,
    new TextEncoder().encode(marker),
    { contentType: "text/plain", upsert: false },
  );
  if (upload.error) throw new Error(`Storage upload failed: ${upload.error.message}`);

  const file = await insert("files", {
    user_id: userId,
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
    user_id: userId,
    title: marker,
    topic: marker,
    raw_notes: marker,
    content: marker,
    source_type: "file",
    file_id: file.id,
  });
  const output = await insert("ai_outputs", {
    user_id: userId,
    file_id: file.id,
    note_id: note.id,
    short_summary: marker,
    output_type: "summary",
    content: marker,
    model: "audit",
    language_code: "en",
  });
  const quiz = await insert("quizzes", {
    user_id: userId,
    file_id: file.id,
    note_id: note.id,
    title: marker,
    quiz_title: marker,
    difficulty: "easy",
    questions: [{ id: "q1", question: marker }],
    answer_key: [{ id: "q1", answer: "A" }],
    language_code: "en",
  });
  const conversation = await insert("conversations", {
    user_id: userId,
    title: marker,
    context_mode: "file",
    active_file_ids: [file.id],
    language_code: "en",
  });
  const message = await insert("assistant_questions", {
    user_id: userId,
    conversation_id: conversation.id,
    question: marker,
    answer: { short_answer: marker },
    mode: "selected-context",
    related_file_ids: [file.id],
    language_code: "en",
  });

  const deletion = await client.from("files").delete().eq("id", file.id).select("id");
  if (deletion.error || deletion.data?.length !== 1) throw new Error(`Owner file deletion failed: ${deletion.error?.message ?? "no row deleted"}`);

  const [fileAfter, noteAfter, outputAfter, quizAfter, conversationAfter, messageAfter, storageAfter] = await Promise.all([
    client.from("files").select("id").eq("id", file.id),
    client.from("notes").select("id").eq("id", note.id),
    client.from("ai_outputs").select("id").eq("id", output.id),
    client.from("quizzes").select("id, file_id, note_id").eq("id", quiz.id).maybeSingle(),
    client.from("conversations").select("id, active_file_ids").eq("id", conversation.id).maybeSingle(),
    client.from("assistant_questions").select("id, related_file_ids").eq("id", message.id).maybeSingle(),
    client.storage.from("study-files").download(storagePath),
  ]);

  console.log(JSON.stringify({
    ownerDelete: "PASS",
    fileRowRemoved: !fileAfter.error && fileAfter.data.length === 0,
    dependentNoteCascaded: !noteAfter.error && noteAfter.data.length === 0,
    dependentAiOutputCascaded: !outputAfter.error && outputAfter.data.length === 0,
    quizRetainedWithNullSource: !quizAfter.error && quizAfter.data?.file_id === null && quizAfter.data?.note_id === null,
    conversationHasStaleFileId: !conversationAfter.error && conversationAfter.data?.active_file_ids?.includes(file.id),
    assistantMessageHasStaleFileId: !messageAfter.error && messageAfter.data?.related_file_ids?.includes(file.id),
    storageObjectOrphaned: !storageAfter.error && Boolean(storageAfter.data),
  }, null, 2));
} finally {
  await client.storage.from("study-files").remove([storagePath]).catch(() => null);
  for (const item of cleanup.reverse()) {
    try {
      await client.from(item.table).delete().eq("id", item.id);
    } catch {
      // Best-effort cleanup for disposable audit rows.
    }
  }
  await client.auth.signOut().catch(() => null);
}
