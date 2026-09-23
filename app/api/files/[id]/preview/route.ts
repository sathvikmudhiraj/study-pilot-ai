import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/backend/lib/auth";
import { createAdminSupabaseClient } from "@/backend/lib/adminSupabase";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const dynamic = "force-dynamic";

type FileRow = {
  id: string;
  user_id: string;
  file_name: string;
  mime_type: string | null;
  content_type?: string | null;
  storage_path: string | null;
  extracted_metadata: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function previewStoragePath(value: unknown) {
  if (!isRecord(value)) return null;
  const preview = value.preview;
  if (!isRecord(preview)) return null;
  if (preview.type !== "pdf" || preview.mimeType !== "application/pdf") return null;
  return typeof preview.storagePath === "string" && preview.storagePath.trim() ? preview.storagePath : null;
}

function isPdfFile(file: FileRow) {
  return file.content_type === "pdf" || file.mime_type === "application/pdf" || file.file_name.toLowerCase().endsWith(".pdf");
}

function cleanPreviewExpiredResponse(status = 401) {
  return new NextResponse(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #020617; color: #cbd5e1; font: 14px system-ui, sans-serif; }
      main { max-width: 30rem; padding: 2rem; text-align: center; }
      h1 { margin: 0 0 .6rem; color: white; font-size: 1rem; }
      p { line-height: 1.6; }
      button { margin-top: 1rem; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.04); color: white; border-radius: .5rem; padding: .6rem .9rem; font-weight: 700; cursor: pointer; }
      button:hover { border-color: rgba(110,231,183,.7); color: #a7f3d0; }
    </style>
  </head>
  <body>
    <main>
      <h1>Preview session expired. Refresh preview.</h1>
      <p>Your document is protected, so StudyPilot needs a fresh preview session before loading it.</p>
      <button type="button" onclick="window.location.reload()">Retry</button>
    </main>
  </body>
</html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy": "default-src 'self'; frame-ancestors 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
      },
    },
  );
}

function previewUnavailableResponse(message: string, status = 404) {
  return new NextResponse(
    `<!doctype html><html><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#020617;color:#cbd5e1;font:14px system-ui,sans-serif;text-align:center;padding:2rem"><main><h1 style="color:white;font-size:1rem">Preview unavailable</h1><p>${message}</p></main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-frame-options": "SAMEORIGIN",
        "content-security-policy": "default-src 'self'; frame-ancestors 'self'; style-src 'self' 'unsafe-inline'",
      },
    },
  );
}

async function loadAuthorizedFile(fileId: string, userId: string, isAdmin: boolean) {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return { file: null, storageClient: null };

  const owned = await supabase
    .from("files")
    .select("id, user_id, file_name, mime_type, content_type, storage_path, extracted_metadata")
    .eq("id", fileId)
    .eq("user_id", userId)
    .maybeSingle();

  if (owned.data) return { file: owned.data as FileRow, storageClient: supabase };
  if (!isAdmin) return { file: null, storageClient: null };

  const adminSupabase = createAdminSupabaseClient();
  const adminResult = await adminSupabase
    .from("files")
    .select("id, user_id, file_name, mime_type, content_type, storage_path, extracted_metadata")
    .eq("id", fileId)
    .maybeSingle();

  if (adminResult.data) return { file: adminResult.data as FileRow, storageClient: adminSupabase };
  return { file: null, storageClient: null };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return cleanPreviewExpiredResponse(401);

  const { id } = await context.params;
  const variant = request.nextUrl.searchParams.get("variant") === "generated" ? "generated" : "original";
  const { file, storageClient } = await loadAuthorizedFile(id, user.id, user.role === "admin");

  if (!file || !storageClient) return cleanPreviewExpiredResponse(user.role === "admin" ? 404 : 403);

  const storagePath = variant === "generated" ? previewStoragePath(file.extracted_metadata) : file.storage_path;
  if (!storagePath) return previewUnavailableResponse("This file does not have a PDF preview path.");
  if (variant === "original" && !isPdfFile(file)) return previewUnavailableResponse("This file is not a PDF.", 400);

  const signed = await storageClient.storage.from("study-files").createSignedUrl(storagePath, 60);
  if (signed.error || !signed.data?.signedUrl) return cleanPreviewExpiredResponse(403);

  const upstream = await fetch(signed.data.signedUrl, {
    headers: {
      ...(request.headers.get("range") ? { range: request.headers.get("range") as string } : {}),
    },
    cache: "no-store",
  });

  if (!upstream.ok) return cleanPreviewExpiredResponse(upstream.status === 404 ? 404 : 401);

  const headers = new Headers();
  headers.set("content-type", "application/pdf");
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-disposition", `inline; filename="${file.file_name.replace(/"/g, "")}"`);
  headers.set("x-frame-options", "SAMEORIGIN");
  headers.set("content-security-policy", "default-src 'self'; frame-ancestors 'self'; object-src 'self'; media-src 'self' blob:");

  for (const header of ["accept-ranges", "content-length", "content-range"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
