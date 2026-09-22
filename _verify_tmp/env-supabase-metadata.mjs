import fs from "node:fs";

for (const file of [".env.local", ".env.staging.local"]) {
  if (!fs.existsSync(file)) continue;
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  let host = "";
  let dbHost = "";
  try {
    host = new URL(env.NEXT_PUBLIC_SUPABASE_URL || "").host;
  } catch {}
  try {
    dbHost = new URL(env.SUPABASE_DB_URL || "").host;
  } catch {}

  console.log(
    JSON.stringify({
      file,
      host,
      anonLength: (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").length,
      dbHost,
    }),
  );
}
