export function isMissingSupabaseSchema(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("schema cache") || lower.includes("could not find the table");
}

export function supabaseSetupMessage(message: string) {
  if (isMissingSupabaseSchema(message)) {
    return "Supabase database tables are missing. Run supabase/schema.sql in the Supabase SQL Editor, then run supabase/storage.sql for the study-files bucket.";
  }

  return message;
}
