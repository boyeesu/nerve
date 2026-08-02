import { randomUUID } from "node:crypto";
import { runtimeAdapter, type AgentAction } from "../../../../../lib/adapters";
import { requireApiAuth } from "../../../../../lib/auth";
import {
  beginAction,
  finishAction,
  getConnection,
  toRuntimeConnection,
  writeAudit,
} from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  if (Number(request.headers.get("content-length") ?? 0) > 131_072) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const type = body?.type;
  const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
  const suppliedKey = request.headers.get("idempotency-key")?.trim();
  const idempotencyKey = suppliedKey || randomUUID();
  if (
    !["message", "stop", "approve"].includes(String(type)) ||
    !agentId ||
    agentId.length > 256
  ) {
    return Response.json({ error: "A valid action type and agentId are required." }, { status: 400 });
  }
  if (idempotencyKey.length > 200) {
    return Response.json({ error: "Idempotency key is too long." }, { status: 400 });
  }
  if (
    type === "message" &&
    (typeof body?.input !== "string" ||
      !body.input.trim() ||
      body.input.length > 65_536)
  ) {
    return Response.json({ error: "Message input is required." }, { status: 400 });
  }
  if (type === "approve" && (typeof body?.runId !== "string" || !body.runId.trim())) {
    return Response.json({ error: "runId is required for approval actions." }, { status: 400 });
  }
  if (
    type === "approve" &&
    !["approve", "deny"].includes(String(body?.decision))
  ) {
    return Response.json(
      { error: "Approval decision must be approve or deny." },
      { status: 400 },
    );
  }
  if (
    body?.approvalKind !== undefined &&
    !["exec", "plugin", "system-agent"].includes(String(body.approvalKind))
  ) {
    return Response.json({ error: "Invalid approvalKind." }, { status: 400 });
  }

  const connection = await getConnection(id);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  const action = { ...body, type, agentId, idempotencyKey } as AgentAction;
  const started = await beginAction({
    idempotencyKey,
    connectionId: id,
    agentId,
    action: String(type),
    actor: auth.actor,
    request: {
      type: String(type),
      agentId,
      runId: typeof body?.runId === "string" ? body.runId : undefined,
      sessionId: typeof body?.sessionId === "string" ? body.sessionId : undefined,
    },
  });
  if (!started.fresh) {
    return Response.json(
      { action: started.record, replayed: true },
      { status: started.record?.state === "completed" ? 200 : 409 },
    );
  }

  try {
    const result = await runtimeAdapter(connection.runtime).act(
      toRuntimeConnection(connection),
      action,
    );
    await finishAction(idempotencyKey, "completed", result);
    await writeAudit({
      actor: auth.actor,
      action: `agent.${type}`,
      targetType: "agent",
      targetId: agentId,
      outcome: "completed",
      metadata: { connectionId: id, idempotencyKey },
    });
    return Response.json({ idempotencyKey, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent action failed.";
    await finishAction(idempotencyKey, "failed", { error: message });
    await writeAudit({
      actor: auth.actor,
      action: `agent.${type}`,
      targetType: "agent",
      targetId: agentId,
      outcome: "failed",
      metadata: { connectionId: id, idempotencyKey },
    });
    return Response.json({ error: message, idempotencyKey }, { status: 502 });
  }
}
