import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  actionRequests,
  agentSkillAssignments,
  auditEvents,
  connections,
} from "../db/schema";
import { decryptJson, encryptJson } from "./crypto";
import type { RuntimeConnection, RuntimeCredentials, RuntimeKind } from "./adapters";

export type StoredConnection = {
  id: string;
  name: string;
  runtime: RuntimeKind;
  endpoint: string;
  status: string;
  enabled: boolean;
  capabilities: Record<string, unknown>;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function publicConnection(
  row: typeof connections.$inferSelect,
): StoredConnection {
  return {
    id: row.id,
    name: row.name,
    runtime: row.runtime,
    endpoint: row.endpoint,
    status: row.status,
    enabled: row.enabled,
    capabilities: row.capabilities,
    lastSeenAt: row.lastSeenAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listConnections(): Promise<StoredConnection[]> {
  const rows = await getDb().select().from(connections).orderBy(desc(connections.createdAt));
  return rows.map(publicConnection);
}

export async function getConnection(
  id: string,
): Promise<(StoredConnection & { credentials: RuntimeCredentials }) | null> {
  const [row] = await getDb()
    .select()
    .from(connections)
    .where(eq(connections.id, id))
    .limit(1);
  if (!row) return null;
  return {
    ...publicConnection(row),
    credentials: decryptJson<RuntimeCredentials>(
      row.encryptedCredentials,
    ),
  };
}

export async function createConnection(input: {
  name: string;
  runtime: RuntimeKind;
  endpoint: string;
  credentials: RuntimeCredentials;
  status: string;
  capabilities?: Record<string, unknown>;
}): Promise<StoredConnection> {
  const [row] = await getDb()
    .insert(connections)
    .values({
      name: input.name,
      runtime: input.runtime,
      endpoint: input.endpoint,
      encryptedCredentials: encryptJson(input.credentials),
      status: input.status,
      capabilities: input.capabilities ?? {},
      lastSeenAt: input.status === "connected" ? new Date() : null,
    })
    .returning();
  return publicConnection(row);
}

export async function updateConnectionProbe(
  id: string,
  input: {
    status: string;
    capabilities?: Record<string, unknown>;
    credentials?: RuntimeCredentials;
  },
): Promise<void> {
  await getDb()
    .update(connections)
    .set({
      status: input.status,
      capabilities: input.capabilities,
      encryptedCredentials: input.credentials
        ? encryptJson(input.credentials)
        : undefined,
      lastSeenAt: input.status === "connected" ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(connections.id, id));
}

export async function deleteConnection(id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(connections)
    .where(eq(connections.id, id))
    .returning({ id: connections.id });
  return rows.length > 0;
}

export async function listSkillAssignments(connectionId: string, agentId: string) {
  return getDb()
    .select()
    .from(agentSkillAssignments)
    .where(
      and(
        eq(agentSkillAssignments.connectionId, connectionId),
        eq(agentSkillAssignments.agentId, agentId),
      ),
    );
}

export async function upsertSkillAssignment(input: {
  connectionId: string;
  agentId: string;
  skillKey: string;
  metadata?: Record<string, unknown>;
}) {
  const [row] = await getDb()
    .insert(agentSkillAssignments)
    .values({
      connectionId: input.connectionId,
      agentId: input.agentId,
      skillKey: input.skillKey,
      metadata: input.metadata ?? {},
    })
    .onConflictDoUpdate({
      target: [
        agentSkillAssignments.connectionId,
        agentSkillAssignments.agentId,
        agentSkillAssignments.skillKey,
      ],
      set: { enabled: true, metadata: input.metadata ?? {}, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function beginAction(input: {
  idempotencyKey: string;
  connectionId: string;
  agentId: string;
  action: string;
  actor: string;
  request: Record<string, unknown>;
}) {
  const inserted = await getDb()
    .insert(actionRequests)
    .values({
      idempotencyKey: input.idempotencyKey,
      connectionId: input.connectionId,
      agentId: input.agentId,
      action: input.action,
      requestedBy: input.actor,
      request: input.request,
    })
    .onConflictDoNothing({ target: actionRequests.idempotencyKey })
    .returning();
  if (inserted[0]) return { fresh: true, record: inserted[0] };
  const [existing] = await getDb()
    .select()
    .from(actionRequests)
    .where(eq(actionRequests.idempotencyKey, input.idempotencyKey))
    .limit(1);
  return { fresh: false, record: existing };
}

export async function finishAction(
  idempotencyKey: string,
  state: "completed" | "failed",
  response: Record<string, unknown>,
) {
  await getDb()
    .update(actionRequests)
    .set({ state, response, updatedAt: new Date() })
    .where(eq(actionRequests.idempotencyKey, idempotencyKey));
}

export async function writeAudit(input: {
  actor: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: string;
  metadata?: Record<string, unknown>;
}) {
  await getDb().insert(auditEvents).values({
    actor: input.actor,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    outcome: input.outcome,
    metadata: input.metadata ?? {},
  });
}

export function toRuntimeConnection(
  connection: StoredConnection & { credentials: RuntimeCredentials },
): RuntimeConnection {
  return {
    id: connection.id,
    runtime: connection.runtime,
    endpoint: connection.endpoint,
    credentials: connection.credentials,
  };
}
