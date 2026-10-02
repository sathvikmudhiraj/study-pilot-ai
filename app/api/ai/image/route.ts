import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { generateNvidiaImage, ImageGenerationError } from "@/backend/lib/imageGeneration";
import { withRequestObservability } from "@/backend/lib/observability";
import { enforceAiRateLimit } from "@/backend/lib/rateLimit";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { isSupportedLanguageCode } from "@/shared/languages";
import { createConversationResult, withConversationResult } from "@/shared/conversationResults";

export const runtime = "nodejs";
export const maxDuration = 180;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUCKET = "generated-images";

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

async function handlePost(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const rateLimited = enforceAiRateLimit(user.id);
  if (rateLimited) return rateLimited;

  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return apiError("Invalid request body.", 400); }

  const command = cleanText(body.prompt, 2_000);
  const topic = cleanText(body.topic, 500) || command;
  const conversationId = cleanText(body.conversationId, 128);
  const fileId = cleanText(body.fileId, 128);
  const requestedLanguage = cleanText(body.language, 10);
  const language = isSupportedLanguageCode(requestedLanguage) ? requestedLanguage : "en";
  if (command.length < 3 || topic.length < 2) return apiError("Name a topic to generate an image.", 400);
  if (conversationId && !UUID_RE.test(conversationId)) return apiError("Invalid conversation id.", 400);
  if (fileId && !UUID_RE.test(fileId)) return apiError("Invalid file id.", 400);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Storage is not configured.", 503);

  if (conversationId) {
    const conversation = await supabase.from("conversations").select("id").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
    if (conversation.error) return apiError("Could not verify the conversation.", 500);
    if (!conversation.data) return apiError("Conversation not found.", 404);
  }

  let sourceName = "";
  if (fileId) {
    const file = await supabase.from("files").select("id, file_name").eq("id", fileId).eq("user_id", user.id).maybeSingle();
    if (file.error) return apiError("Could not verify the selected file.", 500);
    if (!file.data) return apiError("Selected file not found.", 404);
    sourceName = cleanText(file.data.file_name, 200);
  }

  const providerPrompt = [
    `Create a clear educational study illustration about: ${topic}.`,
    sourceName ? `The concept comes from the student's selected material: ${sourceName}.` : "",
    "Use a clean classroom-friendly visual composition with distinct conceptual relationships.",
    "Do not include logos, watermarks, UI chrome, or long passages of text.",
  ].filter(Boolean).join(" ");

  const id = randomUUID();
  let storagePath = "";
  try {
    const generated = await generateNvidiaImage(providerPrompt, request.signal);
    storagePath = `${user.id}/${id}.${generated.extension}`;
    const uploaded = await supabase.storage.from(BUCKET).upload(storagePath, generated.bytes, {
      contentType: generated.mimeType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploaded.error) throw new ImageGenerationError("Could not save the generated image.", "provider", 500);

    const now = new Date().toISOString();
    const title = `Study visual: ${topic}`.slice(0, 200);
    const explanation = sourceName
      ? `Generated for ${topic} using ${sourceName} as the active study context.`
      : `Generated as a study visual for ${topic}.`;
    const insert = await supabase.from("generated_images").insert({
      id,
      user_id: user.id,
      conversation_id: conversationId || null,
      source_file_id: fileId || null,
      title,
      prompt: topic,
      provider_prompt: providerPrompt,
      explanation,
      provider: generated.provider,
      model: generated.model,
      storage_path: storagePath,
      mime_type: generated.mimeType,
      width: generated.width,
      height: generated.height,
      status: "ready",
      language_code: language,
    }).select("created_at").single();
    if (insert.error) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      storagePath = "";
      throw new ImageGenerationError("Could not save generated image metadata.", "provider", 500);
    }

    const image = {
      id,
      title,
      prompt: topic,
      explanation,
      provider: generated.provider,
      model: generated.model,
      mime_type: generated.mimeType,
      width: generated.width,
      height: generated.height,
      url: `/api/generated-images/${id}/content`,
      created_at: insert.data.created_at ?? now,
    };

    let messageId: string | null = null;
    if (conversationId) {
      const saved = await supabase.from("assistant_questions").insert({
        user_id: user.id,
        conversation_id: conversationId,
        question: command,
        answer: withConversationResult(
          { short_answer: explanation },
          createConversationResult("generated_image", image, {
            artifact_id: id,
            title,
            status: "completed",
            provenance: { file_ids: fileId ? [fileId] : [], language },
          }),
        ),
        related_file_ids: fileId ? [fileId] : [],
        related_note_ids: [],
        mode: "generated_image",
        status: "answered",
        language_code: language,
      }).select("id").single();
      if (saved.error) {
        console.error("[image] conversation persistence failed", { code: saved.error.code, message: saved.error.message });
      } else {
        messageId = saved.data.id;
      }
    }

    return NextResponse.json({ image, messageId }, { status: 201 });
  } catch (error) {
    if (storagePath) await supabase.storage.from(BUCKET).remove([storagePath]);
    if (error instanceof ImageGenerationError) return apiError(error.message, error.status);
    console.error("[image] generation failed", error instanceof Error ? error.message : "unknown");
    return apiError("Image generation failed. Please try again.", 502);
  }
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/ai/image", async () => handlePost(request));
}
