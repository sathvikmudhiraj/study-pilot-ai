import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import {
  DiagramGenerationError,
  generateGroundedDiagram,
  validateDiagramGenerationInput,
} from "@/backend/lib/diagramGeneration";
import {
  getAiUserMessage,
  isAiBusyError,
  isAiQuotaError,
  isAiTimeoutError,
} from "@/backend/lib/aiProvider";
import { withRequestObservability } from "@/backend/lib/observability";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeProviderError(error: unknown) {
  if (isAiQuotaError(error)) {
    return { message: "AI quota is temporarily reached. Please try again later.", status: 429 };
  }
  if (isAiTimeoutError(error)) {
    return { message: "Diagram generation timed out. Try a smaller source or simpler diagram.", status: 504 };
  }
  if (isAiBusyError(error)) {
    return { message: "StudyPilot AI is busy right now. Please try again in a few seconds.", status: 503 };
  }

  const providerMessage = getAiUserMessage(error).toLowerCase();
  if (providerMessage.includes("not configured")) {
    return { message: "AI service is not configured.", status: 503 };
  }
  if (providerMessage.includes("authentication")) {
    return { message: "AI service authentication failed.", status: 503 };
  }
  return { message: "Diagram generation failed. Please try again.", status: 502 };
}

async function persistDiagram(
  userId: string,
  diagram: {
    title: string;
    diagram_type: string;
    source_type: string;
    mermaid: string;
    explanation: string;
  },
  input: { sourceType: string; fileId?: string; answerId?: string }
) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const insertData: Record<string, unknown> = {
    user_id: userId,
    title: diagram.title,
    diagram_type: diagram.diagram_type,
    source_type: diagram.source_type,
    mermaid: diagram.mermaid,
    explanation: diagram.explanation,
  };

  if (input.sourceType === "file" && input.fileId) {
    insertData.source_file_id = input.fileId;
  }
  if (input.sourceType === "answer" && input.answerId) {
    insertData.source_answer_id = input.answerId;
  }

  const { data, error } = await supabase
    .from("diagrams")
    .insert(insertData)
    .select("id, created_at")
    .single();

  if (error) {
    console.error("[diagram] Persistence failed:", error.message);
    return null;
  }
  return data;
}

async function handlePost(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  let input;
  const requestSizeBytes = Buffer.byteLength(JSON.stringify(body ?? {}), "utf8");
  try {
    input = validateDiagramGenerationInput(body);
  } catch (error) {
    if (error instanceof DiagramGenerationError) {
      return apiError(error.message, error.status);
    }
    return apiError("Invalid diagram request.", 400);
  }

  try {
    const diagram = await generateGroundedDiagram(user.id, input, request.signal, { requestSizeBytes });

    // Persist the diagram to database
    const persisted = await persistDiagram(user.id, diagram, input);

    return NextResponse.json({ diagram, persisted: !!persisted, diagramId: persisted?.id ?? null });
  } catch (error) {
    if (error instanceof DiagramGenerationError) {
      return apiError(error.message, error.status);
    }
    const normalized = normalizeProviderError(error);
    return apiError(normalized.message, normalized.status);
  }
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/ai/diagram", async () => handlePost(request));
}
