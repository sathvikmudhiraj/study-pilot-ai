import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_EMAIL = "admin01@gmail.com";
const ENV_FILE = ".env.local";

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ENV_FILE);
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalIndex = line.indexOf("=");
    if (equalIndex <= 0) continue;

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

async function findUserByEmail(supabase, email) {
  const normalizedEmail = email.toLowerCase();
  const matches = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    const users = data?.users ?? [];
    for (const user of users) {
      if (user.email?.toLowerCase() === normalizedEmail) {
        matches.push(user);
      }
    }

    if (users.length < perPage) break;
    page += 1;
  }

  if (matches.length === 0) {
    throw new Error("Target user was not found.");
  }
  if (matches.length > 1) {
    throw new Error("Multiple users matched the target email.");
  }

  return matches[0];
}

async function main() {
  loadLocalEnv();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured.");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const user = await findUserByEmail(supabase, TARGET_EMAIL);
  const existingAppMetadata =
    user.app_metadata && typeof user.app_metadata === "object"
      ? user.app_metadata
      : {};

  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...existingAppMetadata,
      role: "admin",
    },
  });
  if (error) throw error;

  const updatedUser = data.user;
  const role = updatedUser?.app_metadata?.role;
  if (role !== "admin") {
    throw new Error("Admin role verification failed.");
  }

  console.log(`email=${updatedUser.email}`);
  console.log(`user_id=${updatedUser.id}`);
  console.log(`app_metadata.role=${role}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Admin role update failed.");
  process.exitCode = 1;
});
