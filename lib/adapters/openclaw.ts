import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { signOpenClawDevicePayload } from "../crypto";
import { safeRuntimeLookup } from "../network-policy";
import type {
  AgentAction,
  ConnectionProbe,
  RuntimeAdapter,
  RuntimeAgent,
  RuntimeConnection,
  RuntimeSkill,
} from "./types";

const PROTOCOL_VERSION = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const PLATFORM = "node";

type RpcError = { code?: string; message?: string; details?: Record<string, unknown> };
type RpcResponse = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: RpcError;
};

function devicePayload(
  connection: RuntimeConnection,
  nonce: string,
  signedAt: number,
  scopes: string[],
): string {
  const credentials = connection.credentials;
  const token = credentials.deviceToken ?? credentials.token;
  return [
    "v3",
    credentials.deviceId,
    CLIENT_ID,
    CLIENT_MODE,
    "operator",
    scopes.join(","),
    String(signedAt),
    token,
    nonce,
    PLATFORM,
    "",
  ].join("|");
}

async function openClawRpc(
  connection: RuntimeConnection,
  method: string,
  params: Record<string, unknown>,
): Promise<{ payload: Record<string, unknown>; hello: Record<string, unknown> }> {
  const credentials = connection.credentials;
  if (!credentials.deviceId || !credentials.publicKey || !credentials.privateKeyPem) {
    throw new Error("OpenClaw device identity is missing.");
  }
  const deviceId = credentials.deviceId;
  const publicKey = credentials.publicKey;
  const privateKeyPem = credentials.privateKeyPem;
  const scopes = credentials.scopes?.length
    ? credentials.scopes
    : ["operator.read", "operator.write", "operator.approvals"];

  return new Promise((resolve, reject) => {
    const socket = new WebSocket(connection.endpoint, {
      origin: process.env.NERVE_PUBLIC_URL ?? "https://nerve.local",
      maxPayload: 26_214_400,
      handshakeTimeout: REQUEST_TIMEOUT_MS,
      lookup: safeRuntimeLookup,
    });
    const connectId = randomUUID();
    const requestId = randomUUID();
    let hello: Record<string, unknown> = {};
    let finished = false;
    const timeout = setTimeout(() => finish(new Error("OpenClaw gateway request timed out.")), REQUEST_TIMEOUT_MS);

    function finish(error?: Error, payload?: Record<string, unknown>) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      socket.close();
      if (error) reject(error);
      else resolve({ payload: payload ?? {}, hello });
    }

    socket.on("error", (error) => finish(new Error(`OpenClaw connection failed: ${error.message}`)));
    socket.on("close", () => {
      if (!finished) finish(new Error("OpenClaw closed the connection before replying."));
    });
    socket.on("message", (raw) => {
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        finish(new Error("OpenClaw returned an invalid protocol frame."));
        return;
      }

      if (frame.type === "event" && frame.event === "connect.challenge") {
        const challenge = frame.payload as { nonce?: unknown; ts?: unknown };
        if (
          typeof challenge?.nonce !== "string" ||
          typeof challenge.ts !== "number" ||
          !Number.isSafeInteger(challenge.ts)
        ) {
          finish(new Error("OpenClaw sent an invalid connection challenge."));
          return;
        }
        const signed = devicePayload(connection, challenge.nonce, challenge.ts, scopes);
        socket.send(
          JSON.stringify({
            type: "req",
            id: connectId,
            method: "connect",
            params: {
              minProtocol: PROTOCOL_VERSION,
              maxProtocol: PROTOCOL_VERSION,
              client: {
                id: CLIENT_ID,
                displayName: "Nerve",
                version: "0.1.0",
                platform: PLATFORM,
                mode: CLIENT_MODE,
              },
              role: "operator",
              scopes,
              caps: [
                "tool-events",
                "session-scoped-events",
                "exec-approvals",
                "plugin-approvals",
              ],
              commands: [],
              permissions: {},
              auth: { token: credentials.deviceToken ?? credentials.token },
              locale: "en-US",
              userAgent: "nerve/0.1.0",
              device: {
                id: deviceId,
                publicKey,
                signature: signOpenClawDevicePayload(privateKeyPem, signed),
                signedAt: challenge.ts,
                nonce: challenge.nonce,
              },
            },
          }),
        );
        return;
      }

      if (frame.type !== "res") return;
      const response = frame as unknown as RpcResponse;
      if (response.id === connectId) {
        if (!response.ok) {
          const details = response.error?.details;
          const reason =
            details?.code === "PAIRING_REQUIRED"
              ? "OpenClaw device pairing is required. Approve Nerve in OpenClaw and retry."
              : response.error?.message ?? "OpenClaw rejected the connection.";
          finish(new Error(reason));
          return;
        }
        hello = response.payload ?? {};
        socket.send(JSON.stringify({ type: "req", id: requestId, method, params }));
        return;
      }
      if (response.id === requestId) {
        if (!response.ok) {
          finish(new Error(response.error?.message ?? `OpenClaw rejected ${method}.`));
          return;
        }
        finish(undefined, response.payload);
      }
    });
  });
}

