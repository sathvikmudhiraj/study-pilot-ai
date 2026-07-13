import { AppShell } from "./AppShell";

export function PhasePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">{title}</h1>
        <p className="mt-2 max-w-2xl text-slate-400">{description}</p>
      </div>
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-6">
        <p className="text-sm leading-6 text-slate-300">
          This route is protected and ready for the next implementation phase. Phase 1 only sets up production authentication, database schema, route protection, and environment configuration.
        </p>
      </div>
    </AppShell>
  );
}
