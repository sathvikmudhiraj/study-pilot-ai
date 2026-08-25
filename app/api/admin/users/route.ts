import { NextResponse } from "next/server";
import { requireAdmin } from "@/backend/lib/auth";
import { createAdminSupabaseClient, hasAdminSupabaseEnv } from "@/backend/lib/adminSupabase";
import { withRequestObservability } from "@/backend/lib/observability";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

type AdminUserRow = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
};

type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "student";
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
};

export async function GET(request: Request = new Request("http://localhost/api/admin/users")) {
  return withRequestObservability(request, "/api/admin/users", async ({ logger }) => {
    const admin = await requireAdmin();
    if (!admin.ok) {
      logger.warn("admin.users.denied", { status: admin.status, errorCategory: "authorization" });
      return NextResponse.json({ error: admin.message }, { status: admin.status });
    }

    if (!hasAdminSupabaseEnv()) {
      return NextResponse.json(
        { error: "Admin user management is not configured.", users: [], pagination: { page: 1, limit: DEFAULT_LIMIT, total: 0, totalPages: 0 } },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10)));
    const search = url.searchParams.get("search")?.trim();
    const roleFilter = url.searchParams.get("role")?.trim();

    try {
      const supabase = createAdminSupabaseClient();

      const { data: usersData, error: listError } = await supabase.auth.admin.listUsers({
        page,
        perPage: limit,
      });

      if (listError) throw new Error(listError.message);

      const users = (usersData?.users ?? []) as AdminUserRow[];

      let filteredUsers = users;

      if (search) {
        const searchLower = search.toLowerCase();
        filteredUsers = users.filter(
          (u) => u.email?.toLowerCase().includes(searchLower) ||
                 metadataString(u.user_metadata?.full_name).toLowerCase().includes(searchLower) ||
                 metadataString(u.user_metadata?.name).toLowerCase().includes(searchLower)
        );
      }

      if (roleFilter === "admin" || roleFilter === "student") {
        filteredUsers = filteredUsers.filter((u) => {
          const role = u.app_metadata?.role === "admin" ? "admin" : "student";
          return role === roleFilter;
        });
      }

      const total = filteredUsers.length;
      const paginatedUsers = filteredUsers.slice((page - 1) * limit, page * limit);

      const mappedUsers: AdminUser[] = paginatedUsers.map((user) => {
        const appMetadata = user.app_metadata as Record<string, unknown> | null;
        const userMetadata = user.user_metadata as Record<string, unknown> | null;
        const role = appMetadata?.role === "admin" ? "admin" : "student";
        const name = resolveDisplayName({ profile: userMetadata, metadata: userMetadata, email: user.email });

        return {
          id: user.id,
          email: user.email ?? "",
          name,
          role,
          createdAt: user.created_at,
          lastSignInAt: user.last_sign_in_at,
          emailConfirmed: !!user.email_confirmed_at,
        };
      });

      return NextResponse.json({
        users: mappedUsers,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        filters: { search: search ?? null, role: roleFilter ?? null },
      });
    } catch (error) {
      logger.error("admin.users.failed", {
        status: 503,
        errorCategory: "database",
        error: error instanceof Error ? error.message : "unknown",
      });
      return NextResponse.json({ error: "User listing is temporarily unavailable." }, { status: 503 });
    }
  });
}

function resolveDisplayName({
  profile,
  metadata,
  email,
}: {
  profile?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  email?: string;
}) {
  const candidates = [
    cleanDisplayName(profile?.full_name),
    cleanDisplayName(profile?.name),
    cleanDisplayName(metadata?.full_name),
    cleanDisplayName(metadata?.name),
    emailUsername(email),
    "Student",
  ];

  return candidates.find((candidate) => candidate && !isTestDisplayName(candidate)) ?? "Student";
}

function cleanDisplayName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function metadataString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isTestDisplayName(value: string) {
  return ["e2e student", "test student"].includes(value.toLowerCase());
}

function emailUsername(email: string | undefined) {
  const username = email?.split("@")[0]?.trim();
  return username || "";
}
