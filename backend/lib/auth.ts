import crypto from "crypto";
import type { Role } from "./types";
import { createServerSupabaseClient } from "./supabase/server";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeTrustedRole(role: unknown): Role {
  return role === "admin" ? "admin" : "student";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  const trustedRole = normalizeTrustedRole(user.app_metadata?.role);

  return {
    id: user.id,
    name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "Student",
    email: user.email ?? "",
    role: trustedRole,
  };
}

export async function requireUser(role?: Role) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (role && user.role !== role) return null;
  return user;
}

export type AdminAuthorizationResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403; message: string };

export async function requireAdmin(): Promise<AdminAuthorizationResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, status: 401, message: "Please log in first." };
  if (user.role !== "admin") return { ok: false, status: 403, message: "Admin access required." };
  return { ok: true, user };
}
