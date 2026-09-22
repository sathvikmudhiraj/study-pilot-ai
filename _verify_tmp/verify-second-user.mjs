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

async function passwordGrant(env, emailKey, passwordKey) {
  if (!env[emailKey] || !env[passwordKey]) {
    return { configured: false, tokenStatus: null, authenticated: false };
  }

  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: env[emailKey],
      password: env[passwordKey],
    }),
  });

  const body = await response.json().catch(() => ({}));
  return {
    configured: true,
    tokenStatus: response.status,
    authenticated: response.ok && Boolean(body.access_token) && Boolean(body.user?.id),
    userIdPresent: Boolean(body.user?.id),
  };
}

const env = readEnvFiles([".env.staging.local", ".env.local"]);
Object.assign(env, process.env);
const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
const primary = await passwordGrant(env, "STUDYPILOT_E2E_EMAIL", "STUDYPILOT_E2E_PASSWORD");
const secondary = await passwordGrant(env, "STUDYPILOT_E2E_OTHER_EMAIL", "STUDYPILOT_E2E_OTHER_PASSWORD");

console.log(JSON.stringify({ projectHost: host, primary, secondary }, null, 2));
