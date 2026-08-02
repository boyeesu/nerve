import { runtimeAdapter } from "../../../../../lib/adapters";
import { requireApiAuth } from "../../../../../lib/auth";
import {
  getConnection,
  listSkillAssignments,
  toRuntimeConnection,
  upsertSkillAssignment,
  writeAudit,
} from "../../../../../lib/store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const agentId = new URL(request.url).searchParams.get("agentId")?.trim();
  if (!agentId) return Response.json({ error: "agentId is required." }, { status: 400 });
  const connection = await getConnection(id);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  try {
    const [skills, assignments] = await Promise.all([
      runtimeAdapter(connection.runtime).listSkills(toRuntimeConnection(connection), agentId),
      listSkillAssignments(id, agentId),
    ]);
    return Response.json({ skills, assignments });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load skills." },
      { status: 502 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
  const skillKey = typeof body?.skillKey === "string" ? body.skillKey.trim() : "";
  if (!agentId || !skillKey || agentId.length > 256 || skillKey.length > 256) {
    return Response.json({ error: "agentId and skillKey are required." }, { status: 400 });
  }
  const connection = await getConnection(id);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  try {
    const runtimeResult =
      connection.runtime === "openclaw"
        ? await runtimeAdapter(connection.runtime).installSkill(
            toRuntimeConnection(connection),
            agentId,
            skillKey,
          )
        : { assigned: true, note: "Hermes skill must already be installed on the runtime." };
    const assignment = await upsertSkillAssignment({
      connectionId: id,
      agentId,
      skillKey,
      metadata: { runtime: connection.runtime },
    });
    await writeAudit({
      actor: auth.actor,
      action: connection.runtime === "openclaw" ? "skill.install" : "skill.assign",
      targetType: "agent",
      targetId: agentId,
      outcome: "completed",
      metadata: { connectionId: id, skillKey },
    });
    return Response.json({ assignment, runtimeResult }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not add skill." },
      { status: 422 },
    );
  }
}
