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
const tokenResponse = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: env.STUDYPILOT_E2E_EMAIL,
    password: env.STUDYPILOT_E2E_PASSWORD,
  }),
});

const tokenBody = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || !tokenBody.access_token) {
  console.log(JSON.stringify({ tokenStatus: tokenResponse.status, restStatus: null, body: "auth_failed" }, null, 2));
  process.exit(0);
}

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
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/diagrams?select=${encodeURIComponent(select)}&user_id=eq.${tokenBody.user.id}&limit=1`,
  {
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${tokenBody.access_token}`,
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

const safeBody =
  body && typeof body === "object" && !Array.isArray(body)
    ? { code: body.code, message: body.message, details: body.details, hint: body.hint }
    : body;

console.log(JSON.stringify({ tokenStatus: tokenResponse.status, restStatus: response.status, body: safeBody }, null, 2));
