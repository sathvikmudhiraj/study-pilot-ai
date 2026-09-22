import fs from "node:fs";
import postgres from "postgres";

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

function sanitizeMessage(message = "") {
  return message.replace(/postgres:\/\/[^\s]+/g, "[redacted-db-url]");
}

const env = readEnvFiles([".env.local", ".env.staging.local"]);

if (!env.SUPABASE_DB_URL) {
  console.log(JSON.stringify({ ok: false, error: "SUPABASE_DB_URL not configured" }, null, 2));
  process.exit(2);
}

function connectionUrl() {
  const direct = new URL(env.SUPABASE_DB_URL);
  if (!fs.existsSync("supabase/.temp/pooler-url")) return direct.toString();

  const pooler = new URL(fs.readFileSync("supabase/.temp/pooler-url", "utf8").trim());
  const projectRef = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host.split(".")[0];
  if (pooler.username === "postgres" && projectRef) pooler.username = `postgres.${projectRef}`;
  if (!pooler.password && direct.password) pooler.password = direct.password;
  return pooler.toString();
}

const sql = postgres(connectionUrl(), {
  ssl: "require",
  max: 1,
  connect_timeout: 20,
});

try {
  const out = {};
  out.current = await sql`select current_database() as database, current_schema() as schema`;
  out.projectUrlHost = new URL(env.NEXT_PUBLIC_SUPABASE_URL).host;
  out.table = await sql`
    select table_schema, table_name, table_type
    from information_schema.tables
    where table_schema = 'public' and table_name = 'diagrams'
  `;
  out.columns = await sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'diagrams'
    order by ordinal_position
  `;
  out.rls = await sql`
    select schemaname, tablename, rowsecurity as rls_enabled, forcerowsecurity as force_rls
    from pg_tables
    where schemaname = 'public' and tablename = 'diagrams'
  `;
  out.policies = await sql`
    select policyname, cmd, roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and tablename = 'diagrams'
    order by policyname
  `;
  out.grants = await sql`
    select grantee, privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'diagrams'
      and grantee in ('anon', 'authenticated', 'service_role')
    order by grantee, privilege_type
  `;
  out.migrations = await sql`
    select version, name, inserted_at
    from supabase_migrations.schema_migrations
    where version >= '20260921000000'
    order by version
  `;
  out.pgrstSettings = await sql`
    select
      current_setting('pgrst.db_schemas', true) as db_schemas,
      current_setting('pgrst.db_anon_role', true) as anon_role
  `;

  console.log(JSON.stringify(out, null, 2));
} catch (error) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        error: error?.code || error?.name,
        message: sanitizeMessage(error?.message),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await sql.end();
}
