import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv, getSupabaseEnv } from "./env";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!hasSupabaseEnv()) {
    return response;
  }

  const { url, anonKey } = getSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const protectedPrefixes = [
    "/dashboard",
    "/upload",
    "/files",
    "/ai-chat",
    "/ask",
    "/chat",
    "/summary",
    "/summaries",
    "/quiz",
    "/quizzes",
    "/revision",
    "/voice",
    "/settings",
    "/admin",
  ];
  const isProtected = protectedPrefixes.some((prefix) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`));

  if (isProtected && !user) {
    const redirectUrl = request.nextUrl.clone();
    const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    redirectUrl.pathname = "/auth";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", returnPath);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
