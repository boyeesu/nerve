import { getSqlClient } from "../../../db";
import { authConfiguration } from "../../../lib/auth";
import { encryptionConfigured } from "../../../lib/crypto";

export const runtime = "nodejs";

export async function GET() {
  const auth = authConfiguration();
  let database = false;
  let databaseError: string | undefined;
  try {
    await getSqlClient()`select 1`;
    database = true;
  } catch (error) {
    databaseError = error instanceof Error ? error.message : "Database check failed.";
  }

  const encryption = encryptionConfigured();
  const ready = auth.configured && database && encryption;
  return Response.json(
    {
      status: ready ? "ok" : "not_ready",
      version: process.env.NERVE_VERSION ?? "0.1.0",
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
