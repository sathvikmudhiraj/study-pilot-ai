"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";
import { getCurrentUser } from "@/backend/lib/auth";

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/");
}

// Re-authenticate the currently-signed-in user to "unlock" the workspace.
//
// The client sends only the entered password. The email is resolved
// server-side from the Supabase session so it never crosses the network in a
// client RSC payload. The action never returns or logs the email or password.
//
// Returns a clean result: { ok: true } on success, or
// { ok: false, message: "<friendly error>" } on failure. The friendly
// message never contains credentials.
export type UnlockResult = { ok: true } | { ok: false; message: string };

const PASSWORD_MIN_LENGTH = 6;

export async function unlockWorkspaceAction(password: string): Promise<UnlockResult> {
  // Reject obviously malformed input server-side. The empty check lives here
  // (not on the client) so an attacker can't probe validation messages.
  const trimmed = typeof password === "string" ? password : "";
  if (!trimmed) return { ok: false, message: "Enter your password to continue." };
  if (trimmed.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: "Password is too short. Please try again." };
  }

  const supabase = await createServerSupabaseClient();
  if (!supabase) {
    return { ok: false, message: "Sign-in is not configured. Please try again later." };
  }

  // Resolve the current authenticated email server-side. We never read this
  // value from the client request body or RSC payload — the client only sends
  // the password.
  const user = await getCurrentUser();
  if (!user?.email) {
    // No active session server-side → nothing to unlock. Tell the user to use
    // the normal login form. Do NOT echo any PII.
    return { ok: false, message: "Your session has expired. Please log in again." };
  }

  // Verify password against Supabase using the server-resolved email. This
  // exercise only confirms the credential; it does not return anything beyond
  // a success/error sentinel to the client.
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: trimmed,
  });

  if (error) {
    const lower = error.message.toLowerCase();
    if (lower.includes("invalid login credentials")) {
      return { ok: false, message: "Invalid password. Please try again." };
    }
    if (lower.includes("email not confirmed")) {
      return { ok: false, message: "Email not confirmed. Please confirm your email, then try again." };
    }
    // Generic message — never leak the underlying raw error string or PII.
    return { ok: false, message: "Could not verify your password. Please try again." };
  }

  // The session is already valid (the user was authenticated); this verify
  // call refreshes tokens but the redirect target handles routing.
  return { ok: true };
}
