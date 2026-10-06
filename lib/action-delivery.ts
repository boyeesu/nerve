import type { actionRequests } from "../db/schema";
import { runtimeAdapter, type AgentAction } from "./adapters";
import { auditSafely } from "./audit";
import { canRetryAction } from "./action-policy";
import { actorCanDispatch } from "./auth";
import { finishAction, getConnection, toRuntimeConnection } from "./store";

type ActionRecord = typeof actionRequests.$inferSelect;

/** A claim's attempt counter fences off a late worker after recovery or retry. */
export async function deliverAction(record: ActionRecord, workspaceId: string) {
  const key = record.idempotencyKey;
  let result: Record<string, unknown>;
  let enteredRuntime = false;
  let runtime: "hermes" | "openclaw" | undefined;
  try {
    if (!actorCanDispatch(record.requestedBy, workspaceId, record.action)) {
      throw new Error("The requesting actor no longer has permission to deliver this command.");
    }
    const connection = await getConnection(record.connectionId, workspaceId);
    if (!connection || !connection.enabled) throw new Error("Connection is missing or disabled.");
    runtime = connection.runtime;
    enteredRuntime = true;
    result = await runtimeAdapter(connection.runtime).act(toRuntimeConnection(connection),
      { ...record.request, idempotencyKey: key } as AgentAction);
  } catch (error) {
    // A transport, parsing or runtime error does not prove that a mutation was rejected.
    const state = enteredRuntime ? "unknown" : "failed";
    const message = error instanceof Error ? error.message : "Agent action failed.";
    try {
      await finishAction(key, state, { error: message }, record.attempts);
    } catch {
      console.error("Nerve could not save action outcome.", { idempotencyKey: key });
    }
    const warning = await auditSafely({
      actor: record.requestedBy, action: `agent.${record.action}`, targetType: "agent",
      targetId: record.agentId, outcome: state,
      metadata: { connectionId: record.connectionId, workspaceId, idempotencyKey: key },
    });
    return { status: enteredRuntime ? 202 : 409, payload: {
      error: message, idempotencyKey: key, state, warning,
      retryable: runtime ? canRetryAction(runtime, record.action) : false,
    } };
  }
  try {
    const saved = await finishAction(key, "completed", result, record.attempts);
    if (!saved) throw new Error("Delivery claim expired.");
  } catch {
    return { status: 202, payload: {
      error: "The runtime accepted this action, but its receipt could not be saved. Inspect the runtime before sending again.",
      idempotencyKey: key, state: "unknown", retryable: false,
    } };
  }
  const warning = await auditSafely({
    actor: record.requestedBy, action: `agent.${record.action}`, targetType: "agent",
    targetId: record.agentId, outcome: "completed",
    metadata: { connectionId: record.connectionId, workspaceId, idempotencyKey: key },
  });
  return { status: 200, payload: { idempotencyKey: key, result, warning } };
}
