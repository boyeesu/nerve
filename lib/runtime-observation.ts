import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { actionRequests } from "../db/schema";
import { validId } from "./missions";
import { getConnection } from "./store";

/** Run identifiers come from a saved receipt, never an arbitrary URL parameter. */
export async function observationTarget(connectionId: string, actionId: string, workspaceId?: string) {
  if (!validId(actionId)) return null;
  const connection = await getConnection(connectionId, workspaceId);
  if (!connection || !connection.enabled) return null;
  const [action] = await getDb().select().from(actionRequests).where(and(
    eq(actionRequests.id, actionId), eq(actionRequests.connectionId, connectionId), eq(actionRequests.action, "message"),
  ));
  if (!action) return null;
  const runId = action.response?.run_id ?? action.response?.runId;
  return { connection, action, runId: typeof runId === "string" && runId.length <= 256 ? runId : undefined };
}
