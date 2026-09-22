import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnvLocal() {
  const env = {};
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

function projectRefFromUrl(url) {
  try {
    return new URL(url).host.split(".")[0] || "";
  } catch {
    return "";
  }
}

function providerIncludesEmail(user) {
  const providers = new Set();
  for (const identity of user?.identities || []) {
    if (identity?.provider) providers.add(identity.provider);
  }
  for (const provider of user?.app_metadata?.providers || []) {
    providers.add(provider);
  }
  return providers.has("email");
}

async function testServiceRole(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is missing" };
  }

  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: body.msg || body.message || body.error_description || body.error || "admin request failed",
    };
  }
  return { ok: true };
}

async function findSecondUser(env) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { checked: false, error: body.msg || body.message || body.error_description || body.error || "admin users request failed" };
  }
  const expectedEmail = String(env.STUDYPILOT_E2E_OTHER_EMAIL || "").toLowerCase();
  const user = (Array.isArray(body.users) ? body.users : []).find(
    (candidate) => String(candidate.email || "").toLowerCase() === expectedEmail,
  );
  return {
    checked: true,
    exists: Boolean(user),
    emailConfirmed: Boolean(user?.email_confirmed_at),
    passwordProviderAvailable: providerIncludesEmail(user),
  };
}

async function signInSecondUser(env) {
  if (!env.STUDYPILOT_E2E_OTHER_EMAIL?.trim() || !env.STUDYPILOT_E2E_OTHER_PASSWORD?.trim()) {
    return { checked: true, ok: false, error: "Second-user credentials are missing" };
  }

  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: env.STUDYPILOT_E2E_OTHER_EMAIL,
    password: env.STUDYPILOT_E2E_OTHER_PASSWORD,
  });
  return { checked: true, ok: !error, error: error?.message ?? "" };
}

const env = readEnvLocal();
const projectRef = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
const expectedProjectRef = "bddrtclebenbmbuipiwq";

let serviceRole = { ok: false, error: "" };
let secondUser = { checked: false };
let signIn = { checked: false };

if (projectRef === expectedProjectRef) {
  serviceRole = await testServiceRole(env);
  if (serviceRole.ok) {
    secondUser = await findSecondUser(env);
    signIn = await signInSecondUser(env);
  }
} else {
  serviceRole = { ok: false, error: `Configured project is ${projectRef || "unreadable"}, expected ${expectedProjectRef}` };
}

console.log(
  JSON.stringify(
    {
      configuredProject: projectRef,
      expectedProject: expectedProjectRef,
      serviceRoleKeyValid: serviceRole.ok ? "PASS" : "FAIL",
      secondUserExists: serviceRole.ok && secondUser.checked ? (secondUser.exists ? "PASS" : "FAIL") : "NOT VERIFIED",
      emailConfirmed: serviceRole.ok && secondUser.checked ? (secondUser.emailConfirmed ? "PASS" : "FAIL") : "NOT VERIFIED",
      directPasswordLogin: serviceRole.ok && signIn.checked ? (signIn.ok ? "PASS" : "FAIL") : "NOT VERIFIED",
      exactAuthError: serviceRole.ok ? (signIn.error ?? "") : serviceRole.error,
    },
    null,
    2,
  ),
);
