"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { createBrowserSupabaseClient } from "@/frontend/lib/supabase/browser";
import { unlockWorkspaceAction } from "@/app/auth/actions";
import { Field, inputClass } from "./ui";

function safeReturnPath(value: string | null) {
  if (!value) return "/dashboard";

  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return "/dashboard";
  }

  try {
    const parsed = new URL(candidate, "https://studypilot.local");
    if (parsed.origin !== "https://studypilot.local" || parsed.pathname === "/auth") {
      return "/dashboard";
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/dashboard";
  }
}

export function AuthForm({
  envReady,
  maskedEmail,
  signOutFormAction,
  isReauth = false,
}: {
  envReady: boolean;
  maskedEmail?: string;
  signOutFormAction?: () => Promise<void>;
  isReauth?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedMode = searchParams.get("mode");

  const [mode, setMode] = useState<"login" | "signup">(() => (requestedMode === "signup" ? "signup" : "login"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const next = useMemo(() => safeReturnPath(searchParams.get("next")), [searchParams]);

  function switchMode(nextMode: "login" | "signup") {
    setMode(nextMode);
    setPassword("");
    setError("");
    setMessage("");
  }

  function resetTransient() {
    setPassword("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!envReady) {
      setError("Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
      return;
    }

    setLoading(true);

    // ── "Unlock workspace" path ──────────────────────────────────────────
    // When there is already an active session AND the visible form is the
    // login form (mode === "login"), the user is verifying their password to
    // unlock the existing workspace. We deliberately do NOT do client-side
    // signInWithPassword here — that would require passing the full email to
    // the client. Instead we only forward the entered password to a server
    // action which resolves the email server-side from the Supabase session.
    // The password is the only credential the client ever sends; the email is
    // never serialized into the client bundle.
    const isUnlockPath = isReauth && mode === "login";
    if (isUnlockPath) {
      try {
        const result = await unlockWorkspaceAction(password);
        // Always clear the password from client state regardless of outcome.
        resetTransient();
        if (!result.ok) {
          setError(result.message);
          return;
        }
        router.push(next);
        router.refresh();
      } catch (err) {
        resetTransient();
        setError(err instanceof Error ? err.message : "Could not verify your password. Please try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    const supabase = createBrowserSupabaseClient();

    try {
      const result =
        mode === "signup"
          ? await supabase.auth.signUp({
              email,
              password,
              options: { data: { name } },
            })
          : await supabase.auth.signInWithPassword({
              email,
              password,
            });

      if (result.error) {
        const msg = result.error.message.toLowerCase();
        if (msg.includes("email not confirmed")) {
          setError("Email not confirmed. Please confirm your email, then log in again.");
        } else if (msg.includes("invalid login credentials")) {
          setError("Invalid email or password. Check your details and try again.");
        } else {
          setError(result.error.message);
        }
        resetTransient();
        return;
      }

      if (mode === "signup" && !result.data.session) {
        setMessage("Account created. Check your email if confirmation is enabled, then log in.");
        switchMode("login");
        setName("");
        setEmail("");
        return;
      }

      resetTransient();
      router.push(next);
      router.refresh();
    } catch (err) {
      resetTransient();
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const showActiveSessionBlock = isReauth && !!maskedEmail && mode === "signup";

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5 shadow-2xl shadow-black/30 backdrop-blur sm:p-6 animate-fade-in">
      <div className="mb-6 grid grid-cols-2 rounded-lg border border-white/[0.06] bg-slate-950/70 p-1">
        {(["login", "signup"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => switchMode(item)}
            className={`h-10 rounded-md text-sm font-semibold transition-all duration-200 ${
              mode === item
                ? "bg-emerald-400 text-slate-950 shadow-sm"
                : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
            }`}
          >
            {item === "login" ? "Log in" : "Sign up"}
          </button>
        ))}
      </div>

      <h1 className="text-xl font-bold text-white sm:text-2xl">
        {mode === "login" ? (isReauth && maskedEmail ? "Unlock workspace" : "Welcome back") : "Create your workspace"}
      </h1>
      <p className="mt-2 text-sm text-slate-400">
        {mode === "login"
          ? isReauth && maskedEmail
            ? "Confirm your password to continue to your workspace."
            : "Log in with your StudyPilot AI account."
          : "Use email and password to start a private study workspace."}
      </p>

      {/* Active session ── LOGIN: continue as masked account */}
      {mode === "login" && isReauth && maskedEmail ? (
        <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
          <p className="text-sm leading-6 text-slate-300">
            Continue as <span className="font-semibold text-emerald-200">{maskedEmail}</span>
          </p>
          {signOutFormAction ? (
            <form action={signOutFormAction} className="mt-2">
              <button
                type="submit"
                className="h-9 w-full rounded-lg border border-white/10 bg-white/5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                Sign out and use another account
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {/* Active session ── SIGNUP: must sign out first */}
      {showActiveSessionBlock ? (
        <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/[0.08] p-4 text-sm leading-6 text-amber-100 animate-fade-in">
          <p>You are currently signed in. Sign out before creating another account.</p>
          {signOutFormAction ? (
            <form action={signOutFormAction} className="mt-3">
              <button
                type="submit"
                className="h-9 w-full rounded-lg border border-amber-300/30 bg-amber-400/10 text-sm font-semibold text-amber-100 transition hover:bg-amber-400/20"
              >
                Sign out and create another account
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      {/* Hide the editable form while the sign-up active-session block is showing */}
      {!showActiveSessionBlock ? (
        <form onSubmit={submit} className="mt-6 grid gap-4">
          {mode === "signup" ? (
            <Field label="Name">
              <input
                className={inputClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                placeholder="Alex Carter"
                autoComplete="name"
              />
            </Field>
          ) : null}

          {/* Editable email is shown only when NOT in the active-session login flow */}
          {!(mode === "login" && isReauth && maskedEmail) ? (
            <Field label="Email">
              <input
                className={inputClass}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
              />
            </Field>
          ) : null}

          <Field label="Password">
            <input
              key={`pw-${mode}-${isReauth ? "reauth" : "anon"}`}
              className={inputClass}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              required
              minLength={6}
              placeholder={mode === "signup" ? "At least 6 characters" : "Enter your password"}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Field>

          {error ? (
            <div className="break-words rounded-lg border border-red-400/25 bg-red-400/[0.08] p-3 text-sm text-red-200 animate-fade-in">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="break-words rounded-lg border border-emerald-400/25 bg-emerald-400/[0.08] p-3 text-sm text-emerald-200 animate-fade-in">
              {message}
            </div>
          ) : null}

          <button
            disabled={loading || !envReady}
            className="h-11 rounded-lg bg-emerald-400 px-5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-300 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 rounded-full bg-slate-950/60"
                      style={{ animation: `dotPulse 1.4s ease-in-out infinite`, animationDelay: `${i * 0.2}s` }}
                    />
                  ))}
                </span>
                Please wait...
              </span>
            ) : mode === "login" ? (
              isReauth && maskedEmail ? (
                "Unlock workspace"
              ) : (
                "Log in"
              )
            ) : (
              "Create account"
            )}
          </button>
        </form>
      ) : null}
    </div>
  );
}
