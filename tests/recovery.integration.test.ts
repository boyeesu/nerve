import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import { getDb, getSqlClient } from "../db";
import { actionRequests, auditEvents, auditOutbox, rateLimitBuckets, revokedSessions } from "../db/schema";
import { activeSession, issueSessionCookieValue, revokeSession } from "../lib/auth";
import { claimLoginAttempt } from "../lib/rate-limit";
import { recoverBookkeeping } from "../lib/recovery";
import { auditSafely } from "../lib/audit";
import { deliverAction } from "../lib/action-delivery";
import { beginAction, createConnection, deleteConnection, finishAction, markActionDispatching } from "../lib/store";

const enabled = Boolean(process.env.NERVE_TEST_DATABASE_URL && process.env.DATABASE_URL === process.env.NERVE_TEST_DATABASE_URL);

test("database recovery fences stale deliveries, drains audits, revokes sessions, and throttles concurrency", {
  skip: !enabled ? "Run test:integration with a disposable local database." : false,
}, async (t) => {
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
  const db = getDb();
  const connection = await createConnection({
    name: "Recovery fixture", runtime: "hermes", endpoint: `http://127.0.0.1:1/${randomUUID()}`,
    credentials: { token: "fixture-only" }, status: "unknown",
  });
  t.after(async () => { await deleteConnection(connection.id); });
  const key = randomUUID();
  await beginAction({ idempotencyKey: key, connectionId: connection.id, agentId: "test",
    action: "message", actor: "fixture", request: { type: "message", input: "test", agentId: "test" } });
  const claims = await Promise.all(Array.from({ length: 16 }, () => markActionDispatching(key)));
  assert.equal(claims.filter(Boolean).length, 1, "Only one replica may dispatch a record.");
  const first = claims.find(Boolean)!;
  assert.equal(first.attempts, 1);
  await db.update(actionRequests).set({ updatedAt: new Date(Date.now() - 180_000) })
    .where(eq(actionRequests.idempotencyKey, key));

  const targetId = randomUUID();
  t.after(async () => { await db.delete(auditEvents).where(eq(auditEvents.targetId, targetId)); });
  await db.insert(auditOutbox).values({ event: {
    actor: "fixture", action: "fixture.audit", targetType: "test", targetId, outcome: "completed",
  } });
  await Promise.all([recoverBookkeeping(), recoverBookkeeping()]);
  const [recovered] = await db.select().from(actionRequests).where(eq(actionRequests.idempotencyKey, key));
  assert.equal(recovered.state, "unknown");
  assert.equal(await markActionDispatching(key), null, "Recovery must not automatically redeliver.");
  assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.targetId, targetId))).length, 1,
    "Concurrent recovery must drain each audit once.");
  const sql = getSqlClient();
  // A scoped trigger simulates an unavailable audit sink without breaking the primary database.
  await sql.unsafe(`create function nerve_fixture_audit_failure() returns trigger language plpgsql as $$
    begin if new.action = 'fixture.deferred' then raise exception 'fixture audit failure'; end if; return new; end $$`);
  await sql.unsafe("create trigger nerve_fixture_audit_failure before insert on audit_events for each row execute function nerve_fixture_audit_failure()");
  try {
    const warning = await auditSafely({ actor: "fixture", action: "fixture.deferred", targetType: "test", targetId, outcome: "completed" });
    assert.match(warning!, /queued for recovery/);
  } finally {
    await sql.unsafe("drop trigger nerve_fixture_audit_failure on audit_events");
    await sql.unsafe("drop function nerve_fixture_audit_failure()");
  }
  await recoverBookkeeping();
  assert.equal((await db.select().from(auditEvents).where(eq(auditEvents.targetId, targetId))).length, 2);
  const second = await markActionDispatching(key, true);
  assert.equal(second?.attempts, 2);
  assert.equal(await finishAction(key, "completed", { stale: true }, first.attempts), false);
  assert.equal(await finishAction(key, "completed", { run_id: "verified" }, second!.attempts), true);

  const revokedKey = randomUUID();
  await beginAction({ idempotencyKey: revokedKey, connectionId: connection.id, agentId: "test",
    action: "message", actor: "removed-actor", request: { type: "message", input: "test", agentId: "test" } });
  const revokedClaim = await markActionDispatching(revokedKey);
  const denied = await deliverAction(revokedClaim!, "default");
  assert.equal(denied.status, 409);
  assert.equal(denied.payload.state, "failed");
  assert.match(denied.payload.error!, /no longer has permission/);

  const cookie = issueSessionCookieValue();
  assert.deepEqual(await activeSession(cookie), { actor: "legacy-admin", role: "admin" });
  await revokeSession(cookie);
  assert.equal(await activeSession(cookie), null);

  const limitKey = `fixture-${randomUUID()}`;
  const slots = await Promise.all(Array.from({ length: 24 }, () => claimLoginAttempt(limitKey)));
  assert.equal(slots.filter(Boolean).length, 8, "Atomic login claims must enforce the limit under concurrency.");

  await db.insert(revokedSessions).values({ digest: targetId, expiresAt: new Date(0) });
  await db.insert(rateLimitBuckets).values({ keyHash: targetId, resetAt: new Date(0) });
  await recoverBookkeeping();
  assert.equal((await db.select().from(revokedSessions).where(eq(revokedSessions.digest, targetId))).length, 0);
  assert.equal((await db.select().from(rateLimitBuckets).where(and(eq(rateLimitBuckets.keyHash, targetId)))).length, 0);
  t.after(() => getSqlClient().end());
});
