import { AppShell } from "@/frontend/components/AppShell";
import { RevisionPlanPanel } from "@/frontend/components/RevisionPlanPanel";
import { PageHeader } from "@/frontend/components/ui";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RevisionPage() {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();

  let initialPlan = null as Parameters<typeof RevisionPlanPanel>[0]["initialPlan"];

  if (supabase && user) {
    const result = await supabase
      .from("revision_plans")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!result.error && result.data) {
      initialPlan = result.data as Parameters<typeof RevisionPlanPanel>[0]["initialPlan"];
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Revision Planner"
        description="Generate a structured revision plan from your files, notes, summaries, and quizzes."
      />
      <RevisionPlanPanel initialPlan={initialPlan} />
    </AppShell>
  );
}
