import { runtimeAdapter } from "../../../../../lib/adapters";
import { requireApiAuth } from "../../../../../lib/auth";
import {
  getConnection,
  toRuntimeConnection,
  updateConnectionProbe,
  writeAudit,
} from "../../../../../lib/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  const { id } = await context.params;
  const connection = await getConnection(id);
  if (!connection) return Response.json({ error: "Connection not found." }, { status: 404 });
  try {
    const probe = await runtimeAdapter(connection.runtime).probe(toRuntimeConnection(connection));
    const credentials = probe.issuedDeviceToken
      ? { ...connection.credentials, deviceToken: probe.issuedDeviceToken }
      : connection.credentials;
    await updateConnectionProbe(id, {
      status: probe.status,
      capabilities: probe.capabilities,
      credentials,
    });
    await writeAudit({
      actor: auth.actor,
      action: "connection.probe",
      targetType: "connection",
      targetId: id,
      outcome: probe.status,
    });
    return Response.json({ probe });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed.";
    const status = /pairing is required/i.test(message) ? "pending_pairing" : "offline";
    await updateConnectionProbe(id, { status });
    return Response.json({ error: message, status }, { status: 422 });
  }
}
