import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import postgres from "postgres";

// Explicit opt-in only. Never reuse a deployment's DATABASE_URL implicitly.
const sourceUrl = process.env.NERVE_DRILL_SOURCE_URL;
const targetUrl = process.env.NERVE_DRILL_TARGET_URL;
function validatedUrl(value) {
  if (!value) throw new Error("Set both NERVE_DRILL_SOURCE_URL and NERVE_DRILL_TARGET_URL.");
  const url = new URL(value);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
    throw new Error("This rehearsal is restricted to disposable local databases.");
  }
  return url;
}
const source = validatedUrl(sourceUrl);
const target = validatedUrl(targetUrl);
if (source.host === target.host && source.pathname === target.pathname) throw new Error("Source and target must differ.");
const sourceDb = postgres(sourceUrl, { max: 1, ssl: false });
const targetDb = postgres(targetUrl, { max: 1, ssl: false });
function pgEnv(url) {
  return { ...process.env, PGHOST: url.hostname.replace(/^\[|\]$/g, ""), PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGSSLMODE: "disable" };
}
function completed(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("PostgreSQL backup/restore process failed.")));
  });
}
try {
  const existing = await targetDb`select tablename from pg_tables where schemaname = 'public'`;
  if (existing.length) throw new Error("Restore target is not empty. Refusing to modify it.");
  const before = await sourceDb`select name, checksum from nerve_schema_migrations order by name`;
  const dump = spawn(process.env.PG_DUMP_BIN || "pg_dump", ["--format=custom", "--no-owner", "--no-acl"],
    { env: pgEnv(source), stdio: ["ignore", "pipe", "inherit"] });
  const restore = spawn(process.env.PG_RESTORE_BIN || "pg_restore", ["--dbname", target.pathname.slice(1),
    "--no-owner", "--no-acl", "--exit-on-error", "--single-transaction"],
  { env: pgEnv(target), stdio: ["pipe", "ignore", "inherit"] });
  try { await Promise.all([completed(dump), completed(restore), pipeline(dump.stdout, restore.stdin)]); }
  finally { dump.kill(); restore.kill(); }
  const after = await targetDb`select name, checksum from nerve_schema_migrations order by name`;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Restored migration checksums do not match.");
  const tables = ["connections", "agent_skill_assignments", "action_requests", "audit_events",
    "rate_limit_buckets", "revoked_sessions", "missions", "audit_outbox"];
  for (const table of tables) {
    // Table names are a fixed allowlist, not user input.
    const [a] = await sourceDb.unsafe(`select count(*)::int as count, md5(coalesce(string_agg(row_to_json(t)::text, '' order by row_to_json(t)::text), '')) as digest from "${table}" t`);
    const [b] = await targetDb.unsafe(`select count(*)::int as count, md5(coalesce(string_agg(row_to_json(t)::text, '' order by row_to_json(t)::text), '')) as digest from "${table}" t`);
    if (a.count !== b.count || a.digest !== b.digest) throw new Error(`Restored contents do not match: ${table}`);
  }
  console.log("Restore rehearsal passed: migration checksums and all eight application tables match.");
  console.log("Keep the encryption key separately; verify decryption and hosted backup procedures before production.");
} finally {
  await Promise.all([sourceDb.end(), targetDb.end()]);
}
