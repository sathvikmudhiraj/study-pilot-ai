import "server-only";

import { cookies, headers } from "next/headers";

function isLocalHost(host: string) {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

async function getInternalBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured;

  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (isLocalHost(host) ? "http" : "https");
  return `${protocol}://${host}`;
}

export async function fetchInternalApi(path: string, init: RequestInit = {}) {
  const [baseUrl, cookieStore] = await Promise.all([getInternalBaseUrl(), cookies()]);
  const requestHeaders = new Headers(init.headers);
  const cookieHeader = cookieStore.toString();

  if (cookieHeader && !requestHeaders.has("cookie")) {
    requestHeaders.set("cookie", cookieHeader);
  }

  return fetch(new URL(path, baseUrl), {
    ...init,
    headers: requestHeaders,
  });
}
