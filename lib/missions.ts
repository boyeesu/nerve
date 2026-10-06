import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { actionRequests, connections, missions, type MissionTarget } from "../db/schema";
import { sameActionRequest } from "./action-policy";

export function missionTargets(value: unknown): MissionTarget[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 25) return null;
  const seen = new Set<string>();
  const targets: MissionTarget[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" ||
      typeof item.connectionId !== "string" || !validId(item.connectionId) ||
      typeof item.agentId !== "string" || !item.agentId.trim() || item.agentId.length > 256) return null;
    const target = { connectionId: item.connectionId.toLowerCase(), agentId: item.agentId.trim() };
    const key = JSON.stringify(target);
    if (seen.has(key)) return null;
    seen.add(key);
    targets.push(target);
  }
  return targets;
}

export function validId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function enqueueMission(mission: typeof missions.$inferSelect, actor: string, key: string) {
  return getDb().transaction(async (tx) => {
    // Lock connections against deletion while validating and committing the entire batch.
    const available = await tx.select({ id: connections.id }).from(connections).where(and(
      eq(connections.workspaceId, mission.workspaceId), eq(connections.enabled, true),
      inArray(connections.id, mission.targets.map((target) => target.connectionId)),
    )).for("share");
    if (mission.targets.some((target) => !available.some((row) => row.id === target.connectionId))) {
      throw new Error("A mission connection is missing or disabled. No new commands were queued.");
    }
    const receipts = [];
    for (const target of mission.targets) {
      // Key is stable across replay; actor and payload are checked rather than hidden in the hash.
      const idempotencyKey = createHash("sha256")
        .update(JSON.stringify([mission.workspaceId, mission.id, key, target])).digest("hex");
      const request = { type: "message", agentId: target.agentId, input: mission.description };
      const [inserted] = await tx.insert(actionRequests).values({
        idempotencyKey, connectionId: target.connectionId, agentId: target.agentId,
        action: "message", requestedBy: actor, request,
      }).onConflictDoNothing().returning();
      const record = inserted ?? (await tx.select().from(actionRequests)
        .where(eq(actionRequests.idempotencyKey, idempotencyKey)))[0];
      if (!record || record.requestedBy !== actor || record.connectionId !== target.connectionId ||
        !sameActionRequest(record.request, request)) throw new Error("This launch key is already bound to another request.");
      receipts.push({ id: record.id, idempotencyKey, ...target, state: record.state });
    }
    return receipts;
  });
}
