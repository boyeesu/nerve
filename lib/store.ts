import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
  workspaceId: string;
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
    workspaceId: row.workspaceId,
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

export async function listConnections(workspaceId = "default"): Promise<StoredConnection[]> {
  const rows = await getDb().select().from(connections).where(eq(connections.workspaceId, workspaceId)).orderBy(desc(connections.createdAt));
  return rows.map(publicConnection);
}

export async function getConnection(
  id: string,
  workspaceId = "default",
): Promise<(StoredConnection & { credentials: RuntimeCredentials }) | null> {
  if (!isConnectionId(id)) return null;
  const [row] = await getDb()
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.workspaceId, workspaceId)))
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
  workspaceId?: string;
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
      workspaceId: input.workspaceId ?? "default",
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

export async function findConnectionByEndpoint(
  runtime: RuntimeKind,
  endpoint: string,
  workspaceId = "default",
): Promise<StoredConnection | null> {
  const [row] = await getDb()
    .select()
    .from(connections)
    .where(and(eq(connections.workspaceId, workspaceId), eq(connections.runtime, runtime), eq(connections.endpoint, endpoint)))
    .limit(1);
  return row ? publicConnection(row) : null;
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

export async function deleteConnection(id: string, workspaceId = "default"): Promise<boolean> {
  if (!isConnectionId(id)) return false;
  const rows = await getDb()
    .delete(connections)
    .where(and(eq(connections.id, id), eq(connections.workspaceId, workspaceId)))
    .returning({ id: connections.id });
  return rows.length > 0;
}

function isConnectionId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
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
  state: "completed" | "failed" | "unknown",
  response: Record<string, unknown>,
  attempt: number,
) {
  const rows = await getDb()
    .update(actionRequests)
    .set({
      state,
      response,
      lastError: state === "completed" ? null : String(response.error ?? "Action outcome is unknown."),
      updatedAt: new Date(),
    })
    .where(and(
      eq(actionRequests.idempotencyKey, idempotencyKey),
      eq(actionRequests.state, "dispatching"),
      eq(actionRequests.attempts, attempt),
    )).returning({ id: actionRequests.id });
  return rows.length === 1;
}

export async function markActionDispatching(
  idempotencyKey: string,
  allowRetry = false,
) {
  const allowedStates = allowRetry ? ["failed", "unknown"] : ["requested"];
  const rows = await getDb()
    .update(actionRequests)
    .set({
      state: "dispatching",
      attempts: sql`${actionRequests.attempts} + 1`,
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(actionRequests.idempotencyKey, idempotencyKey),
        inArray(actionRequests.state, allowedStates),
      ),
    )
    .returning();
  return rows[0] ?? null;
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
