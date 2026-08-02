import { requireApiAuth } from "../../../../lib/auth";
import { deleteConnection, writeAudit } from "../../../../lib/store";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const deleted = await deleteConnection(id);
  if (!deleted) return Response.json({ error: "Connection not found." }, { status: 404 });
  await writeAudit({
    actor: auth.actor,
    action: "connection.delete",
    targetType: "connection",
    targetId: id,
    outcome: "completed",
  });
  return new Response(null, { status: 204 });
}
