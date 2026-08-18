import { NextResponse } from "next/server";
import { withRequestObservability } from "@/backend/lib/observability";

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/auth/register", async () =>
    NextResponse.redirect(new URL("/auth?mode=signup", request.url), 303),
  );
}
