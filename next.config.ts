import type { NextConfig } from "next";

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
};

export default nextConfig;
