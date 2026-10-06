import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { actionRequests, auditEvents } from "../../../../../../db/schema";
import { requireApiAuth } from "../../../../../../lib/auth";
import { validId } from "../../../../../../lib/missions";
import { readJsonObject } from "../../../../../../lib/request-body";
import { getConnection } from "../../../../../../lib/store";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string; actionId: string }> }) {
  const auth = await requireApiAuth(request, "connections.write");
  if (auth instanceof Response) return auth;
  const { id, actionId } = await context.params;
  if (!validId(actionId) || !(await getConnection(id, auth.workspaceId))) {
    return Response.json({ error: "Action not found." }, { status: 404 });
  }
  const body = await readJsonObject(request, 8192);
  if (body instanceof Response) return body;
  if (!["delivered", "not_delivered"].includes(String(body.observedOutcome)) ||
    typeof body.note !== "string" || body.note.trim().length < 10 || body.note.length > 2000) {
    return Response.json({ error: "Record the observed delivery outcome and a runtime evidence note (10–2000 characters)." }, { status: 400 });
  }
  const reconciliation = { observedOutcome: body.observedOutcome, note: body.note.trim(), actor: auth.actor, at: new Date().toISOString() };
  const changed = await getDb().transaction(async (tx) => {
    const [row] = await tx.select().from(actionRequests).where(and(
      eq(actionRequests.id, actionId), eq(actionRequests.connectionId, id), eq(actionRequests.state, "unknown"),
    )).for("update");
    if (!row) return false;
    await tx.update(actionRequests).set({
      state: "reconciled", updatedAt: new Date(), response: { ...row.response, reconciliation },
    }).where(eq(actionRequests.id, actionId));
    await tx.insert(auditEvents).values({
      actor: auth.actor, action: "action.reconcile", targetType: "action", targetId: actionId,
      outcome: "reconciled", metadata: { ...reconciliation, connectionId: id, workspaceId: auth.workspaceId ?? "default" },
    });
    return true;
  });
  if (!changed) return Response.json({ error: "Only an unknown action can be reconciled." }, { status: 409 });
  return Response.json({ state: "reconciled", reconciliation });
}
