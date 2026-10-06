import { auditSafely } from "../../../../lib/audit";
import { requireApiAuth } from "../../../../lib/auth";
import { deleteConnection } from "../../../../lib/store";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request, "connections.write");
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const deleted = await deleteConnection(id, auth.workspaceId);
  if (!deleted) return Response.json({ error: "Connection not found." }, { status: 404 });
  const warning = await auditSafely({
    actor: auth.actor,
    action: "connection.delete",
    targetType: "connection",
    targetId: id,
    outcome: "completed",
    metadata: { workspaceId: auth.workspaceId ?? "default" },
  });
  if (warning) return Response.json({ deleted: true, warning });
  return new Response(null, { status: 204 });
}
