import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { missions } from "../../../../db/schema";
import { requireApiAuth } from "../../../../lib/auth";
import { auditSafely } from "../../../../lib/audit";
import { enqueueMission, validId } from "../../../../lib/missions";
import { readJsonObject } from "../../../../lib/request-body";
import { workerEnabled } from "../../../../lib/recovery";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(request, "actions.message");
  if (auth instanceof Response) return auth;
  if (!workerEnabled()) return Response.json({ error: "Background delivery is disabled." }, { status: 503 });
  const { id } = await context.params;
  if (!validId(id)) return Response.json({ error: "Mission not found." }, { status: 404 });
  const [mission] = await getDb().select().from(missions).where(and(
    eq(missions.id, id), eq(missions.workspaceId, auth.workspaceId ?? "default"),
  ));
  if (!mission) return Response.json({ error: "Mission not found." }, { status: 404 });
  const body = await readJsonObject(request, 1024);
  if (body instanceof Response) return body;
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length > 200 || body.confirmTargetCount !== mission.targets.length) {
    return Response.json({ error: "Confirm the target count and supply a unique launch key." }, { status: 400 });
  }
  let receipts;
  try { receipts = await enqueueMission(mission, auth.actor, key); }
  catch {
    return Response.json({ error: "The batch was not queued: a target is unavailable or the launch key conflicts. Check targets and delivery history before retrying." }, { status: 409 });
  }
  const warning = await auditSafely({ actor: auth.actor, action: "mission.launch", targetType: "mission",
    targetId: id, outcome: "queued", metadata: { workspaceId: mission.workspaceId, key, targets: receipts.length } });
  return Response.json({ receipts, warning, queued: true }, { status: 202 });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(request, "actions.message");
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  if (!validId(id)) return Response.json({ error: "Mission not found." }, { status: 404 });
  const removed = await getDb().delete(missions).where(and(
    eq(missions.id, id), eq(missions.workspaceId, auth.workspaceId ?? "default"),
  )).returning({ id: missions.id });
  if (!removed.length) return Response.json({ error: "Mission not found." }, { status: 404 });
  const warning = await auditSafely({ actor: auth.actor, action: "mission.delete", targetType: "mission",
    targetId: id, outcome: "completed", metadata: { workspaceId: auth.workspaceId ?? "default" } });
  return Response.json({ deleted: true, warning });
}
