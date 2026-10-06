import { requireApiAuth } from "../../../../../../../lib/auth";
import { hermesRunStatus } from "../../../../../../../lib/adapters/hermes";
import { openClawHistory } from "../../../../../../../lib/adapters/openclaw";
import { observationTarget } from "../../../../../../../lib/runtime-observation";
import { toRuntimeConnection } from "../../../../../../../lib/store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string; actionId: string }> }) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id, actionId } = await context.params;
  const target = await observationTarget(id, actionId, auth.workspaceId);
  if (!target) return Response.json({ error: "Run not found or connection disabled." }, { status: 404 });
  try {
    const connection = toRuntimeConnection(target.connection);
    if (connection.runtime === "hermes") {
      if (!target.runId) return Response.json({ error: "No runtime run ID was saved. Inspect delivery history." }, { status: 409 });
      return Response.json({ kind: "run", snapshot: await hermesRunStatus(connection, target.runId) });
    }
    return Response.json({ kind: "history", snapshot: await openClawHistory(connection, target.action.agentId,
      typeof target.action.request.sessionId === "string" ? target.action.request.sessionId : undefined) });
  } catch {
    return Response.json({ error: "Runtime output is unavailable. The runtime may be offline or this version may not support observation." }, { status: 502 });
  }
}
