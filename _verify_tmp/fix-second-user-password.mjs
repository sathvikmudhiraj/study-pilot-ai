import fs from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

function parseEnvLocal() {
  const text = fs.readFileSync(".env.local", "utf8");
  const env = {};
  const raw = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match) continue;
    raw[match[2]] = match[4];
    env[match[2]] = match[4].replace(/^["']|["']$/g, "");
  }
  return { text, env, raw };
}

function updateEnvValue(text, key, value) {
  const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, `$1${value}`);
  return `${text.trimEnd()}\n${key}=${value}\n`;
}

async function signIn(env) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.auth.signInWithPassword({
    email: env.STUDYPILOT_E2E_OTHER_EMAIL,
    password: env.STUDYPILOT_E2E_OTHER_PASSWORD,
  });
  return { ok: !error, error: error?.message ?? "" };
}

async function listUsers(env) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: body.msg || body.message || body.error_description || body.error || "admin user lookup failed" };
  }
  return { ok: true, users: Array.isArray(body.users) ? body.users : [] };
}

async function updatePassword(env, userId, password) {
  const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { ok: false, error: body.msg || body.message || body.error_description || body.error || "admin password update failed" };
  }
  return { ok: true };
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

let { text, env, raw } = parseEnvLocal();
const rawEmail = raw.STUDYPILOT_E2E_OTHER_EMAIL ?? "";
const envEmail = env.STUDYPILOT_E2E_OTHER_EMAIL ?? "";
const emailHasCleanFormatting = rawEmail === envEmail && rawEmail.trim() === rawEmail && !/^["']|["']$/.test(rawEmail);

let exactAuthError = "";
let envEmailMatchesExistingUser = false;
let emailConfirmed = false;
let passwordLogin = false;

const admin = await listUsers(env);
if (!admin.ok) {
  exactAuthError = admin.error;
} else {
  const user = admin.users.find((candidate) => String(candidate.email || "") === envEmail);
  envEmailMatchesExistingUser = Boolean(user) && emailHasCleanFormatting;
  emailConfirmed = Boolean(user?.email_confirmed_at);
  const passwordProviderAvailable = providerIncludesEmail(user);

  let login = await signIn(env);
  passwordLogin = login.ok;
  exactAuthError = login.error;

  if (!passwordLogin && user?.id && passwordProviderAvailable) {
    const nextPassword = `SpRls-${crypto.randomBytes(12).toString("base64url")}-9a!`;
    const update = await updatePassword(env, user.id, nextPassword);
    if (update.ok) {
      text = updateEnvValue(text, "STUDYPILOT_E2E_OTHER_PASSWORD", nextPassword);
      fs.writeFileSync(".env.local", text);
      ({ env } = parseEnvLocal());
      login = await signIn(env);
      passwordLogin = login.ok;
      exactAuthError = login.error;
    } else {
      exactAuthError = update.error;
    }
  }
}

console.log(
  JSON.stringify(
    {
      envEmailMatchesExistingUser: envEmailMatchesExistingUser ? "PASS" : "FAIL",
      emailConfirmed: emailConfirmed ? "PASS" : "FAIL",
      passwordLogin: passwordLogin ? "PASS" : "FAIL",
      exactAuthError,
    },
    null,
    2,
  ),
);
