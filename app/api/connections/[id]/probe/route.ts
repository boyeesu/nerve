import { runtimeAdapter, type ConnectionProbe } from "../../../../../lib/adapters";
import { requireApiAuth } from "../../../../../lib/auth";
import { auditSafely } from "../../../../../lib/audit";
import { getConnection, toRuntimeConnection, updateConnectionProbe } from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(request, "connections.write");
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const connection = await getConnection(id, auth.workspaceId);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  if (!connection.enabled) return Response.json({ error: "This connection is disabled." }, { status: 409 });
  let probe: ConnectionProbe;
  try {
    probe = await runtimeAdapter(connection.runtime).probe(toRuntimeConnection(connection));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed.";
    const status = /pairing is required/i.test(message) ? "pending_pairing" : "offline";
    await updateConnectionProbe(id, {
      status, capabilities: status === "pending_pairing" ? { pairingMessage: message } : undefined,
    }).catch(() => console.error("Nerve could not persist failed probe.", { id }));
    return Response.json({ error: message, status }, { status: 422 });
  }
  try {
    await updateConnectionProbe(id, {
      status: probe.status, capabilities: probe.capabilities,
      credentials: probe.issuedDeviceToken ? { ...connection.credentials, deviceToken: probe.issuedDeviceToken } : connection.credentials,
    });
  } catch {
    return Response.json({ error: "Runtime connection succeeded, but its state could not be saved. Refresh before retrying.", state: "unknown" }, { status: 202 });
  }
  const warning = await auditSafely({ actor: auth.actor, action: "connection.probe", targetType: "connection", targetId: id, outcome: probe.status });
  // Never expose a newly issued device token to the browser.
  return Response.json({ probe: { status: probe.status, capabilities: probe.capabilities }, warning });
}
