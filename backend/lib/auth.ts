import crypto from "crypto";
import type { Role } from "./types";
import { createServerSupabaseClient } from "./supabase/server";
import { normalizeLanguageCode, type SupportedLanguageCode } from "@/shared/languages";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  preferredLanguage: SupportedLanguageCode;
};

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeTrustedRole(role: unknown): Role {
  return role === "admin" ? "admin" : "student";
}

function cleanDisplayName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function isTestDisplayName(value: string) {
  return ["e2e student", "test student"].includes(value.toLowerCase());
}

function emailUsername(email: string | undefined) {
  const username = email?.split("@")[0]?.trim();
  return username || "";
}

export function resolveDisplayName({
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

  return (
    candidates.find((candidate) => candidate && !isTestDisplayName(candidate)) ??
    "Student"
  );
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createServerSupabaseClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;
  const trustedRole = normalizeTrustedRole(user.app_metadata?.role);
  const metadata = user.user_metadata as Record<string, unknown> | null;

  return {
    id: user.id,
    name: resolveDisplayName({ metadata, email: user.email }),
    email: user.email ?? "",
    role: trustedRole,
    preferredLanguage: normalizeLanguageCode(metadata?.preferred_language),
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
