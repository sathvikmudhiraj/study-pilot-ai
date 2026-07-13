import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { validateNoteBody, validateNoteId } from "@/backend/lib/noteValidation";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

const NOTE_SELECT = "id, title, content, raw_notes, topic, source_type, key_link, note_date, importance, file_id, metadata, created_at, updated_at";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

async function resolveNoteId(context: RouteContext) {
  const params = await context.params;
  return validateNoteId(params.id);
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const noteId = await resolveNoteId(context);
  if (!noteId.ok) return apiError(noteId.error, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const validated = validateNoteBody(body, "update");
  if (!validated.ok) return apiError(validated.error, 400);

  const owned = await supabase
    .from("notes")
    .select("id, file_id")
    .eq("id", noteId.value)
    .eq("user_id", user.id)
    .maybeSingle();

  if (owned.error) return apiError("Could not load this note. Please try again.", 500);
  if (!owned.data) return apiError("Note not found or you do not have access to it.", 404);

  const note = validated.value;
  if (note.fileId !== undefined && note.fileId !== owned.data.file_id && note.fileId !== null) {
    const fileResult = await supabase
      .from("files")
      .select("id")
      .eq("id", note.fileId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fileResult.error) return apiError("Could not verify the source file. Please try again.", 500);
    if (!fileResult.data) return apiError("Source file not found or you do not have access to it.", 404);
  }

  const updates: Record<string, unknown> = {};
  if (note.title !== undefined) updates.title = note.title;
  if (note.content !== undefined) {
    updates.content = note.content;
    updates.raw_notes = note.content;
  }
  if (note.topic !== undefined) updates.topic = note.topic;
  if (note.sourceType !== undefined) updates.source_type = note.sourceType;
  if (note.keyLink !== undefined) updates.key_link = note.keyLink;
  if (note.noteDate !== undefined) updates.note_date = note.noteDate;
  if (note.importance !== undefined) updates.importance = note.importance;
  if (note.fileId !== undefined) updates.file_id = note.fileId;
  if (note.metadata !== undefined) updates.metadata = note.metadata;

  const saved = await supabase
    .from("notes")
    .update(updates)
    .eq("id", noteId.value)
    .eq("user_id", user.id)
    .select(NOTE_SELECT)
    .maybeSingle();

  if (saved.error) return apiError("Could not update the note. Please try again.", 500);
  if (!saved.data) return apiError("Note not found or you do not have access to it.", 404);
  return NextResponse.json({ note: saved.data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const noteId = await resolveNoteId(context);
  if (!noteId.ok) return apiError(noteId.error, 400);

  const owned = await supabase
    .from("notes")
    .select("id")
    .eq("id", noteId.value)
    .eq("user_id", user.id)
    .maybeSingle();

  if (owned.error) return apiError("Could not load this note. Please try again.", 500);
  if (!owned.data) return apiError("Note not found or you do not have access to it.", 404);

  const deleted = await supabase
    .from("notes")
    .delete()
    .eq("id", noteId.value)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (deleted.error) return apiError("Could not delete the note. Please try again.", 500);
  if (!deleted.data) return apiError("Note not found or you do not have access to it.", 404);
  return NextResponse.json({ deleted: true, id: noteId.value });
}
