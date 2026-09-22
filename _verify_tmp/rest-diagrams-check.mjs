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
const endpoint = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/diagrams?select=id&limit=1`;

const response = await fetch(endpoint, {
  headers: {
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    Accept: "application/json",
  },
});

let body;
try {
  body = await response.json();
} catch {
  body = await response.text();
}

const safeBody =
  body && typeof body === "object" && !Array.isArray(body)
    ? {
        code: body.code,
        message: body.message,
        details: body.details,
        hint: body.hint,
      }
    : body;

console.log(
  JSON.stringify(
    {
      status: response.status,
      statusText: response.statusText,
      body: safeBody,
    },
    null,
    2,
  ),
);
