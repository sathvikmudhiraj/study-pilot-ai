import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { DeepResearchError, runDeepResearch } from "@/backend/lib/deepResearch";
import {
  getAiUserMessage,
  isAiBusyError,
  isAiQuotaError,
  isAiTimeoutError,
} from "@/backend/lib/aiProvider";
import { WebSearchError } from "@/backend/lib/webSearch";
import { withRequestObservability } from "@/backend/lib/observability";
import { enforceAiRateLimit } from "@/backend/lib/rateLimit";

export const runtime = "nodejs";
export const maxDuration = 60;

const QUERY_MIN_CHARS = 3;
const QUERY_MAX_CHARS = 500;

function apiError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function normalizeUnexpectedError(error: unknown) {
  if (isAiQuotaError(error)) {
    return { message: "AI quota is temporarily reached. Please try again later.", status: 429 };
  }
  if (isAiTimeoutError(error)) {
    return { message: "Deep research timed out. Try a narrower question.", status: 504 };
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
  return { message: "Deep research failed. Please try again.", status: 502 };
}

async function handlePost(request: Request) {
  const user = await requireUser();
  if (!user) return apiError("Please log in first.", 401);
  const rateLimited = enforceAiRateLimit(user.id);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body.", 400);
  }

  const query = normalizeQuery(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).query
      : undefined,
  );

  if (query.length < QUERY_MIN_CHARS) {
    return apiError(`Deep-research questions must be at least ${QUERY_MIN_CHARS} characters.`, 400);
  }
  if (query.length > QUERY_MAX_CHARS) {
    return apiError(`Deep-research questions must be ${QUERY_MAX_CHARS} characters or fewer.`, 400);
  }

  try {
    const report = await runDeepResearch(query, request.signal);
    return NextResponse.json({ report });
  } catch (error) {
    if (error instanceof DeepResearchError || error instanceof WebSearchError) {
      return apiError(error.message, error.status);
    }
    const normalized = normalizeUnexpectedError(error);
    return apiError(normalized.message, normalized.status);
  }
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/ai/deep-research", async () => handlePost(request));
}
