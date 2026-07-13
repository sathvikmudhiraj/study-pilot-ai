import { LoadingShimmer, PageHeader } from "@/frontend/components/ui";

/**
 * Root loading fallback shown by the App Router for any route while its
 * server component(s) are still streaming. Mirrors the app chrome so the
 * transition feels continuous rather than a blank flash.
 */
export default function Loading() {
  return (
    <div className="min-h-svh px-4 py-10 sm:px-6 lg:px-8" aria-busy="true" aria-live="polite">
      <div className="mx-auto max-w-6xl">
        <span className="sr-only">Loading StudyPilot…</span>
        <PageHeader title="Loading…" description="Preparing your workspace." />
        <div className="mt-2">
          <LoadingShimmer lines={4} />
        </div>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-5">
              <LoadingShimmer lines={2} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
