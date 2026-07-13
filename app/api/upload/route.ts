import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";

export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  return NextResponse.json(
    {
      error: "Legacy upload API is disabled. Use the /upload page or chat composer upload, which store files in Supabase Storage.",
    },
    { status: 410 },
  );
}
