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

export async function POST(request: Request) {
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
    return NextResponse.json({ diagram });
  } catch (error) {
    if (error instanceof DiagramGenerationError) {
      return apiError(error.message, error.status);
    }
    const normalized = normalizeProviderError(error);
    return apiError(normalized.message, normalized.status);
  }
}
