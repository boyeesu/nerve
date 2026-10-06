import { auditSafely } from "../../../../../lib/audit";
import { runtimeAdapter } from "../../../../../lib/adapters";
import { requireApiAuth } from "../../../../../lib/auth";
import { readJsonObject } from "../../../../../lib/request-body";
import {
  getConnection,
  listSkillAssignments,
  toRuntimeConnection,
  upsertSkillAssignment,
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
  if (!agentId || agentId.length > 256) return Response.json({ error: "A valid agentId is required." }, { status: 400 });
  const connection = await getConnection(id, auth.workspaceId);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  if (!connection.enabled) {
    return Response.json({ error: "This connection is disabled." }, { status: 409 });
  }
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
  const auth = await requireApiAuth(request, "skills.write");
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const body = await readJsonObject(request, 16_384);
  if (body instanceof Response) return body;
  const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
  const skillKey = typeof body?.skillKey === "string" ? body.skillKey.trim() : "";
  if (!agentId || !skillKey || agentId.length > 256 || skillKey.length > 256) {
    return Response.json({ error: "agentId and skillKey are required." }, { status: 400 });
  }
  const connection = await getConnection(id, auth.workspaceId);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  if (!connection.enabled) {
    return Response.json({ error: "This connection is disabled." }, { status: 409 });
  }
  let runtimeResult: Record<string, unknown>;
  try {
    runtimeResult = connection.runtime === "openclaw"
      ? await runtimeAdapter(connection.runtime).installSkill(toRuntimeConnection(connection), agentId, skillKey)
      : { assigned: true, note: "Nerve-only assignment; Hermes configuration was not changed." };
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Skill operation outcome is unknown. Check the runtime before retrying.", state: "unknown" }, { status: 202 });
  }
  let assignment;
  try {
    assignment = await upsertSkillAssignment({ connectionId: id, agentId, skillKey, metadata: { runtime: connection.runtime } });
  } catch {
    return Response.json({ error: connection.runtime === "openclaw"
      ? "The runtime accepted the installation, but Nerve could not save the assignment. Inspect runtime skills before retrying."
      : "Nerve could not save the assignment. Refresh before retrying.", state: "unknown" }, { status: 202 });
  }
  const warning = await auditSafely({
    actor: auth.actor, action: connection.runtime === "openclaw" ? "skill.install" : "skill.assign",
    targetType: "agent", targetId: agentId, outcome: "completed", metadata: { connectionId: id, skillKey, workspaceId: auth.workspaceId ?? "default" },
  });
  return Response.json({ assignment, runtimeResult, warning }, { status: 201 });
}
