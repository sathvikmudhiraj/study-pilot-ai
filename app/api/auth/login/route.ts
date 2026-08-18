import { NextResponse } from "next/server";
import { withRequestObservability } from "@/backend/lib/observability";

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/auth/login", async () =>
    NextResponse.redirect(new URL("/auth?mode=login", request.url), 303),
  );
}
