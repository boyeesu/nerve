import { requireApiAuth } from "../../../../../../../lib/auth";
import { hermesRunEvents } from "../../../../../../../lib/adapters/hermes";
import { observationTarget } from "../../../../../../../lib/runtime-observation";
import { toRuntimeConnection } from "../../../../../../../lib/store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request, context: { params: Promise<{ id: string; actionId: string }> }) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id, actionId } = await context.params;
  const target = await observationTarget(id, actionId, auth.workspaceId);
  if (!target) return Response.json({ error: "Run not found or connection disabled." }, { status: 404 });
  if (target.connection.runtime !== "hermes" || !target.runId) {
    return Response.json({ error: "Use the runtime history view for this action." }, { status: 409 });
  }
  try {
    const stream = await hermesRunEvents(toRuntimeConnection(target.connection), target.runId, request);
    return new Response(stream, { headers: {
      "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no",
    } });
  } catch {
    return Response.json({ error: "Runtime event streaming unavailable. Use run status instead." }, { status: 502 });
  }
}
