import { requireApiAuth } from "../../../lib/auth";
import { createOpenClawDeviceIdentity } from "../../../lib/crypto";
import {
  runtimeAdapter,
  type RuntimeCredentials,
  type RuntimeKind,
} from "../../../lib/adapters";
import { assertSafeRuntimeEndpoint } from "../../../lib/network-policy";
import { createConnection, listConnections, writeAudit } from "../../../lib/store";

export const runtime = "nodejs";
const OPENCLAW_SCOPES = new Set([
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.admin",
]);

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 80);
}

export async function GET(request: Request) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  return Response.json({ connections: await listConnections() });
}

export async function POST(request: Request) {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  if (Number(request.headers.get("content-length") ?? 0) > 32_768) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const runtime = body?.runtime;
  const name = cleanName(body?.name);
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const rawEndpoint = String(body?.endpoint ?? "");
  if (
    (runtime !== "openclaw" && runtime !== "hermes") ||
    !name ||
    !token ||
    token.length > 16_384 ||
    rawEndpoint.length > 2_048
  ) {
    return Response.json(
      { error: "Name, runtime, endpoint, and token are required." },
      { status: 400 },
    );
  }

  let endpoint: string;
  try {
    endpoint = await assertSafeRuntimeEndpoint(rawEndpoint, runtime);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Invalid endpoint." },
      { status: 400 },
    );
  }

  const credentials: RuntimeCredentials =
    runtime === "openclaw"
      ? {
          token,
          scopes: Array.isArray(body?.scopes)
            ? body.scopes.filter(
                (scope): scope is string =>
                  typeof scope === "string" && OPENCLAW_SCOPES.has(scope),
              )
            : ["operator.read", "operator.write", "operator.approvals"],
          ...createOpenClawDeviceIdentity(),
        }
      : { token };

  let status = "connected";
  let capabilities: Record<string, unknown> = {};
  try {
    const probe = await runtimeAdapter(runtime as RuntimeKind).probe({
      runtime,
      endpoint,
      credentials,
    });
    status = probe.status;
    capabilities = probe.capabilities;
    if (probe.issuedDeviceToken) credentials.deviceToken = probe.issuedDeviceToken;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed.";
    if (runtime === "openclaw" && /pairing is required/i.test(message)) {
      status = "pending_pairing";
      capabilities = { pairingMessage: message };
    } else {
      return Response.json({ error: message }, { status: 422 });
    }
  }

  try {
    const connection = await createConnection({
      name,
      runtime,
      endpoint,
      credentials,
      status,
      capabilities,
    });
    await writeAudit({
      actor: auth.actor,
      action: "connection.create",
      targetType: "connection",
      targetId: connection.id,
      outcome: status,
      metadata: { runtime, endpoint },
    });
    return Response.json({ connection }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error && /unique|duplicate/i.test(error.message)
        ? "That runtime endpoint is already connected."
        : "Nerve could not save the connection.";
    return Response.json({ error: message }, { status: 409 });
  }
}
