import { AppShell } from "@/frontend/components/AppShell";
import { RevisionPlanPanel } from "@/frontend/components/RevisionPlanPanel";
import { PageHeader } from "@/frontend/components/ui";
import { getCurrentUser } from "@/backend/lib/auth";
import { createServerSupabaseClient } from "@/backend/lib/supabase/server";

export const dynamic = "force-dynamic";

type RevisionSearchParams = {
  fileId?: string | string[];
  language?: string | string[];
};

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RevisionPage({ searchParams }: { searchParams?: Promise<RevisionSearchParams> }) {
  const user = await getCurrentUser();
  const supabase = await createServerSupabaseClient();
  const params = searchParams ? await searchParams : {};
  const fileId = singleParam(params.fileId) ?? null;

  let initialPlan = null as Parameters<typeof RevisionPlanPanel>[0]["initialPlan"];
  let sourceFile = null as Parameters<typeof RevisionPlanPanel>[0]["sourceFile"];

  if (supabase && user) {
    if (fileId) {
      const fileResult = await supabase
        .from("files")
        .select("id, file_name")
        .eq("id", fileId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!fileResult.error && fileResult.data) {
        sourceFile = fileResult.data;
      }
    }

    let query = supabase
      .from("revision_plans")
      .select("id, title, important_topics, revise_first, pending_topics, daily_plan, plan, starts_on, ends_on, language_code, created_at")
      .eq("user_id", user.id)
      .eq("language_code", user.preferredLanguage)
      .order("created_at", { ascending: false });

    if (fileId) {
      query = query.contains("plan", { source_file_id: fileId });
    }

    const result = await query.limit(fileId ? 1 : 20);

    if (!result.error && result.data) {
      const rows = Array.isArray(result.data) ? result.data : [result.data];
      const plan = fileId
        ? rows[0]
        : rows.find((row) => {
            const meta = row.plan && typeof row.plan === "object" ? row.plan as Record<string, unknown> : null;
            return typeof meta?.source_file_id !== "string";
          });
      initialPlan = (plan ?? null) as Parameters<typeof RevisionPlanPanel>[0]["initialPlan"];
    }
  }

  return (
    <AppShell>
      <PageHeader
        title="Revision Planner"
        description="Generate a structured revision plan from your files, notes, summaries, and quizzes."
      />
      <RevisionPlanPanel initialPlan={initialPlan} preferredLanguage={user?.preferredLanguage ?? "en"} sourceFile={sourceFile} />
    </AppShell>
  );
}
