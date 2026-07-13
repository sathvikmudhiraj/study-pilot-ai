import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import {
  DiagramGenerationError,
  generateGroundedDiagram,
  validateDiagramGenerationInput,
} from "@/backend/lib/diagramGeneration";
import { consumeFeatureRateLimit, type FeatureRateLimitResult } from "@/backend/lib/featureRateLimit";
import {
  getAiUserMessage,
  isAiBusyError,
  isAiQuotaError,
  isAiTimeoutError,
} from "@/backend/lib/aiProvider";

export const runtime = "nodejs";
export const maxDuration = 60;

const DIAGRAM_LIMIT = 5;
const DIAGRAM_WINDOW_MS = 5 * 60_000;

function apiError(message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: message }, { status, headers });
}

function rateLimitHeaders(result: FeatureRateLimitResult) {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1_000)),
  });
  if (!result.allowed) headers.set("Retry-After", String(result.retryAfterSeconds));
  return headers;
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
  try {
    input = validateDiagramGenerationInput(body);
  } catch (error) {
    if (error instanceof DiagramGenerationError) {
      return apiError(error.message, error.status);
    }
    return apiError("Invalid diagram request.", 400);
  }

  const rateLimit = consumeFeatureRateLimit({
    key: `diagram:${user.id}`,
    limit: DIAGRAM_LIMIT,
    windowMs: DIAGRAM_WINDOW_MS,
  });
  const headers = rateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return apiError("Too many diagram requests. Please wait and try again.", 429, headers);
  }

  try {
    const diagram = await generateGroundedDiagram(user.id, input, request.signal);
    return NextResponse.json({ diagram }, { headers });
  } catch (error) {
    if (error instanceof DiagramGenerationError) {
      return apiError(error.message, error.status, headers);
    }
    const normalized = normalizeProviderError(error);
    return apiError(normalized.message, normalized.status, headers);
  }
}
