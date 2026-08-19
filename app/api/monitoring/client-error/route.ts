import { NextResponse } from "next/server";
import { captureExternalError } from "@/backend/lib/externalMonitoring";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/monitoring/client-error", async ({ requestId }) => {
    let body: { message?: unknown; digest?: unknown; route?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid monitoring payload." }, { status: 400 });
    }

    await captureExternalError({
      source: "client",
      severity: "error",
      message: typeof body.message === "string" ? body.message : "Client route error",
      category: "ClientErrorBoundary",
      requestId,
      route: typeof body.route === "string" ? body.route : null,
      method: "CLIENT",
      metadata: {
        digest: typeof body.digest === "string" ? body.digest : null,
      },
    });

    return NextResponse.json({ ok: true });
  });
}
