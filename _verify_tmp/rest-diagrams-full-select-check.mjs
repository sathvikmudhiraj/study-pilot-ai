import fs from "node:fs";

function readEnvFiles(files) {
  const env = {};
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

const env = readEnvFiles([".env.local", ".env.staging.local"]);
const select = [
  "id",
  "title",
  "diagram_type",
  "source_type",
  "mermaid",
  "explanation",
  "source_file_id",
  "source_answer_id",
  "created_at",
  "updated_at",
].join(",");

const response = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/diagrams?select=${encodeURIComponent(select)}&limit=1`,
  {
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      Accept: "application/json",
      Prefer: "count=exact",
    },
  },
);

let body;
try {
  body = await response.json();
} catch {
  body = await response.text();
}

console.log(JSON.stringify({ status: response.status, statusText: response.statusText, body }, null, 2));
