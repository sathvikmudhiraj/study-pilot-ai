import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true);

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "STUDYPILOT_E2E_EMAIL",
  "STUDYPILOT_E2E_PASSWORD",
  "STUDYPILOT_E2E_OTHER_EMAIL",
  "STUDYPILOT_E2E_OTHER_PASSWORD",
];

for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required environment variable: ${name}`);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const primary = createClient(url, key, clientOptions);
const secondary = createClient(url, key, clientOptions);

const primaryLogin = await primary.auth.signInWithPassword({
  email: process.env.STUDYPILOT_E2E_EMAIL,
  password: process.env.STUDYPILOT_E2E_PASSWORD,
});
const secondaryLogin = await secondary.auth.signInWithPassword({
  email: process.env.STUDYPILOT_E2E_OTHER_EMAIL,
  password: process.env.STUDYPILOT_E2E_OTHER_PASSWORD,
});

if (primaryLogin.error || !primaryLogin.data.user) throw new Error(`Primary login failed: ${primaryLogin.error?.message ?? "unknown"}`);
if (secondaryLogin.error || !secondaryLogin.data.user) throw new Error(`Second login failed: ${secondaryLogin.error?.message ?? "unknown"}`);

const primaryId = primaryLogin.data.user.id;
const marker = `rls-audit-${crypto.randomUUID()}`;
const created = [];
const results = {};

async function cleanupTaggedAuditData() {
  const taggedDeletes = [
    ["assistant_questions", "question"],
    ["conversations", "title"],
    ["revision_plans", "title"],
    ["quizzes", "title"],
    ["ai_outputs", "content"],
    ["notes", "title"],
    ["files", "file_name"],
  ];
  for (const [table, column] of taggedDeletes) {
    await primary.from(table).delete().like(column, "rls-audit-%");
  }
}

await cleanupTaggedAuditData();

async function insert(table, payload) {
  const response = await primary.from(table).insert(payload).select("*").single();
  if (response.error || !response.data?.id) {
    throw new Error(`${table} setup failed: ${response.error?.message ?? "missing id"}`);
  }
  created.push({ table, id: response.data.id });
  return response.data;
}

async function probe(table, row, patch, invariant) {
  const id = row.id;
  const read = await secondary.from(table).select("id").eq("id", id);
  const update = await secondary.from(table).update(patch).eq("id", id).select("id");
  const remove = await secondary.from(table).delete().eq("id", id).select("id");
  const ownerCheck = await primary.from(table).select("*").eq("id", id).maybeSingle();

  const selectBlocked = !read.error && (read.data?.length ?? 0) === 0;
  const updateBlocked = Boolean(update.error) || (update.data?.length ?? 0) === 0;
  const deleteBlocked = Boolean(remove.error) || (remove.data?.length ?? 0) === 0;
  const ownerPreserved = !ownerCheck.error && ownerCheck.data && invariant(ownerCheck.data);

  results[table] = {
    select: selectBlocked ? "PASS" : "FAIL",
    update: updateBlocked && ownerPreserved ? "PASS" : "FAIL",
    delete: deleteBlocked && ownerPreserved ? "PASS" : "FAIL",
    ownership: ownerPreserved ? "PASS" : "FAIL",
  };
}

let storagePath;
try {
  const file = await insert("files", {
    user_id: primaryId,
    file_name: `${marker}.txt`,
    original_file_name: `${marker}.txt`,
    file_type: "text",
    content_type: "text",
    mime_type: "text/plain",
    file_size: marker.length,
    extracted_text: marker,
    processing_status: "extracted",
    status: "extracted",
  });
  await probe("files", file, { file_name: "secondary-overwrite.txt" }, (value) => value.file_name === `${marker}.txt`);

  const note = await insert("notes", {
    user_id: primaryId,
    title: marker,
    topic: marker,
    raw_notes: marker,
    content: marker,
    source_type: "manual",
    file_id: file.id,
  });
  await probe("notes", note, { title: "secondary-overwrite" }, (value) => value.title === marker);

  const aiOutput = await insert("ai_outputs", {
    user_id: primaryId,
    file_id: file.id,
    note_id: note.id,
    short_summary: marker,
    output_type: "summary",
    content: marker,
    model: "audit",
    language_code: "en",
  });
  await probe("ai_outputs", aiOutput, { short_summary: "secondary-overwrite" }, (value) => value.short_summary === marker);

  const quiz = await insert("quizzes", {
    user_id: primaryId,
    file_id: file.id,
    note_id: note.id,
    title: marker,
    quiz_title: marker,
    difficulty: "easy",
    questions: [{ id: "q1", question: marker }],
    answer_key: [{ id: "q1", answer: "A" }],
    language_code: "en",
  });
  await probe("quizzes", quiz, { title: "secondary-overwrite" }, (value) => value.title === marker);

  const attempt = await insert("quiz_attempts", {
    user_id: primaryId,
    quiz_id: quiz.id,
    user_answers: [{ question_id: "q1", answer: "A" }],
    score: 1,
    total_questions: 1,
    percentage: 100,
    language_code: "en",
  });
  await probe("quiz_attempts", attempt, { score: 0 }, (value) => value.score === 1);

  const revision = await insert("revision_plans", {
    user_id: primaryId,
    title: marker,
    plan: { marker },
    important_topics: [marker],
    language_code: "en",
  });
  await probe("revision_plans", revision, { title: "secondary-overwrite" }, (value) => value.title === marker);

  const conversation = await insert("conversations", {
    user_id: primaryId,
    title: marker,
    language_code: "en",
  });
  await probe("conversations", conversation, { title: "secondary-overwrite" }, (value) => value.title === marker);

  const message = await insert("assistant_questions", {
    user_id: primaryId,
    conversation_id: conversation.id,
    question: marker,
    answer: { short_answer: marker },
    mode: "general",
    language_code: "en",
  });
  await probe("assistant_questions", message, { question: "secondary-overwrite" }, (value) => value.question === marker);

  storagePath = `${primaryId}/${marker}.txt`;
  const upload = await primary.storage.from("study-files").upload(storagePath, new TextEncoder().encode(marker), {
    contentType: "text/plain",
    upsert: false,
  });
  if (upload.error) throw new Error(`storage setup failed: ${upload.error.message}`);

  const secondaryList = await secondary.storage.from("study-files").list(primaryId, { search: `${marker}.txt` });
  const secondaryDownload = await secondary.storage.from("study-files").download(storagePath);
  const secondaryUpdate = await secondary.storage.from("study-files").update(storagePath, new TextEncoder().encode("secondary-overwrite"), {
    contentType: "text/plain",
    upsert: false,
  });
  const secondaryRemove = await secondary.storage.from("study-files").remove([storagePath]);
  const ownerDownload = await primary.storage.from("study-files").download(storagePath);
  const ownerText = ownerDownload.data ? await ownerDownload.data.text() : "";
  const storagePreserved = !ownerDownload.error && ownerText === marker;

  results.storage_objects = {
    select: !secondaryList.error && !secondaryList.data.some((item) => item.name === `${marker}.txt`) && Boolean(secondaryDownload.error) ? "PASS" : "FAIL",
    update: Boolean(secondaryUpdate.error) && storagePreserved ? "PASS" : "FAIL",
    delete: (Boolean(secondaryRemove.error) || (secondaryRemove.data?.length ?? 0) === 0) && storagePreserved ? "PASS" : "FAIL",
    ownership: storagePreserved ? "PASS" : "FAIL",
  };

  console.log(JSON.stringify({
    primaryLogin: "PASS",
    secondLogin: "PASS",
    results,
  }, null, 2));
} finally {
  if (storagePath) await primary.storage.from("study-files").remove([storagePath]).catch(() => null);
  for (const item of [...created].reverse()) {
    try {
      await primary.from(item.table).delete().eq("id", item.id);
    } catch {
      // Best-effort cleanup is followed by a prefix-scoped cleanup below.
    }
  }
  await cleanupTaggedAuditData();
  await primary.auth.signOut().catch(() => null);
  await secondary.auth.signOut().catch(() => null);
}
