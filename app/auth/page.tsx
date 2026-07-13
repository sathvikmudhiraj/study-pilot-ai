import { Suspense } from "react";
import Link from "next/link";
import { AuthForm } from "@/frontend/components/AuthForm";
import { getCurrentUser } from "@/backend/lib/auth";
import { hasSupabaseEnv } from "@/backend/lib/supabase/env";
import { signOutAction } from "./actions";

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "****@****";
  const visible = name.length <= 3 ? name[0] + "***" : name.slice(0, 2) + "***" + name.slice(-1);
  return `${visible}@${domain}`;
}

export default async function AuthPage() {
  const envReady = hasSupabaseEnv();
  const user = await getCurrentUser();
  const maskedEmail = user?.email ? maskEmail(user.email) : undefined;

  return (
    <main className="grid min-h-svh place-items-center overflow-hidden bg-[#070b14] px-4 py-8 sm:py-12">
      {/* Subtle background glow */}
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/3 h-[500px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.04] blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-[400px] w-[400px] rounded-full bg-cyan-500/[0.03] blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="grid h-12 w-12 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-sm font-bold text-emerald-300 shadow-lg shadow-emerald-950/20 transition group-hover:border-emerald-400/35 group-hover:bg-emerald-400/15">
              SP
            </div>
          </Link>
          <div className="mt-4">
            <div className="text-2xl font-bold text-white">StudyPilot AI</div>
            <p className="mt-2 text-sm text-slate-400">Secure access for your learning workspace.</p>
          </div>
        </div>

        {!envReady ? (
          <div className="mb-4 break-words rounded-xl border border-amber-400/25 bg-amber-400/[0.08] p-4 text-sm leading-6 text-amber-100 animate-fade-in">
            <strong>Supabase is not configured.</strong> Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.
          </div>
        ) : null}

        <Suspense>
          <AuthForm
            envReady={envReady}
            maskedEmail={maskedEmail}
            signOutFormAction={user ? signOutAction : undefined}
            isReauth={!!user}
          />
        </Suspense>
      </div>
    </main>
  );
}
