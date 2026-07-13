import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { validateNoteBody } from "@/backend/lib/noteValidation";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

const NOTE_SELECT = "id, title, content, raw_notes, topic, source_type, key_link, note_date, importance, file_id, metadata, created_at, updated_at";

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const validated = validateNoteBody(body, "create");
  if (!validated.ok) return apiError(validated.error, 400);
  const note = validated.value;

  if (note.fileId) {
    const fileResult = await supabase
      .from("files")
      .select("id")
      .eq("id", note.fileId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fileResult.error) return apiError("Could not verify the source file. Please try again.", 500);
    if (!fileResult.data) return apiError("Source file not found or you do not have access to it.", 404);
  }

  const saved = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      title: note.title!,
      content: note.content!,
      raw_notes: note.content!,
      topic: note.topic ?? "",
      source_type: note.sourceType ?? "manual",
      key_link: note.keyLink ?? null,
      note_date: note.noteDate ?? null,
      importance: note.importance ?? null,
      file_id: note.fileId ?? null,
      metadata: note.metadata ?? {},
    })
    .select(NOTE_SELECT)
    .single();

  if (saved.error || !saved.data) return apiError("Could not save the note. Please try again.", 500);
  return NextResponse.json({ note: saved.data }, { status: 201 });
}
