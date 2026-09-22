import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readDotEnvLocal() {
  const env = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function providerIncludesPassword(user) {
  const providers = new Set();
  for (const identity of user?.identities || []) {
    if (identity?.provider) providers.add(identity.provider);
  }
  if (Array.isArray(user?.app_metadata?.providers)) {
    for (const provider of user.app_metadata.providers) providers.add(provider);
  }
  return providers.has("email");
}

async function findUserWithServiceRole(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return { checked: false, error: "SUPABASE_SERVICE_ROLE_KEY is not configured" };
  }

  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      checked: false,
      status: response.status,
      error: body.msg || body.message || body.error_description || body.error || "admin users request failed",
    };
  }

  const users = Array.isArray(body.users) ? body.users : [];
  const expectedEmail = env.STUDYPILOT_E2E_OTHER_EMAIL.toLowerCase();
  const user = users.find((candidate) => String(candidate.email || "").toLowerCase() === expectedEmail);
  return {
    checked: true,
    exists: Boolean(user),
    emailConfirmed: Boolean(user?.email_confirmed_at),
    passwordProviderAvailable: providerIncludesPassword(user),
  };
}

const env = readDotEnvLocal();
const projectHost = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
const otherEmailConfigured = Boolean(env.STUDYPILOT_E2E_OTHER_EMAIL?.trim());
const otherPasswordConfigured = Boolean(env.STUDYPILOT_E2E_OTHER_PASSWORD?.trim());

let signIn = {
  ok: false,
  status: null,
  error: "not attempted",
};

if (otherEmailConfigured && otherPasswordConfigured) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: env.STUDYPILOT_E2E_OTHER_EMAIL,
    password: env.STUDYPILOT_E2E_OTHER_PASSWORD,
  });
  signIn = {
    ok: !error,
    status: error?.status ?? 200,
    error: error?.message ?? null,
  };
}

const admin = otherEmailConfigured ? await findUserWithServiceRole(env) : { checked: false, error: "second user email is not configured" };

console.log(
  JSON.stringify(
    {
      projectHost,
      expectedProjectHost: "bddrtclebenbmbuipiwq.supabase.co",
      otherEmailConfigured,
      otherPasswordConfigured,
      userExists: admin.checked ? (admin.exists ? "PASS" : "FAIL") : "FAIL",
      emailConfirmed: admin.checked ? (admin.emailConfirmed ? "PASS" : "FAIL") : "FAIL",
      passwordProviderAvailable: admin.checked ? (admin.passwordProviderAvailable ? "PASS" : "FAIL") : "FAIL",
      directSignInWithPassword: signIn.ok ? "PASS" : "FAIL",
      exactAuthError: signIn.error,
      adminCheck: admin.checked ? "PASS" : "FAIL",
      adminCheckError: admin.checked ? null : admin.error,
    },
    null,
    2,
  ),
);
