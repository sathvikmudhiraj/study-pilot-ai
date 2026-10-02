import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { recordRevisionCompleted } from "@/backend/lib/learningMemory";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function complete(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);
  const { id } = await context.params;
  const current = await supabase
    .from("revision_plans")
    .select("id, important_topics, revise_first, pending_topics, plan, completion_status, completed_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (current.error) return apiError("Could not load this revision plan.", 500);
  if (!current.data) return apiError("Revision plan not found or you do not have access to it.", 404);

  const planData = current.data.plan && typeof current.data.plan === "object"
    ? current.data.plan as Record<string, unknown>
    : {};
  const topics = [...new Set([
    ...(Array.isArray(current.data.revise_first) ? current.data.revise_first : []),
    ...(Array.isArray(current.data.important_topics) ? current.data.important_topics : []),
    ...(Array.isArray(current.data.pending_topics) ? current.data.pending_topics : []),
  ].map((topic) => String(topic).trim()).filter(Boolean))].slice(0, 30);
  const fileId = typeof planData.source_file_id === "string" ? planData.source_file_id : null;
  const completedAt = new Date().toISOString();
  const updated = await supabase
    .from("revision_plans")
    .update({ completion_status: "completed", completed_at: completedAt })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (updated.error) return apiError("Could not complete this revision plan.", 500);

  try {
    const learningMemory = await recordRevisionCompleted(supabase, {
      userId: user.id,
      revisionPlanId: id,
      topics,
      fileIds: fileId ? [fileId] : [],
    });
    return NextResponse.json({ plan: updated.data, learningMemory });
  } catch (error) {
    await supabase
      .from("revision_plans")
      .update({ completion_status: current.data.completion_status ?? "pending", completed_at: current.data.completed_at })
      .eq("id", id)
      .eq("user_id", user.id);
    console.error("[learning-memory] Could not complete revision evidence", error);
    return apiError("Could not update learning memory. The revision plan was not marked complete.", 500);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRequestObservability(request, "/api/revision/[id]/complete", () => complete(request, context));
}
