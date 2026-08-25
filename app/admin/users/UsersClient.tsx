"use client";

import { useState, useCallback } from "react";
import { PageHeader, Card, Button } from "@/frontend/components/ui";
import { DataTable } from "@/frontend/components/admin/DataTable";
import { StatusBadge } from "@/frontend/components/admin/StatusBadge";
import { IconUsers, IconSearch, IconRefresh, IconChevronDown, IconShield, IconCheck, IconAlertTriangle } from "@/frontend/components/icons";

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

interface UsersClientProps {
  initialData: UsersResponse;
  currentUserId: string;
}

async function fetchUsers(params: { page?: number; limit?: number; search?: string; role?: string } = {}): Promise<UsersResponse> {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set("page", String(params.page));
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.search) searchParams.set("search", params.search);
  if (params.role) searchParams.set("role", params.role);

  const res = await fetch(`/api/admin/users?${searchParams.toString()}`, {
    cache: "no-store",
    headers: { "x-request-id": `req_admin_users_${crypto.randomUUID()}` },
  });
  if (!res.ok) throw new Error("Failed to fetch users");
  return res.json();
}

async function updateUserRole(userId: string, role: "admin" | "student"): Promise<{ user: { id: string; email: string; role: string }; message: string }> {
  const res = await fetch(`/api/admin/users/${userId}/role`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "x-request-id": `req_admin_users_role_${crypto.randomUUID()}`,
    },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Failed to update role" }));
    throw new Error(error.error || "Failed to update role");
  }
  return res.json();
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(dateString: string | null): string {
  if (!dateString) return "—";
  return new Date(dateString).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function RoleBadge({ role, currentUserId, userId }: { role: "admin" | "student"; currentUserId: string; userId: string }) {
  const isSelf = currentUserId === userId;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${role === "admin" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {role.toUpperCase()}
      {isSelf && <span className="ml-1 text-[10px] opacity-70">(you)</span>}
    </span>
  );
}

function AccountStatusBadge({ emailConfirmed, lastSignInAt }: { emailConfirmed: boolean; lastSignInAt: string | null }) {
  if (!emailConfirmed) {
    return <StatusBadge status="warning" customLabel="Email not confirmed" />;
  }
  if (!lastSignInAt) {
    return <StatusBadge status="unknown" customLabel="Never signed in" />;
  }
  return <StatusBadge status="ok" customLabel="Active" />;
}

function ActionMenu({
  user,
  currentUserId,
  onRoleChange,
  pendingUserId,
}: {
  user: AdminUser;
  currentUserId: string;
  onRoleChange: (userId: string, role: "admin" | "student") => void;
  pendingUserId: string | null;
}) {
  const isSelf = currentUserId === user.id;
  const isPending = pendingUserId === user.id;
  const newRole = user.role === "admin" ? "student" : "admin";
  const actionLabel = newRole === "admin" ? "Make Admin" : "Remove Admin";
  const confirmMessage = newRole === "admin"
    ? `Promote ${user.email} to Admin?`
    : `Remove Admin access from ${user.email}?`;

  const handleClick = () => {
    if (isSelf) return;
    if (window.confirm(confirmMessage)) {
      onRoleChange(user.id, newRole);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={handleClick}
        disabled={isSelf || isPending}
        className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 ${
          isSelf
            ? "border-white/10 bg-white/[0.04] text-slate-500 cursor-not-allowed"
            : newRole === "admin"
            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
            : "border-amber-400/20 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
        }`}
        title={isSelf ? "You cannot change your own role" : undefined}
      >
        {isPending ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            <span>Updating...</span>
          </>
        ) : (
          <>
            {newRole === "admin" ? <IconShield size={12} /> : <IconUsers size={12} />}
            {actionLabel}
          </>
        )}
      </button>
    </div>
  );
}

function UsersTable({ users, currentUserId, onRoleChange, pendingUserId }: { users: AdminUser[]; currentUserId: string; onRoleChange: (userId: string, role: "admin" | "student") => void; pendingUserId: string | null }) {
  return (
    <DataTable
      columns={[
        {
          key: "name",
          header: "Name",
          render: (row) => (
            <div className="flex items-center gap-3">
              <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-300 text-sm font-medium">
                {row.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-medium text-slate-100 truncate">{row.name}</p>
                <p className="text-xs text-slate-500 truncate">{row.email}</p>
              </div>
            </div>
          ),
          className: "w-64",
        },
        {
          key: "role",
          header: "Role",
          render: (row) => <RoleBadge role={row.role} currentUserId={currentUserId} userId={row.id} />,
          className: "whitespace-nowrap",
        },
        {
          key: "status",
          header: "Account Status",
          render: (row) => <AccountStatusBadge emailConfirmed={row.emailConfirmed} lastSignInAt={row.lastSignInAt} />,
          className: "whitespace-nowrap",
        },
        {
          key: "createdAt",
          header: "Created",
          render: (row) => <span className="font-mono text-xs text-slate-300">{formatDate(row.createdAt)}</span>,
          className: "whitespace-nowrap",
        },
        {
          key: "lastSignInAt",
          header: "Last Sign In",
          render: (row) => <span className="font-mono text-xs text-slate-400">{formatDateTime(row.lastSignInAt)}</span>,
          className: "whitespace-nowrap",
        },
        {
          key: "actions",
          header: "Actions",
          render: (row) => <ActionMenu user={row} currentUserId={currentUserId} onRoleChange={onRoleChange} pendingUserId={pendingUserId} />,
          className: "w-48",
        },
      ]}
      data={users}
      keyAccessor={(row) => row.id}
      emptyMessage="No users found"
      emptyIcon={<IconUsers size={24} />}
      hoverable
      striped
    />
  );
}

export function UsersClient({ initialData, currentUserId }: UsersClientProps) {
  const [data, setData] = useState<UsersResponse>(initialData);
  const [page, setPage] = useState(initialData.pagination.page);
  const [search, setSearch] = useState(initialData.filters.search ?? "");
  const [roleFilter, setRoleFilter] = useState(initialData.filters.role ?? "");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleRoleChange = useCallback(async (userId: string, role: "admin" | "student") => {
    setPendingUserId(userId);
    setErrorMessage(null);
    try {
      const result = await updateUserRole(userId, role);
      setSuccessMessage(result.message);
      setTimeout(() => setSuccessMessage(null), 5000);
      const refreshed = await fetchUsers({ page, search: search || undefined, role: roleFilter || undefined });
      setData(refreshed);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to update role");
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setPendingUserId(null);
    }
  }, [page, search, roleFilter]);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setSearch(formData.get("search") as string);
    setPage(1);
  };

  const handleRoleFilterChange = (value: string) => {
    setPage(1);
    setRoleFilter(value);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        badge="User Management"
        title="Admin Users"
        description="View and manage user accounts and roles. All changes are logged in Audit Logs."
        actions={
          <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
            <IconRefresh size={16} />
            Refresh
          </Button>
        }
      />

      {(successMessage || errorMessage) && (
        <div className={`rounded-lg border p-4 text-sm ${successMessage ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200" : "border-red-400/20 bg-red-400/10 text-red-200"}`} role="alert">
          {successMessage && (
            <div className="flex items-center gap-2">
              <IconCheck size={16} />
              <span>{successMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="flex items-center gap-2">
              <IconAlertTriangle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      )}

      <Card accent padding="md">
        <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              name="search"
              type="search"
              placeholder="Search by name or email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 h-11 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-sm text-slate-100 outline-none transition-all duration-200 placeholder:text-slate-500 focus:border-emerald-300/60 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => handleRoleFilterChange(e.target.value)}
            className="h-11 appearance-none rounded-lg border border-white/10 bg-slate-950/70 bg-[url('data:image/svg+xml;utf8,<svg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2024%2024%22%20fill=%22none%22%20stroke=%22%2394a3b8%22%20stroke-width=%222%22%20stroke-linecap=%22round%22%20stroke-linejoin=%22round%22><polyline%20points=%226%209%2012%2015%2018%209%22/></svg>')] bg-[length:16px_16px] bg-[right_0.75rem_center] bg-no-repeat pr-9 px-4 text-sm text-slate-100 outline-none transition-all duration-200 focus:border-emerald-300/60 focus:shadow-[0_0_0_3px_rgba(16,185,129,0.08)]"
          >
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="student">Student</option>
          </select>
        </form>
      </Card>

      <Card accent padding="md">
        <UsersTable users={data.users} currentUserId={currentUserId} onRoleChange={handleRoleChange} pendingUserId={pendingUserId} />
      </Card>

      {data.pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
            <IconChevronDown size={16} className="rotate-180" />
            Previous
          </Button>
          <span className="text-sm text-slate-300">Page {page} of {data.pagination.totalPages}</span>
          <Button variant="ghost" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page >= data.pagination.totalPages}>
            Next
            <IconChevronDown size={16} />
          </Button>
        </div>
      )}

      <div className="text-xs text-slate-500 text-center">
        <p>Showing {data.users.length} of {data.pagination.total} users</p>
        <p className="mt-1">Role changes require user to sign out and sign back in to take effect.</p>
      </div>
    </div>
  );
}
