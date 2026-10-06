import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postgres from "postgres";

test("worker upgrade quarantines legacy pending requests without touching saved outcomes", {
  skip: !process.env.NERVE_TEST_DATABASE_URL ? "Requires a disposable local database." : false,
}, async () => {
  const url = process.env.NERVE_TEST_DATABASE_URL!;
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname));
  const sql = postgres(url, { max: 1, ssl: false });
  try {
    // A session-local table shadows the real table, without modifying parallel fixtures.
    await sql`create temporary table action_requests (
      id text, state text, last_error text, updated_at timestamptz default now())`;
    await sql`insert into action_requests (id,state) values
      ('old-pending','requested'), ('accepted','completed'), ('uncertain','unknown'), ('in-flight','dispatching')`;
    await sql.unsafe(await readFile(new URL("../drizzle/0004_queue_upgrade_safety.sql", import.meta.url), "utf8"));
    const rows = await sql`select id,state,last_error from action_requests order by id`;
    assert.equal(rows.find((row) => row.id === "old-pending")?.state, "unknown");
    assert.match(rows.find((row) => row.id === "old-pending")!.last_error, /not automatically resent/);
    for (const [id, state] of [["accepted", "completed"], ["uncertain", "unknown"], ["in-flight", "dispatching"]]) {
      assert.equal(rows.find((row) => row.id === id)?.state, state);
      assert.equal(rows.find((row) => row.id === id)?.last_error, null);
    }
  } finally { await sql.end(); }
});
