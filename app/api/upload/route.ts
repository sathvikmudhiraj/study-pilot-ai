import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";
import { withRequestObservability } from "@/backend/lib/observability";

async function handlePost() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  return NextResponse.json(
    {
      error: "Legacy upload API is disabled. Use the /upload page or chat composer upload, which store files in Supabase Storage.",
    },
    { status: 410 },
  );
}

export async function POST(request: Request) {
  return withRequestObservability(request, "/api/upload", async () => handlePost());
}
