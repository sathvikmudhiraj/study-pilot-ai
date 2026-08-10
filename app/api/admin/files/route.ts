import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { createAdminSupabaseClient } from "@/backend/lib/adminSupabase";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type AdminFileRow = {
  id: string;
  created_at: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  mime_type: string | null;
  processing_status: string | null;
  chunks_count: number | null;
  user_id: string;
};

export async function GET(request: Request = new Request("http://localhost/api/admin/files")) {
  return withRequestObservability(request, "/api/admin/files", async ({ logger }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.files.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10)));
    const status = url.searchParams.get("status")?.trim();
    const fileType = url.searchParams.get("type")?.trim();
    const sortBy = url.searchParams.get("sort")?.trim() ?? "created_at";
    const sortOrder = url.searchParams.get("order")?.trim() === "asc" ? "asc" : "desc";
    const search = url.searchParams.get("search")?.trim();

    try {
      const supabase = createAdminSupabaseClient();

      let query = supabase
        .from("files")
        .select("id, created_at, file_name, file_type, file_size, mime_type, processing_status, chunks_count, user_id", { count: "exact" })
        .order(sortBy, { ascending: sortOrder === "asc" })
        .range((page - 1) * limit, page * limit - 1);

      if (status) {
        query = query.eq("processing_status", status);
      }
      if (fileType) {
        query = query.eq("file_type", fileType);
      }
      if (search) {
        query = query.ilike("file_name", `%${search}%`);
      }

      const { data, error, count } = await query;

      if (error) throw new Error(error.message);

      const files = (data as AdminFileRow[] ?? []).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        fileName: row.file_name,
        fileType: row.file_type ?? "unknown",
        fileSize: row.file_size ?? 0,
        mimeType: row.mime_type ?? row.file_type ?? "application/octet-stream",
        processingStatus: row.processing_status ?? "unknown",
        chunksCount: row.chunks_count ?? 0,
        userRef: `${row.user_id.slice(0, 8)}…`,
      }));

      return NextResponse.json({
        files,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          totalPages: Math.ceil((count ?? 0) / limit),
        },
        filters: { status, type: fileType, search: search ?? null },
      });
    } catch (error) {
      logger.error("admin.files.failed", {
        status: 503,
        errorCategory: "database",
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "File listing is temporarily unavailable." }, { status: 503 });
    }
  });
}