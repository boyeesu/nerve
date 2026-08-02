import { runtimeAdapter } from "../../../../../lib/adapters";
import { requireApiAuth } from "../../../../../lib/auth";
import { getConnection, toRuntimeConnection } from "../../../../../lib/store";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const connection = await getConnection(id);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  try {
    const agents = await runtimeAdapter(connection.runtime).listAgents(
      toRuntimeConnection(connection),
    );
    return Response.json({ agents });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load agents." },
      { status: 502 },
    );
  }
}
