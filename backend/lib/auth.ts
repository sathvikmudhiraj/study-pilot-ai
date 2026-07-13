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

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  const metadataRole = user.user_metadata?.role;

  return {
    id: user.id,
    name: user.user_metadata?.name ?? user.email?.split("@")[0] ?? "Student",
    email: user.email ?? "",
    role: metadataRole === "admin" ? "admin" : "student",
  };
}

export async function requireUser(role?: Role) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (role && user.role !== role) return null;
  return user;
}
