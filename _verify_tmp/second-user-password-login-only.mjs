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

const env = readEnvLocal();
const envLoaded = Boolean(
  env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    && env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    && env.STUDYPILOT_E2E_OTHER_EMAIL?.trim()
    && env.STUDYPILOT_E2E_OTHER_PASSWORD?.trim(),
);

let loginPass = false;
let exactAuthError = "";

if (envLoaded) {
  const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await supabase.auth.signInWithPassword({
    email: env.STUDYPILOT_E2E_OTHER_EMAIL,
    password: env.STUDYPILOT_E2E_OTHER_PASSWORD,
  });

  loginPass = !error;
  exactAuthError = error?.message ?? "";
} else {
  exactAuthError = "Missing required environment variables";
}

let userExists = loginPass;
let emailConfirmed = loginPass;

if (!loginPass && /email not confirmed/i.test(exactAuthError)) {
  userExists = true;
  emailConfirmed = false;
}

console.log(
  JSON.stringify(
    {
      secondUserExists: userExists ? "PASS" : "FAIL",
      emailConfirmed: emailConfirmed ? "PASS" : "FAIL",
      envLoaded: envLoaded ? "PASS" : "FAIL",
      directPasswordLogin: loginPass ? "PASS" : "FAIL",
      exactAuthError,
      readyForRlsTest: loginPass ? "READY FOR RLS TEST" : "",
    },
    null,
    2,
  ),
);
