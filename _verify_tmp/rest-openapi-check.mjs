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

const env = readEnvFiles([".env.staging.local", ".env.local"]);
const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`, {
  headers: {
    apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
    Accept: "application/openapi+json",
  },
});
const body = await response.json();
const paths = Object.keys(body.paths || {});
console.log(
  JSON.stringify(
    {
      status: response.status,
      hasDiagramsPath: paths.includes("/diagrams"),
      diagramsMethods: body.paths?.["/diagrams"] ? Object.keys(body.paths["/diagrams"]).sort() : [],
    },
    null,
    2,
  ),
);
