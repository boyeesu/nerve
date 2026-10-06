import { getDb } from "../db";
import { auditOutbox } from "../db/schema";
import { writeAudit } from "./store";

export type AuditInput = Parameters<typeof writeAudit>[0];

/** A completed operation must not become a failure because its audit sink failed. */
export async function auditSafely(event: AuditInput): Promise<string | undefined> {
  try {
    await writeAudit(event);
  } catch {
    try {
      await getDb().insert(auditOutbox).values({ event });
      console.error("Nerve audit deferred.", { action: event.action, targetId: event.targetId });
      return "The operation completed. Its audit entry is queued for recovery.";
    } catch {
      console.error("Nerve audit unavailable.", { action: event.action, targetId: event.targetId });
      return "The operation completed, but its audit entry could not be saved. Contact your administrator.";
    }
  }
}
