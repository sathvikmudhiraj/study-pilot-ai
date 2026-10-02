import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { loadLearningMemory, recordExplicitLearningEvidence } from "@/backend/lib/learningMemory";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

async function get(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);
  const params = new URL(request.url).searchParams;
  try {
    const memory = await loadLearningMemory(supabase, user.id, {
      topic: params.get("topic") ?? undefined,
      fileId: params.get("fileId") ?? undefined,
      limit: Number(params.get("limit")) || 30,
    });
    return NextResponse.json(memory);
  } catch {
    return apiError("Could not load learning memory.", 500);
  }
}

async function post(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const supabase = await createServerSupabaseClient();
  if (!supabase) return apiError("Supabase is not configured.", 500);
  let body: { topic?: unknown; understood?: unknown; fileIds?: unknown; conversationId?: unknown };
  try { body = await request.json(); } catch { return apiError("Invalid request body.", 400); }
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 240) : "";
  if (!topic || typeof body.understood !== "boolean") return apiError("Topic and understanding state are required.", 400);
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((id): id is string => typeof id === "string") : [];
  try {
    const state = await recordExplicitLearningEvidence(supabase, {
      userId: user.id,
      topic,
      understood: body.understood,
      fileIds,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : null,
    });
    return NextResponse.json({ state });
  } catch {
    return apiError("Could not update learning memory.", 500);
  }
}

export async function GET(request: Request) {
  return withRequestObservability(request, "/api/learning-memory", () => get(request));
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/learning-memory", () => post(request));
}
