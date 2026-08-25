import { Suspense } from "react";
import { fetchInternalApi } from "@/backend/lib/internalApiFetch";
import { UsersClient } from "./UsersClient";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "student";
  createdAt: string;
  lastSignInAt: string | null;
  emailConfirmed: boolean;
}

interface UsersResponse {
  users: AdminUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    search: string | null;
    role: string | null;
  };
}

async function fetchUsers(params: { page?: number; limit?: number; search?: string; role?: string } = {}): Promise<UsersResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.search) searchParams.set("search", params.search);
  if (params.role) searchParams.set("role", params.role);

  const res = await fetchInternalApi(`/api/admin/users?${searchParams.toString()}`, {
    cache: "no-store",
    headers: { "x-request-id": `req_admin_users_${crypto.randomUUID()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

function UsersSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-1/3 rounded bg-white/[0.06]" />
      <div className="h-12 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
      <div className="h-64 rounded-xl border border-white/[0.08] bg-white/[0.04]" />
      <div className="flex items-center justify-center gap-2">
        <div className="h-9 w-24 rounded-lg bg-white/[0.06]" />
        <div className="h-4 w-48 rounded bg-white/[0.06]" />
        <div className="h-9 w-24 rounded-lg bg-white/[0.06]" />
      </div>
    </div>
  );
}

function UsersError() {
  return (
    <div className="space-y-6">
      <div className="mb-8">
        <p className="mb-3 inline-flex rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-200">
          User Management
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-white">Admin Users</h1>
        <p className="mt-3 max-w-2xl text-slate-400">View and manage user accounts and roles.</p>
      </div>
      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center animate-fade-in">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-red-300">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white">Unable to load users</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">The user list could not be fetched. Check server logs for details.</p>
      </div>
    </div>
  );
}

async function UsersPageInner() {
  let data: UsersResponse;
  let currentUserId = "";
  try {
    const userRes = await fetchInternalApi("/api/auth/me", { cache: "no-store" });
    if (userRes.ok) {
      const userData = await userRes.json();
      currentUserId = userData.id;
    }
    data = await fetchUsers();
  } catch {
    return <UsersError />;
  }
  return <UsersClient initialData={data} currentUserId={currentUserId} />;
}

export default async function AdminUsersPage() {
  return (
    <Suspense fallback={<UsersSkeleton />}>
      <UsersPageInner />
    </Suspense>
  );
}