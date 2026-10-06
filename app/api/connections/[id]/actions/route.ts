import { randomUUID } from "node:crypto";
import { canRetryAction, sameActionRequest } from "../../../../../lib/action-policy";
import { readJsonObject } from "../../../../../lib/request-body";
import { deliverAction } from "../../../../../lib/action-delivery";
import { workerEnabled } from "../../../../../lib/recovery";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { actionRequests } from "../../../../../db/schema";
import {
  hasPermission,
  permissionDenied,
  requireApiAuth,
  type NervePermission,
} from "../../../../../lib/auth";
import {
  beginAction,
  getConnection,
  markActionDispatching,
} from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const body = await readJsonObject(request, 131_072);
  if (body instanceof Response) return body;
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

  const permission: NervePermission =
    type === "message"
      ? "actions.message"
      : type === "stop"
        ? "actions.stop"
        : "approvals.write";
  if (!hasPermission(auth, permission)) return permissionDenied();
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
  for (const field of ["runId", "sessionId"] as const) {
    if (body[field] !== undefined &&
      (typeof body[field] !== "string" || !body[field].trim() || body[field].length > 256)) {
      return Response.json({ error: `A valid ${field} is required.` }, { status: 400 });
    }
  }

  const connection = await getConnection(id, auth.workspaceId);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  if (!connection.enabled) {
    return Response.json({ error: "This connection is disabled." }, { status: 409 });
  }
  if (connection.runtime === "hermes" && type === "stop" && !body.runId) {
    return Response.json({ error: "A Hermes run ID is required to stop a run." }, { status: 400 });
  }
  if (connection.runtime === "openclaw" && type === "approve" && !body.approvalKind) {
    return Response.json({ error: "OpenClaw approvalKind is required." }, { status: 400 });
  }
  const retryable = canRetryAction(connection.runtime, String(type));
  const persistedRequest: Record<string, unknown> = {
    type: String(type),
    agentId,
    ...(type === "message" ? { input: String(body?.input).trim() } : {}),
    ...(typeof body?.runId === "string" ? { runId: body.runId.trim() } : {}),
    ...(typeof body?.sessionId === "string"
      ? { sessionId: body.sessionId.trim() }
      : {}),
    ...(type === "approve" ? { decision: String(body?.decision) } : {}),
    ...(typeof body?.approvalKind === "string"
      ? { approvalKind: body.approvalKind }
      : {}),
  };
  const asyncDelivery = request.headers.get("prefer") === "respond-async";
  if (asyncDelivery && !workerEnabled()) return Response.json({ error: "Background delivery is disabled." }, { status: 503 });
  let claim;
  const started = await beginAction({
    idempotencyKey,
    connectionId: id,
    agentId,
    action: String(type),
    actor: auth.actor,
    request: persistedRequest,
  });
  if (!started.fresh) {
    if (
      !started.record ||
      started.record.connectionId !== id ||
      started.record.agentId !== agentId ||
      started.record.action !== type ||
      started.record.requestedBy !== auth.actor ||
      !sameActionRequest(started.record.request, persistedRequest)
    ) {
      return Response.json(
        { error: "That idempotency key is already bound to another action." },
        { status: 409 },
      );
    }
    const retryRequested = request.headers.get("x-nerve-retry") === "true";
    if (
      retryRequested &&
      (started.record?.state === "failed" || started.record?.state === "unknown")
    ) {
      if (!retryable) {
        return Response.json(
          { error: "This runtime action cannot be safely retried. Check the runtime before starting new work.", retryable: false },
          { status: 409 },
        );
      }
      claim = await markActionDispatching(idempotencyKey, true);
      if (!claim) {
        return Response.json({ error: "The action could not be claimed for retry." }, { status: 409 });
      }
    } else {
      return Response.json(
        {
          idempotencyKey,
          action: started.record,
          result: started.record.state === "completed" ? started.record.response : undefined,
          error: started.record.state === "completed" ? undefined : "This action is not complete. Check its status before retrying.",
          replayed: true,
          retryable,
        },
        { status: started.record?.state === "completed" ? 200 : 409 },
      );
    }
  } else {
    if (asyncDelivery) return Response.json({ idempotencyKey, state: "requested", queued: true }, { status: 202 });
    claim = await markActionDispatching(idempotencyKey);
    if (!claim) return Response.json({ error: "The action was claimed by the recovery worker. Check delivery history.", idempotencyKey }, { status: 409 });
  }
  const delivered = await deliverAction(claim!, auth.workspaceId ?? "default");
  return Response.json(delivered.payload, { status: delivered.status });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!(await getConnection(id, auth.workspaceId))) return Response.json({ error: "Connection not found." }, { status: 404 });
  const agentId = new URL(request.url).searchParams.get("agentId");
  const actions = await getDb().select().from(actionRequests).where(and(
    eq(actionRequests.connectionId, id), agentId ? eq(actionRequests.agentId, agentId) : undefined,
  )).orderBy(desc(actionRequests.createdAt)).limit(50);
  return Response.json({ actions });
}
