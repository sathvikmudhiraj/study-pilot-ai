import { NextResponse } from "next/server";
import { getCurrentUser } from "@/backend/lib/auth";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

export async function GET(request: Request = new Request("http://localhost/api/auth/me")) {
  return withRequestObservability(request, "/api/auth/me", async () => {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    return NextResponse.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      preferredLanguage: user.preferredLanguage,
    });
  });
}