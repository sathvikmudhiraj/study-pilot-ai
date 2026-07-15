import type { NextConfig } from "next";

const supabaseOrigin = (() => {
  try {
    const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return configured ? new URL(configured).origin : "";
  } catch {
    return "";
  }
})();
const supabaseWsOrigin = supabaseOrigin.replace(/^https:/, "wss:");
const supabaseSources = Array.from(
  new Set([supabaseOrigin, supabaseWsOrigin, "https://*.supabase.co", "wss://*.supabase.co"].filter(Boolean)),
).join(" ");

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "form-action 'self'",
  `img-src 'self' data: blob: ${supabaseSources}`,
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  `connect-src 'self' ${supabaseSources}`,
  `frame-src 'self' ${supabaseSources}`,
  `media-src 'self' blob: ${supabaseSources}`,
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  // PDF.js workers must remain filesystem assets. Turbopack otherwise turns
  // worker module paths into numeric bundle ids, which Node path APIs cannot
  // resolve at runtime.
  serverExternalPackages: ["pdfjs-dist", "pdf-parse"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdf-parse/dist/worker/pdf.worker.mjs",
      "./node_modules/pdf-parse/package.json",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
