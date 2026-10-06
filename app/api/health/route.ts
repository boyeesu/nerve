import { getSqlClient } from "../../../db";
import { authConfiguration } from "../../../lib/auth";
import { encryptionConfigured } from "../../../lib/crypto";

export const runtime = "nodejs";

export async function GET() {
  const auth = authConfiguration();
  let database = false;
  let databaseError: string | undefined;
  try {
    // A reachable but unmigrated database cannot serve authenticated requests safely.
    await getSqlClient()`
      select c.workspace_id, a.attempts, m.workspace_id, r.digest, o.event
      from connections c
      left join action_requests a on false
      left join missions m on false
      left join revoked_sessions r on false
      left join audit_outbox o on false
      limit 0`;
    database = true;
  } catch (error) {
    databaseError = error instanceof Error ? error.message : "Database check failed.";
  }

  const encryption = encryptionConfigured();
  const ready = auth.configured && database && encryption;
  return Response.json(
    {
      status: ready ? "ok" : "not_ready",
      version: process.env.NERVE_VERSION ?? "0.2.0",
      checks: {
        authentication: auth.configured,
        database,
        encryption,
      },
      ...(process.env.NODE_ENV !== "production" && databaseError
        ? { databaseError }
        : {}),
    },
    { status: ready ? 200 : 503 },
  );
}
