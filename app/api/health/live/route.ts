import { NextResponse } from "next/server";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

export async function GET(request: Request = new Request("http://localhost/api/health/live")) {
  return withRequestObservability(request, "/api/health/live", async () =>
    NextResponse.json({ status: "ok" }, { status: 200 }),
  );
}
