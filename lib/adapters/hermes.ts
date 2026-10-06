import type {
  AgentAction,
  ConnectionProbe,
  RuntimeAdapter,
  RuntimeAgent,
  RuntimeConnection,
  RuntimeSkill,
} from "./types";
import { Agent, fetch } from "undici";
import { assertSafeRuntimeEndpoint, safeRuntimeLookup } from "../network-policy";
import { isRecord, readRuntimeJson } from "../runtime-response";

const REQUEST_TIMEOUT_MS = 10_000;
const dispatcher = new Agent({ connect: { lookup: safeRuntimeLookup } });

export function hermesRunStatus(connection: RuntimeConnection, runId: string) {
  return hermesRequest<Record<string, unknown>>(connection, `/v1/runs/${encodeURIComponent(runId)}`);
}

/** Bounded SSE passthrough. Tokens remain server-side; disconnects cancel upstream work. */
export async function hermesRunEvents(connection: RuntimeConnection, runId: string, request: Request) {
  const endpoint = await assertSafeRuntimeEndpoint(connection.endpoint, "hermes");
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(25_000)]);
  const cursor = request.headers.get("last-event-id");
  const response = await fetch(`${endpoint}/v1/runs/${encodeURIComponent(runId)}/events`, {
    dispatcher, redirect: "error", signal,
    headers: { accept: "text/event-stream", authorization: `Bearer ${connection.credentials.token}`,
      ...(cursor && /^\d{1,12}$/.test(cursor) ? { "last-event-id": cursor } : {}) },
  });
  if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    await response.body?.cancel();
    throw new Error("This runtime did not provide an event stream. Use the run status view.");
  }
  const reader = response.body.getReader();
  let total = 0;
  return new ReadableStream<Uint8Array>({
    async pull(stream) {
      try {
        const { value, done } = await reader.read();
        if (done) { stream.close(); return; }
        total += value.byteLength;
        if (total > 2_097_152) {
          controller.abort();
          stream.close();
          return;
        }
        stream.enqueue(value);
      } catch {
        controller.abort();
        stream.close();
      }
    },
    cancel() { controller.abort(); return reader.cancel().catch(() => {}); },
  });
}

async function hermesRequest<T>(
  connection: RuntimeConnection,
  path: string,
  init: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  // IP literals bypass DNS lookup callbacks; validate on every use as well.
  const endpoint = await assertSafeRuntimeEndpoint(connection.endpoint, "hermes");
  const response = await fetch(`${endpoint}${path}`, {
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
  const parsed = await readRuntimeJson(response);
  if (!response.ok) {
    const message =
      isRecord(parsed) && "detail" in parsed
        ? String(parsed.detail).slice(0, 500)
        : `Hermes returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (path !== "/v1/skills" && !(path === "/v1/runs" && !init.method) && !isRecord(parsed)) {
    throw new Error("Hermes returned an invalid response object.");
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
    const [capabilities, readiness] = await Promise.all([
      hermesRequest<Record<string, unknown>>(connection, "/v1/capabilities"),
      hermesRequest<Record<string, unknown>>(connection, "/health/detailed")
        .catch(() => ({ status: "unknown" })),
    ]);
    return {
      status: readiness.status === "degraded" ? "degraded" : "connected",
      capabilities: { ...capabilities, readiness },
    };
  },

  async listAgents(connection): Promise<RuntimeAgent[]> {
    const [capabilities, runs] = await Promise.all([
      hermesRequest<Record<string, unknown>>(connection, "/v1/capabilities"),
      hermesRequest<unknown>(connection, "/v1/runs").catch(() => null),
    ]);
    const reportedRuns = Array.isArray(runs)
      ? runs
      : isRecord(runs) && Array.isArray(runs.runs) ? runs.runs : null;
    const activeRuns = reportedRuns?.filter((run) =>
      isRecord(run) && ["running", "working", "pending", "queued", "waiting", "awaiting_approval"]
        .includes(String(run.status ?? run.state)),
    );
    return [
      {
        id: "hermes-default",
        name: String(capabilities.model ?? "Hermes Agent"),
        role: "Hermes gateway agent",
        status: activeRuns?.length ? "working" : reportedRuns?.length === 0 ? "idle" : "unknown",
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
