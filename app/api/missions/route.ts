import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { connections, missions } from "../../../db/schema";
import { requireApiAuth } from "../../../lib/auth";
import { auditSafely } from "../../../lib/audit";
import { missionTargets } from "../../../lib/missions";
import { readJsonObject } from "../../../lib/request-body";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const rows = await getDb().select().from(missions)
    .where(eq(missions.workspaceId, auth.workspaceId ?? "default"))
    .orderBy(desc(missions.createdAt)).limit(100);
  return Response.json({ missions: rows });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request, "actions.message");
  if (auth instanceof Response) return auth;
  const body = await readJsonObject(request, 131_072);
  if (body instanceof Response) return body;
  const targets = missionTargets(body.targets);
  if (!targets || typeof body.name !== "string" || !body.name.trim() || body.name.length > 120 ||
    typeof body.description !== "string" || !body.description.trim() || body.description.length > 65_536) {
    return Response.json({ error: "Provide a name, command, and 1–25 distinct agent targets." }, { status: 400 });
  }
  const workspaceId = auth.workspaceId ?? "default";
  const available = await getDb().select({ id: connections.id }).from(connections).where(and(
    eq(connections.workspaceId, workspaceId),
    inArray(connections.id, targets.map((target) => target.connectionId)),
  ));
  if (targets.some((target) => !available.some((connection) => connection.id === target.connectionId))) {
    return Response.json({ error: "A target connection is unavailable in this workspace." }, { status: 400 });
  }
  const [mission] = await getDb().insert(missions).values({
    workspaceId, name: body.name.trim(), description: body.description.trim(), targets, createdBy: auth.actor,
  }).returning();
  const warning = await auditSafely({ actor: auth.actor, action: "mission.create", targetType: "mission",
    targetId: mission.id, outcome: "completed", metadata: { workspaceId, targets: targets.length } });
  return Response.json({ mission, warning }, { status: 201 });
}
