import { NextResponse } from "next/server";
import { requireUser } from "@/backend/lib/auth";

export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Please log in first." }, { status: 401 });

  return NextResponse.json(
    {
      error: "Legacy summary generation is disabled. Open a file from My Files and use Generate Summary.",
    },
    { status: 410 },
  );
}
