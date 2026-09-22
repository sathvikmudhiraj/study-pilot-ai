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

async function passwordGrant(env) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: env.STUDYPILOT_E2E_OTHER_EMAIL,
      password: env.STUDYPILOT_E2E_OTHER_PASSWORD,
    }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, ok: response.ok && Boolean(body.access_token), userIdPresent: Boolean(body.user?.id) };
}

async function signUp(env) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: env.STUDYPILOT_E2E_OTHER_EMAIL,
      password: env.STUDYPILOT_E2E_OTHER_PASSWORD,
      data: { name: "StudyPilot E2E Other" },
    }),
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    ok: response.ok,
    sessionPresent: Boolean(body.session),
    userIdPresent: Boolean(body.user?.id),
    message: body.msg || body.message || body.error_description || null,
  };
}

const env = readEnvFiles([".env.local", ".env.staging.local"]);

if (!env.STUDYPILOT_E2E_OTHER_EMAIL || !env.STUDYPILOT_E2E_OTHER_PASSWORD) {
  console.log(JSON.stringify({ configured: false, before: null, signup: null, after: null }, null, 2));
  process.exit(0);
}

const before = await passwordGrant(env);
let signup = null;
if (!before.ok) signup = await signUp(env);
const after = await passwordGrant(env);

console.log(JSON.stringify({ configured: true, before, signup, after }, null, 2));
