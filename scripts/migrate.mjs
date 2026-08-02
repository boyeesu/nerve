import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations.");
}

const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  ssl: process.env.DATABASE_SSL === "disable" ? false : "prefer",
});

try {
  await sql`select pg_advisory_lock(hashtext('nerve-schema-migrations'))`;
  await sql`
    create table if not exists nerve_schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `;

  const migrationDirectory = path.resolve("drizzle");
  const files = (await readdir(migrationDirectory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  for (const name of files) {
    const source = await readFile(path.join(migrationDirectory, name), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    const [existing] = await sql`
      select checksum from nerve_schema_migrations where name = ${name}
    `;
    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Migration ${name} changed after it was applied.`);
      }
      continue;
    }

    const statements = source
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    await sql.begin(async (transaction) => {
      for (const statement of statements) {
        await transaction.unsafe(statement);
      }
      await transaction`
        insert into nerve_schema_migrations (name, checksum)
        values (${name}, ${checksum})
      `;
    });
    process.stdout.write(`Applied ${name}\n`);
  }
} finally {
  await sql`select pg_advisory_unlock(hashtext('nerve-schema-migrations'))`.catch(() => undefined);
  await sql.end();
}
