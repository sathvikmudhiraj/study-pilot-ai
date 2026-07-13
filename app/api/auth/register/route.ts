import { NextResponse } from "next/server";

export async function POST(request: Request) {
  return NextResponse.redirect(new URL("/auth?mode=signup", request.url), 303);
}
