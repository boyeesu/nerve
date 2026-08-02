export type RuntimeKind = "openclaw" | "hermes";

export type RuntimeCredentials = {
  token: string;
  scopes?: string[];
  deviceId?: string;
  publicKey?: string;
  privateKeyPem?: string;
  deviceToken?: string;
};

export type RuntimeConnection = {
  id?: string;
  runtime: RuntimeKind;
  endpoint: string;
  credentials: RuntimeCredentials;
};

export type ConnectionProbe = {
  status: "connected" | "pending_pairing" | "degraded";
  capabilities: Record<string, unknown>;
  issuedDeviceToken?: string;
};

export type RuntimeAgent = {
  id: string;
  name: string;
  role: string;
  status: "working" | "waiting" | "idle" | "done" | "unknown";
  runtime: RuntimeKind;
  model?: string;
  metadata?: Record<string, unknown>;
};

export type RuntimeSkill = {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  eligible?: boolean;
  source?: string;
  metadata?: Record<string, unknown>;
};

export type AgentAction =
  | {
      type: "message";
      agentId: string;
      input: string;
      sessionId?: string;
      instructions?: string;
      idempotencyKey: string;
    }
  | {
      type: "stop";
      agentId: string;
      runId?: string;
      sessionId?: string;
      idempotencyKey: string;
    }
  | {
      type: "approve";
      agentId: string;
      runId: string;
      decision: "approve" | "deny";
      approvalKind?: "exec" | "plugin" | "system-agent";
      idempotencyKey: string;
    };

export interface RuntimeAdapter {
  probe(connection: RuntimeConnection): Promise<ConnectionProbe>;
  listAgents(connection: RuntimeConnection): Promise<RuntimeAgent[]>;
  listSkills(connection: RuntimeConnection, agentId: string): Promise<RuntimeSkill[]>;
  installSkill(
    connection: RuntimeConnection,
    agentId: string,
    skillKey: string,
  ): Promise<Record<string, unknown>>;
  act(
    connection: RuntimeConnection,
    action: AgentAction,
  ): Promise<Record<string, unknown>>;
}
