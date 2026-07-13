import Link from "next/link";

/**
 * Branded 404 fallback for any unmatched route. Keeps users in the app chrome
 * and offers a clear path back to their workspace or the landing page.
 */
export default function NotFound() {
  return (
    <main className="grid min-h-svh place-items-center overflow-hidden bg-[#070b14] px-4 py-10 text-slate-100">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute left-1/2 top-1/3 h-[500px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.05] blur-[120px]" />
      </div>
      <div className="relative w-full max-w-md text-center animate-fade-in-up">
        <p className="text-6xl font-bold tracking-tight text-emerald-300">404</p>
        <h1 className="mt-4 text-2xl font-bold text-white">Page not found</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          The page you were looking for does not exist or has moved. Your saved notes, files, and quizzes are safe.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center rounded-lg bg-emerald-400 px-6 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-300"
          >
            Open workspace
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-lg border border-white/15 bg-white/[0.04] px-6 text-sm font-semibold text-white transition hover:border-emerald-300/40 hover:bg-emerald-300/10"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
