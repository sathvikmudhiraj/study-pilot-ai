import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { consumeFeatureRateLimit, type FeatureRateLimitResult } from "@/backend/lib/featureRateLimit";
import {
  getAiUserMessage,
  isAiBusyError,
  isAiQuotaError,
  isAiTimeoutError,
} from "@/backend/lib/aiProvider";
import { answerWebSearch, WebSearchError } from "@/backend/lib/webSearch";

export const runtime = "nodejs";

const QUERY_MIN_CHARS = 3;
const QUERY_MAX_CHARS = 500;
const WEB_SEARCH_LIMIT = 10;
const WEB_SEARCH_WINDOW_MS = 60_000;

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

function normalizeQuery(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ");
}

function normalizeUnexpectedError(error: unknown) {
  if (isAiQuotaError(error)) {
    return { message: "AI quota is temporarily reached. Please try again later.", status: 429 };
  }
  if (isAiTimeoutError(error)) {
    return { message: "AI answer generation timed out. Please try again.", status: 504 };
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
  return { message: "Web search answer generation failed. Please try again.", status: 502 };
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

  const query = normalizeQuery(
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>).query
      : undefined,
  );

  if (query.length < QUERY_MIN_CHARS) {
    return apiError(`Web search queries must be at least ${QUERY_MIN_CHARS} characters.`, 400);
  }
  if (query.length > QUERY_MAX_CHARS) {
    return apiError(`Web search queries must be ${QUERY_MAX_CHARS} characters or fewer.`, 400);
  }

  const rateLimit = consumeFeatureRateLimit({
    key: `web-search:${user.id}`,
    limit: WEB_SEARCH_LIMIT,
    windowMs: WEB_SEARCH_WINDOW_MS,
  });
  const headers = rateLimitHeaders(rateLimit);
  if (!rateLimit.allowed) {
    return apiError("Too many web searches. Please wait and try again.", 429, headers);
  }

  try {
    const answer = await answerWebSearch(query, request.signal);
    return NextResponse.json({ answer }, { headers });
  } catch (error) {
    if (error instanceof WebSearchError) {
      return apiError(error.message, error.status, headers);
    }
    const normalized = normalizeUnexpectedError(error);
    return apiError(normalized.message, normalized.status, headers);
  }
}
