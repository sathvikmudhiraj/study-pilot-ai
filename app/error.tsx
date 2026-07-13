"use client";

/**
 * Root error boundary for the App Router. Catches rendering/server errors for
 * any segment that does not define its own error boundary, and lets the user
 * recover without a full reload while reporting the failure clearly.
 */
import { useEffect } from "react";
import { IconX } from "@/frontend/components/icons";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[StudyPilot] route error", error);
    }
  }, [error]);

  return (
    <div className="grid min-h-svh place-items-center px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-red-400/25 bg-red-400/[0.06] p-6 text-center shadow-2xl shadow-black/30 backdrop-blur animate-fade-in">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl border border-red-400/20 bg-red-400/10 text-red-200">
          <IconX size={22} />
        </div>
        <h1 className="text-xl font-bold text-white">Something went wrong</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          We could not finish loading this part of StudyPilot. You can try again, and your saved data is unaffected.
        </p>
        {process.env.NODE_ENV !== "production" && error?.message ? (
          <pre className="mt-4 overflow-auto rounded-md border border-white/10 bg-slate-950/70 p-3 text-left text-xs text-slate-300">
            {error.message}
          </pre>
        ) : null}
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="h-10 rounded-lg bg-emerald-400 px-5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300"
          >
            Try again
          </button>
          <a
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-lg border border-white/10 bg-white/5 px-5 text-sm font-semibold text-slate-100 transition hover:bg-white/10"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
