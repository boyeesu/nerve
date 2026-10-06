import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: text("workspace_id").notNull().default("default"),
    name: text("name").notNull(),
    runtime: text("runtime", { enum: ["openclaw", "hermes"] }).notNull(),
    endpoint: text("endpoint").notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    status: text("status").notNull().default("unknown"),
    capabilities: jsonb("capabilities").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("connections_workspace_endpoint_idx").on(table.workspaceId, table.runtime, table.endpoint),
    index("connections_workspace_idx").on(table.workspaceId),
    index("connections_status_idx").on(table.status),
  ],
);

export const agentSkillAssignments = pgTable(
  "agent_skill_assignments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    skillKey: text("skill_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("agent_skill_assignments_target_idx").on(
      table.connectionId,
      table.agentId,
      table.skillKey,
    ),
  ],
);

export const actionRequests = pgTable(
  "action_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: text("idempotency_key").notNull(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    action: text("action").notNull(),
    state: text("state").notNull().default("requested"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    requestedBy: text("requested_by").notNull(),
    request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
    response: jsonb("response").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("action_requests_idempotency_idx").on(table.idempotencyKey),
    index("action_requests_connection_idx").on(table.connectionId, table.createdAt),
    index("action_requests_recovery_idx").on(table.state, table.updatedAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_events_created_idx").on(table.createdAt)],
);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  attempts: integer("attempts").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const revokedSessions = pgTable("revoked_sessions", {
  digest: text("digest").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type MissionTarget = { connectionId: string; agentId: string };
export const missions = pgTable("missions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  targets: jsonb("targets").$type<MissionTarget[]>().notNull().default([]),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("missions_workspace_idx").on(table.workspaceId, table.createdAt)]);

export const auditOutbox = pgTable("audit_outbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  event: jsonb("event").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
