import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = {
  params: Promise<{ id: string }>;
};

function apiError(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status });
}

function removeId(value: unknown, id: string) {
  return Array.isArray(value) ? value.filter((item) => item !== id) : [];
}

function previewStoragePath(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preview = (value as Record<string, unknown>).preview;
  if (!preview || typeof preview !== "object" || Array.isArray(preview)) return null;
  const storagePath = (preview as Record<string, unknown>).storagePath;
  return typeof storagePath === "string" && storagePath.trim() ? storagePath : null;
}

async function handleDelete(context: RouteContext) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  const { id: rawId } = await context.params;
  const fileId = rawId?.trim();
  if (!fileId || !UUID_PATTERN.test(fileId)) return apiError("File id is not valid.", 400);

  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);

  const owned = await supabase
    .from("files")
    .select("id, storage_path, extracted_metadata")
    .eq("id", fileId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (owned.error) return apiError("Could not load this file. Please try again.", 500);
  if (!owned.data) return apiError("File not found or you do not have access to it.", 404);

  const [conversations, questions] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, active_file_ids")
      .eq("user_id", user.id)
      .filter("active_file_ids", "cs", JSON.stringify([fileId])),
    supabase
      .from("assistant_questions")
      .select("id, related_file_ids")
      .eq("user_id", user.id)
      .filter("related_file_ids", "cs", JSON.stringify([fileId])),
  ]);

  if (conversations.error || questions.error) {
    return apiError("Could not prepare this file for deletion. Please try again.", 500);
  }

  const referenceUpdates = [
    ...(conversations.data ?? []).map((row) =>
      supabase
        .from("conversations")
        .update({ active_file_ids: removeId(row.active_file_ids, fileId) })
        .eq("id", row.id)
        .eq("user_id", user.id),
    ),
    ...(questions.data ?? []).map((row) =>
      supabase
        .from("assistant_questions")
        .update({ related_file_ids: removeId(row.related_file_ids, fileId) })
        .eq("id", row.id)
        .eq("user_id", user.id),
    ),
  ];
  const referenceResults = await Promise.all(referenceUpdates);
  if (referenceResults.some((result) => result.error)) {
    return apiError("Could not remove file references. Please try again.", 500);
  }

  const storagePaths = [owned.data.storage_path, previewStoragePath(owned.data.extracted_metadata)].filter((item): item is string => Boolean(item));
  if (storagePaths.length) {
    const storageDelete = await supabase.storage.from("study-files").remove(storagePaths);
    if (storageDelete.error) return apiError("Could not remove the stored file. Please try again.", 502);
  }

  const deleted = await supabase
    .from("files")
    .delete()
    .eq("id", fileId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (deleted.error) return apiError("Could not delete the file. Please try again.", 500);
  if (!deleted.data) return apiError("File not found or you do not have access to it.", 404);

  return NextResponse.json({ deleted: true, id: fileId });
}

export async function DELETE(request: Request, context: RouteContext) {
  return withRequestObservability(request, "/api/files/[id]", async () => handleDelete(context));
}
