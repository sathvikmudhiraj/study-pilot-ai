import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseEnv, getSupabaseEnv } from "./env";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const SECURITY_HEADERS: Array<[string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)"],
];

function withSecurityHeaders(response: NextResponse) {
  for (const [name, value] of SECURITY_HEADERS) {
    response.headers.set(name, value);
  }
  return response;
}

function isLocalDevelopmentHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "::1" || hostname === "[::1]";
}

function originPort(url: URL) {
  if (url.port) return url.port;
  if (url.protocol === "http:") return "80";
  if (url.protocol === "https:") return "443";
  return "";
}

function isTrustedLocalDevelopmentOrigin(originUrl: URL, requestUrl: URL) {
  if (process.env.NODE_ENV === "production") return false;
  if (originUrl.protocol !== "http:" || requestUrl.protocol !== "http:") return false;
  if (!isLocalDevelopmentHost(originUrl.hostname) || !isLocalDevelopmentHost(requestUrl.hostname)) return false;
  return originPort(originUrl) === originPort(requestUrl);
}

export function isTrustedMutationOrigin(origin: string, requestOrigin: string) {
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(requestOrigin);
    return originUrl.origin === requestUrl.origin || isTrustedLocalDevelopmentOrigin(originUrl, requestUrl);
  } catch {
    return false;
  }
}

function isSameOriginMutation(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/")) return true;
  if (!MUTATING_METHODS.has(request.method.toUpperCase())) return true;

  const origin = request.headers.get("origin");
  if (origin) {
    return isTrustedMutationOrigin(origin, request.nextUrl.origin);
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSameOriginMutation(request)) {
    return withSecurityHeaders(
      NextResponse.json({ error: "Cross-site API requests are not allowed." }, { status: 403 }),
    );
  }

  if (!hasSupabaseEnv()) {
    return withSecurityHeaders(response);
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
    return withSecurityHeaders(NextResponse.redirect(redirectUrl));
  }

  return withSecurityHeaders(response);
}