function arrayFrom(value: unknown, key: string): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (value && typeof value === "object" && key in value) {
    const nested = (value as Record<string, unknown>)[key];
    if (Array.isArray(nested)) return nested.filter((item) => item && typeof item === "object");
  }
  return [];
}

export const openClawAdapter: RuntimeAdapter = {
  async probe(connection): Promise<ConnectionProbe> {
    const { payload, hello } = await openClawRpc(connection, "agents.list", {});
    const auth = hello.auth && typeof hello.auth === "object"
      ? (hello.auth as Record<string, unknown>)
      : {};
    return {
      status: "connected",
      capabilities: {
        protocol: hello.protocol,
        server: hello.server,
        features: hello.features,
        agentCount: arrayFrom(payload, "agents").length,
        scopes: auth.scopes,
      },
      issuedDeviceToken:
        typeof auth.deviceToken === "string" ? auth.deviceToken : undefined,
    };
  },

  async listAgents(connection): Promise<RuntimeAgent[]> {
    const { payload } = await openClawRpc(connection, "agents.list", {});
    return arrayFrom(payload, "agents").map((agent) => ({
      id: String(agent.id),
      name: String(
        agent.name ??
          (agent.identity && typeof agent.identity === "object"
            ? (agent.identity as Record<string, unknown>).name
            : agent.id),
      ),
      role: "OpenClaw agent",
      status: "unknown",
      runtime: "openclaw",
      model:
        agent.model && typeof agent.model === "object"
          ? String((agent.model as Record<string, unknown>).primary ?? "")
          : undefined,
      metadata: agent,
    }));
  },

  async listSkills(connection, agentId): Promise<RuntimeSkill[]> {
    const { payload } = await openClawRpc(connection, "skills.status", { agentId });
    return arrayFrom(payload, "skills").map((skill) => ({
      key: String(skill.skillKey ?? skill.key ?? skill.name),
      name: String(skill.name ?? skill.skillKey ?? skill.key),
      description:
        typeof skill.description === "string" ? skill.description : undefined,
      enabled: skill.enabled !== false,
      eligible: skill.eligible !== false,
      source: typeof skill.source === "string" ? skill.source : "openclaw",
      metadata: skill,
    }));
  },

  async installSkill(connection, agentId, skillKey): Promise<Record<string, unknown>> {
    const { payload } = await openClawRpc(connection, "skills.install", {
      agentId,
      source: "clawhub",
      slug: skillKey,
      acknowledgeClawHubRisk: false,
      timeoutMs: 30_000,
    });
    return payload;
  },

  async act(connection, action: AgentAction): Promise<Record<string, unknown>> {
    if (action.type === "message") {
      const sessionKey = action.sessionId ?? `agent:${action.agentId}:main`;
      const { payload } = await openClawRpc(connection, "chat.send", {
        sessionKey,
        agentId: action.agentId,
        message: action.input,
        deliver: false,
        idempotencyKey: action.idempotencyKey,
      });
      return payload;
    }
    if (action.type === "stop") {
      const { payload } = await openClawRpc(connection, "sessions.abort", {
        key: action.sessionId ?? `agent:${action.agentId}:main`,
        agentId: action.agentId,
        runId: action.runId,
        clearQueued: false,
      });
      return payload;
    }
    if (!action.approvalKind) {
      throw new Error("OpenClaw approvalKind is required.");
    }
    const { payload } = await openClawRpc(connection, "approval.resolve", {
      id: action.runId,
      kind: action.approvalKind,
      decision: action.decision === "approve" ? "allow-once" : "deny",
    });
    return payload;
  },
};
