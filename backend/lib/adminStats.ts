import "server-only";

import { createAdminSupabaseClient } from "./adminSupabase";

const ADMIN_STAT_TABLES = {
  files: "files",
  notes: "notes",
  summaries: "ai_outputs",
  chats: "assistant_questions",
  quizzes: "quizzes",
} as const;

export type AdminStats = Record<keyof typeof ADMIN_STAT_TABLES, number>;

export async function getPlatformAdminStats(): Promise<AdminStats> {
  const supabase = createAdminSupabaseClient();
  const entries = await Promise.all(
    Object.entries(ADMIN_STAT_TABLES).map(async ([key, table]) => {
      const result = await supabase.from(table).select("id", { count: "exact", head: true });
      if (result.error) throw new Error(`Could not count ${key}.`);
      return [key, result.count ?? 0] as const;
    }),
  );

  return Object.fromEntries(entries) as AdminStats;
}
