import { AppShell } from "@/frontend/components/AppShell";
import { getCurrentUser } from "@/backend/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  return (
    <AppShell>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Settings</h1>
        <p className="mt-2 text-slate-400">Authenticated account details.</p>
      </div>
      <div className="max-w-xl rounded-lg border border-white/10 bg-white/[0.04] p-6">
        <div className="text-sm text-slate-400">Email</div>
        <div className="mt-1 font-medium text-white">{user?.email}</div>
      </div>
    </AppShell>
  );
}
