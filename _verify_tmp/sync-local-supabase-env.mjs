import fs from "node:fs";

function readEnv(file) {
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match) continue;
    env[match[2]] = match[4];
  }
  return env;
}

const localPath = ".env.local";
const stagingPath = ".env.staging.local";
const staging = readEnv(stagingPath);
let local = fs.readFileSync(localPath, "utf8");

for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
  if (!staging[key]) throw new Error(`${key} is missing from ${stagingPath}`);
  const pattern = new RegExp(`^(\\s*${key}\\s*=\\s*).*$`, "m");
  if (!pattern.test(local)) throw new Error(`${key} is missing from ${localPath}`);
  local = local.replace(pattern, `$1${staging[key]}`);
}

fs.writeFileSync(localPath, local);

const host = new URL(staging.NEXT_PUBLIC_SUPABASE_URL.replace(/^["']|["']$/g, "")).host;
console.log(JSON.stringify({ updated: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], host }));
