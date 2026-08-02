import type {
  AgentAction,
  ConnectionProbe,
  RuntimeAdapter,
  RuntimeAgent,
  RuntimeConnection,
  RuntimeSkill,
} from "./types";
import { Agent, fetch } from "undici";
import { safeRuntimeLookup } from "../network-policy";

const REQUEST_TIMEOUT_MS = 10_000;
const dispatcher = new Agent({ connect: { lookup: safeRuntimeLookup } });

async function hermesRequest<T>(
  connection: RuntimeConnection,
  path: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const response = await fetch(`${connection.endpoint}${path}`, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${connection.credentials.token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
    dispatcher,
  });
  const body = await response.text();
  let parsed: unknown = {};
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { message: body.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message =
      parsed && typeof parsed === "object" && "detail" in parsed
        ? String(parsed.detail)
        : `Hermes returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return parsed as T;
}

function skillArray(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item) => item && typeof item === "object");
  if (
    payload &&
    typeof payload === "object" &&
    "skills" in payload &&
    Array.isArray(payload.skills)
  ) {
    return payload.skills.filter((item) => item && typeof item === "object");
  }
  return [];
}

export const hermesAdapter: RuntimeAdapter = {
  async probe(connection): Promise<ConnectionProbe> {
    const capabilities = await hermesRequest<Record<string, unknown>>(
      connection,
      "/v1/capabilities",
    );
    const readiness = await hermesRequest<Record<string, unknown>>(
      connection,
      "/health/detailed",
    ).catch(() => ({ status: "unknown" }));
    return {
      status: readiness.status === "degraded" ? "degraded" : "connected",
      capabilities: { ...capabilities, readiness },
    };
  },

  async listAgents(connection): Promise<RuntimeAgent[]> {
    const [capabilities, runs] = await Promise.all([
      hermesRequest<Record<string, unknown>>(connection, "/v1/capabilities"),
      hermesRequest<Record<string, unknown>>(connection, "/v1/runs").catch(() => ({})),
    ]);
    return [
      {
        id: "hermes-default",
        name: String(capabilities.model ?? "Hermes Agent"),
        role: "Hermes gateway agent",
        status: Array.isArray(runs) && runs.length > 0 ? "working" : "idle",
        runtime: "hermes",
        model: String(capabilities.model ?? "hermes-agent"),
        metadata: { capabilities },
      },
    ];
  },

  async listSkills(connection): Promise<RuntimeSkill[]> {
    const payload = await hermesRequest<unknown>(connection, "/v1/skills");
    return skillArray(payload).map((skill) => ({
      key: String(skill.name ?? skill.key ?? "unknown"),
      name: String(skill.name ?? skill.key ?? "Unnamed skill"),
      description: typeof skill.description === "string" ? skill.description : undefined,
      enabled: true,
      eligible: true,
      source: "hermes",
      metadata: skill,
    }));
  },

  async installSkill(): Promise<Record<string, unknown>> {
    throw new Error(
      "Hermes does not currently expose skill installation through its documented public API. Install the skill in Hermes, then refresh Nerve.",
    );
  },

  async act(connection, action: AgentAction): Promise<Record<string, unknown>> {
    if (action.type === "message") {
      return hermesRequest(connection, "/v1/runs", {
        method: "POST",
        body: JSON.stringify({
          input: action.input,
          session_id: action.sessionId,
          instructions: action.instructions,
        }),
      });
    }
    if (action.type === "stop") {
      if (!action.runId) throw new Error("A Hermes run ID is required to stop a run.");
      return hermesRequest(connection, `/v1/runs/${encodeURIComponent(action.runId)}/stop`, {
        method: "POST",
        body: "{}",
      });
    }
    return hermesRequest(
      connection,
      `/v1/runs/${encodeURIComponent(action.runId)}/approval`,
      {
        method: "POST",
        body: JSON.stringify({ decision: action.decision }),
      },
    );
  },
};
