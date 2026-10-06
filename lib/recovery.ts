import { and, eq, lt } from "drizzle-orm";
import { getDb, getSqlClient } from "../db";
import { actionRequests, auditEvents, auditOutbox, rateLimitBuckets, revokedSessions } from "../db/schema";
import type { AuditInput } from "./audit";
import { deliverAction } from "./action-delivery";
import { markActionDispatching } from "./store";

export function workerEnabled() {
  return process.env.NERVE_WORKER_ENABLED !== "false";
}

export async function recoverBookkeeping() {
  const db = getDb();
  // All runtime calls have a much shorter timeout. Never redispatch a stale claim.
  await db.update(actionRequests).set({
    state: "unknown", lastError: "Delivery was interrupted. Inspect the runtime before reconciliation.",
    updatedAt: new Date(),
  }).where(and(eq(actionRequests.state, "dispatching"),
    lt(actionRequests.updatedAt, new Date(Date.now() - 120_000))));
  await db.transaction(async (tx) => {
    const pending = await tx.select().from(auditOutbox).limit(100).for("update", { skipLocked: true });
    for (const item of pending) {
      const event = item.event as AuditInput;
      await tx.insert(auditEvents).values({ ...event, createdAt: item.createdAt });
      await tx.delete(auditOutbox).where(eq(auditOutbox.id, item.id));
    }
  });
  await db.delete(revokedSessions).where(lt(revokedSessions.expiresAt, new Date()));
  await db.delete(rateLimitBuckets).where(lt(rateLimitBuckets.resetAt, new Date()));
}

export async function recoveryTick() {
  await recoverBookkeeping();
  // The atomic per-record claim also arbitrates with live HTTP requests and other replicas.
  const sql = getSqlClient();
  const candidates = await sql`
    select a.idempotency_key, c.workspace_id from action_requests a
    join connections c on a.connection_id = c.id
    where a.state = 'requested' and a.created_at < now() - interval '5 seconds'
    order by a.created_at limit 20`;
  for (const candidate of candidates) {
    const claim = await markActionDispatching(candidate.idempotency_key);
    if (claim) await deliverAction(claim, candidate.workspace_id);
  }
}

const globalWorker = globalThis as typeof globalThis & { nerveRecoveryStarted?: boolean };
export function startRecoveryWorker() {
  if (!workerEnabled() || globalWorker.nerveRecoveryStarted) return;
  globalWorker.nerveRecoveryStarted = true;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await recoveryTick(); }
    catch { console.error("Nerve recovery failed; will retry on the next interval."); }
    finally { busy = false; }
  }, 5_000);
  timer.unref();
}
