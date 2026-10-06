"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { MissionsPanel } from "./components/MissionsPanel";
import { DeliveryPanel } from "./components/DeliveryPanel";
import { requestJson as api } from "../lib/client-api";

type Status = "working" | "waiting" | "idle" | "done" | "unknown";
type Runtime = "OpenClaw" | "Hermes";

type Agent = {
  id: string;
  name: string;
  initials: string;
  role: string;
  runtime: Runtime;
  status: Status;
  task: string;
  detail: string;
  progress: number;
  x: number;
  y: number;
  color: string;
  elapsed: string;
  tokens: string;
  connectionId?: string;
  runtimeAgentId?: string;
  live?: boolean;
  model?: string;
};

type Connection = {
  id: string;
  name: string;
  runtime: "openclaw" | "hermes";
  endpoint: string;
  status: string;
  enabled?: boolean;
};

type Session = { workspaceId?: string; configured: boolean; authenticated: boolean; actor?: string; role?: "viewer" | "operator" | "admin" };
type Message = { from: "user" | "agent" | "system"; text: string };
type RuntimeSkill = {
  key: string;
  name: string;
  description?: string;
  enabled?: boolean;
  eligible?: boolean;
};

const agents: Agent[] = [
  {
    id: "atlas",
    name: "Atlas",
    initials: "AT",
    role: "Research lead",
    runtime: "OpenClaw",
    status: "working",
    task: "Map competitor positioning",
    detail: "Reading 14 sources and clustering product narratives.",
    progress: 68,
    x: 11,
    y: 15,
    color: "#b8f555",
    elapsed: "18m 24s",
    tokens: "42.8k",
  },
  {
    id: "pixel",
    name: "Pixel",
    initials: "PX",
    role: "Product designer",
    runtime: "Hermes",
    status: "working",
    task: "Design onboarding flow",
    detail: "Building the workspace connection and first-run experience.",
    progress: 44,
    x: 39,
    y: 9,
    color: "#ff9b78",
    elapsed: "11m 02s",
    tokens: "18.4k",
  },
  {
    id: "scout",
    name: "Scout",
    initials: "SC",
    role: "Web researcher",
    runtime: "OpenClaw",
    status: "waiting",
    task: "Verify pricing data",
    detail: "Needs approval to access a gated analyst report.",
    progress: 81,
    x: 67,
    y: 18,
    color: "#ffd666",
    elapsed: "23m 40s",
    tokens: "31.2k",
  },
  {
    id: "forge",
    name: "Forge",
    initials: "FG",
    role: "Full-stack engineer",
    runtime: "Hermes",
    status: "working",
    task: "Build connector service",
    detail: "Implementing event normalization for both agent runtimes.",
    progress: 57,
    x: 18,
    y: 55,
    color: "#75b9ff",
    elapsed: "36m 18s",
    tokens: "77.6k",
  },
  {
    id: "ledger",
    name: "Ledger",
    initials: "LG",
    role: "Data analyst",
    runtime: "OpenClaw",
    status: "done",
    task: "Segment usage cohorts",
    detail: "Cohort analysis complete. Brief is ready for review.",
    progress: 100,
    x: 47,
    y: 47,
    color: "#b99cff",
    elapsed: "42m 05s",
    tokens: "56.1k",
  },
  {
    id: "echo",
    name: "Echo",
    initials: "EC",
    role: "Customer researcher",
    runtime: "Hermes",
    status: "idle",
    task: "Awaiting next mission",
    detail: "Last run completed 8 minutes ago.",
    progress: 0,
    x: 72,
    y: 61,
    color: "#f28fb6",
    elapsed: "—",
    tokens: "8.9k",
  },
];

const statusCopy: Record<Status, string> = {
  working: "Working",
  waiting: "Needs input",
  idle: "Idle",
  done: "Completed",
  unknown: "Status unknown",
};

const filters = ["All", "Working", "Needs input", "Completed"] as const;
type Filter = (typeof filters)[number];

function Icon({ children }: { children: React.ReactNode }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

export default function Home() {
  const [authState, setAuthState] = useState<"checking" | "locked" | "ready">("checking");
  const [accessKey, setAccessKey] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [liveAgents, setLiveAgents] = useState<Agent[]>(agents);
  const [selectedId, setSelectedId] = useState("atlas");
  const [zoom, setZoom] = useState(92);
  const [filter, setFilter] = useState<Filter>("All");
  const [stoppedAgents, setStoppedAgents] = useState<Record<string, boolean>>({});
  const [pendingAgents, setPendingAgents] = useState<Record<string, boolean>>({});
  const pendingActions = useRef(new Set<string>());
  const [question, setQuestion] = useState("");
  const [conversations, setConversations] = useState<Record<string, Message[]>>({});
  const [search, setSearch] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const skillsSequence = useRef(0);
  const authEpoch = useRef(0);
  const connectionDialog = useRef<HTMLDialogElement>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [connectForm, setConnectForm] = useState({
    name: "",
    runtime: "openclaw" as "openclaw" | "hermes",
    endpoint: "",
    token: "",
    admin: false,
  });
  const [connectBusy, setConnectBusy] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [inspectorTab, setInspectorTab] = useState<"activity" | "skills">("activity");
  const [runtimeSkills, setRuntimeSkills] = useState<RuntimeSkill[]>([]);
  const [skillsBusy, setSkillsBusy] = useState(false);
  const [skillKey, setSkillKey] = useState("");
  const [notice, setNotice] = useState("");
  const [showMissions, setShowMissions] = useState(false);
  const [continuationSessions, setContinuationSessions] = useState<Record<string, string>>({});
  const [runIds, setRunIds] = useState<Record<string, string>>({});

  const selected = liveAgents.find((agent) => agent.id === selectedId) ?? liveAgents[0];
  const isPaused = Boolean(selected && stoppedAgents[selected.id]);
  const actionBusy = Boolean(selected && pendingAgents[selected.id]);
  const messages = selected ? conversations[selected.id] ?? [] : [];
  const canManage = session?.role === "admin";
  const canCommand = canManage || session?.role === "operator";
  const demoMode = connections.length === 0;

  useEffect(() => {
    void loadSession();
    // Run once: loadSession owns the authentication-to-connection bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function expireSession() {
      authEpoch.current += 1;
      refreshSequence.current += 1;
      skillsSequence.current += 1;
      setAuthState("locked");
      setSession(null);
      setConnections([]);
      setLiveAgents([]);
      setConversations({});
      pendingActions.current.clear();
      setPendingAgents({});
      setRunIds({});
      setContinuationSessions({});
      setShowMissions(false);
      setRuntimeSkills([]);
      setSkillsBusy(false);
      setRefreshBusy(false);
      setConnectionBusy(null);
      setConnectBusy(false);
      setConnectError("");
      setStoppedAgents({});
      setShowConnect(false);
      setConnectForm((current) => ({ ...current, token: "" }));
      setQuestion("");
      setNotice("");
      setAuthError("Your session has expired. Unlock Nerve to continue.");
    }
    const warn = (event: Event) => setNotice((event as CustomEvent<string>).detail);
    window.addEventListener("nerve-operation-warning", warn);
    window.addEventListener("nerve-session-expired", expireSession);
    return () => {
      window.removeEventListener("nerve-session-expired", expireSession);
      window.removeEventListener("nerve-operation-warning", warn);
    };
  }, []);

  useEffect(() => {
    if (showConnect) connectionDialog.current?.showModal();
  }, [showConnect]);

  useEffect(() => {
    const controller = new AbortController();
    if (
      authState !== "ready" ||
      inspectorTab !== "skills" ||
      !selected?.connectionId ||
      !selected.runtimeAgentId
    ) {
      return;
    }
    void loadSkills(selected, controller.signal);
    return () => { controller.abort(); skillsSequence.current += 1; };
    // Selected primitive fields above are the intended refresh boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, inspectorTab, selected?.id, selected?.connectionId, selected?.runtimeAgentId]);

  async function loadSession() {
    try {
      const session = await api<Session>(
        "/api/auth/session",
      );
      setSession(session);
      if (!session.configured || !session.authenticated) {
        setAuthState("locked");
        return;
      }
      setAuthState("ready");
      await loadConnections();
    } catch {
      setAuthState("locked");
    }
  }

  async function unlock() {
    if (authBusy) return;
    setAuthBusy(true);
    setAuthError("");
    try {
      const authenticated = await api<Session>("/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ token: accessKey }),
      });
      setAccessKey("");
      setSession(authenticated);
      setAuthState("ready");
      await loadConnections();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not unlock Nerve.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function loadConnections() {
    const sequence = ++refreshSequence.current;
    setRefreshBusy(true);
    try {
      const payload = await api<{ connections: Connection[] }>("/api/connections");
      if (sequence !== refreshSequence.current) return;
      setConnections(payload.connections);
      const connected = payload.connections.filter((connection) =>
        connection.enabled !== false && ["connected", "degraded"].includes(connection.status));
      const failed: string[] = [];
      const failedIds = new Set<string>();
      const results = await Promise.all(
        connected.map(async (connection) => {
          try {
            const result = await api<{
              agents: Array<{
                id: string;
                name: string;
                role: string;
                status: Status | "unknown";
                runtime: "openclaw" | "hermes";
                model?: string;
              }>;
            }>(`/api/connections/${connection.id}/agents`);
            return result.agents.map((agent, index) => {
              const seed = `${connection.id}-${agent.id}`
                .split("")
                .reduce((total, char) => total + char.charCodeAt(0), 0);
              return {
                id: `${connection.id}:${agent.id}`,
                name: agent.name,
                initials: agent.name.slice(0, 2).toUpperCase(),
                role: agent.role,
                runtime: agent.runtime === "openclaw" ? "OpenClaw" : "Hermes",
                status: agent.status,
                model: agent.model,
                task: agent.status === "working" ? "Runtime reports active work" : "Send a command to start work",
                detail: `Connected through ${connection.name}. Commands are sent server-to-server.`,
                progress: 0,
                x: 8 + ((seed + index * 29) % 68),
                y: 8 + ((seed * 3 + index * 17) % 58),
                color: ["#b8f555", "#ff9b78", "#75b9ff", "#b99cff"][seed % 4],
                elapsed: "—",
                tokens: "—",
                connectionId: connection.id,
                runtimeAgentId: agent.id,
                live: true,
              } satisfies Agent;
            });
          } catch {
            failed.push(connection.name);
            failedIds.add(connection.id);
            return [];
          }
        }),
      );
      const discovered = results.flat();
      if (sequence !== refreshSequence.current) return;
      setConnections(payload.connections.map((connection) =>
        failedIds.has(connection.id) ? { ...connection, status: "error" } : connection));
      const nextAgents = payload.connections.length ? discovered : agents;
      setLiveAgents(nextAgents);
      setSelectedId((current) => nextAgents.some((agent) => agent.id === current) ? current : nextAgents[0]?.id ?? "");
      if (failed.length) setNotice(`Could not refresh ${failed.join(", ")}. Check the connection and retry.`);
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setLiveAgents([]);
      setNotice(error instanceof Error ? error.message : "Could not refresh connections.");
    } finally {
      if (sequence === refreshSequence.current) setRefreshBusy(false);
    }
  }

  async function signOut() {
    try {
      await api("/api/auth/session", { method: "DELETE" });
      window.dispatchEvent(new Event("nerve-session-expired"));
      setAuthError("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not sign out.");
    }
  }

  async function retryConnection(connection: Connection) {
    const epoch = authEpoch.current;
    setConnectionBusy(connection.id);
    try {
      await api(`/api/connections/${connection.id}/probe`, { method: "POST" });
      if (epoch === authEpoch.current) setNotice(`${connection.name} checked.`);
    } catch (error) {
      if (epoch === authEpoch.current) setNotice(error instanceof Error ? error.message : "Connection check failed.");
    } finally {
      if (epoch === authEpoch.current) {
        await loadConnections();
        if (epoch === authEpoch.current) setConnectionBusy(null);
      }
    }
  }

  async function connectRuntime(event: React.FormEvent) {
    event.preventDefault();
    const epoch = authEpoch.current;
    setConnectBusy(true);
    setConnectError("");
    try {
      const scopes = ["operator.read", "operator.write", "operator.approvals"];
      if (connectForm.admin) scopes.push("operator.admin");
      const result = await api<{ connection: Connection }>("/api/connections", {
        method: "POST",
        body: JSON.stringify({ ...connectForm, scopes }),
      });
      if (epoch !== authEpoch.current) return;
      setNotice(
        result.connection.status === "pending_pairing"
          ? "Approve the Nerve device in OpenClaw, then retry the connection."
          : `${result.connection.name} connected.`,
      );
      setShowConnect(false);
      setConnectForm({ name: "", runtime: "openclaw", endpoint: "", token: "", admin: false });
      await loadConnections();
    } catch (error) {
      if (epoch === authEpoch.current) setConnectError(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      if (epoch === authEpoch.current) setConnectBusy(false);
    }
  }

  async function loadSkills(agent: Agent, signal?: AbortSignal) {
    if (!agent.connectionId || !agent.runtimeAgentId) return;
    const sequence = ++skillsSequence.current;
    setSkillsBusy(true);
    setRuntimeSkills([]);
    try {
      const result = await api<{ skills: RuntimeSkill[] }>(
        `/api/connections/${agent.connectionId}/skills?agentId=${encodeURIComponent(agent.runtimeAgentId)}`,
        { signal },
      );
      if (sequence === skillsSequence.current) setRuntimeSkills(result.skills);
    } catch (error) {
      if (signal?.aborted || sequence !== skillsSequence.current) return;
      setNotice(error instanceof Error ? error.message : "Could not load skills.");
      setRuntimeSkills([]);
    } finally {
      if (sequence === skillsSequence.current) setSkillsBusy(false);
    }
  }

  async function addSkill() {
    if (!canManage || skillsBusy || !selected?.connectionId || !selected.runtimeAgentId || !skillKey.trim()) return;
    const agent = selected;
    const epoch = authEpoch.current;
    const sequence = ++skillsSequence.current;
    setSkillsBusy(true);
    try {
      await api(`/api/connections/${selected.connectionId}/skills`, {
        method: "POST",
        body: JSON.stringify({
          agentId: selected.runtimeAgentId,
          skillKey: skillKey.trim(),
        }),
      });
      if (epoch !== authEpoch.current) return;
      setNotice(selected.runtime === "Hermes"
        ? `${skillKey.trim()} assignment recorded in Nerve for ${selected.name}. Hermes configuration was not changed.`
        : `${skillKey.trim()} added to ${selected.name}.`);
      if (sequence === skillsSequence.current) setSkillKey("");
      if (sequence === skillsSequence.current) await loadSkills(agent);
    } catch (error) {
      if (epoch === authEpoch.current) setNotice(error instanceof Error ? error.message : "Could not add skill.");
    } finally {
      if (sequence === skillsSequence.current) setSkillsBusy(false);
    }
  }

  const visibleAgents = useMemo(() => {
    return liveAgents.filter((agent) => {
      if (!`${agent.name} ${agent.role} ${agent.runtime}`.toLowerCase().includes(search.toLowerCase().trim())) return false;
      if (filter === "All") return true;
      if (filter === "Working") return agent.status === "working";
      if (filter === "Needs input") return agent.status === "waiting";
      return agent.status === "done";
    });
  }, [filter, liveAgents, search]);

  async function sendQuestion() {
    const trimmed = question.trim();
    if (!trimmed || !selected || !canCommand || pendingActions.current.has(selected.id)) return;
    const agent = selected;
    const epoch = authEpoch.current;
    function append(message: Message) {
      if (epoch !== authEpoch.current) return;
      setConversations((current) => ({ ...current, [agent.id]: [...(current[agent.id] ?? []), message] }));
    }
    append({ from: "user", text: trimmed });
    setQuestion("");
    if (agent.connectionId && agent.runtimeAgentId) {
      pendingActions.current.add(agent.id);
      setPendingAgents((current) => ({ ...current, [agent.id]: true }));
      try {
        const response = await api<{
          result?: { run_id?: string; runId?: string };
        }>(`/api/connections/${agent.connectionId}/actions`, {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            type: "message",
            agentId: agent.runtimeAgentId,
            input: trimmed,
            ...(continuationSessions[agent.id] ? { sessionId: continuationSessions[agent.id] } : {}),
          }),
        });
        if (epoch !== authEpoch.current) return;
        const runId = response.result?.run_id ?? response.result?.runId;
        if (runId) setRunIds((current) => ({ ...current, [agent.id]: runId }));
        setStoppedAgents((current) => ({ ...current, [agent.id]: false }));
        append({
            from: "system",
            text: runId
              ? `Runtime accepted run ${runId}. Runtime output and delivery history update above.`
              : "Command accepted by the runtime. Inspect runtime output and delivery history above.",
        });
      } catch (error) {
        append({
            from: "system",
            text: error instanceof Error ? error.message : "The runtime rejected the command.",
        });
      } finally {
        if (epoch === authEpoch.current) {
          pendingActions.current.delete(agent.id);
          setPendingAgents((current) => ({ ...current, [agent.id]: false }));
        }
      }
    } else {
      append({ from: "system", text: "Demo only — no command was sent. Connect a runtime to start real work." });
    }
  }

  async function togglePause() {
    if (!selected || !canCommand || pendingActions.current.has(selected.id)) return;
    const agent = selected;
    const epoch = authEpoch.current;
    if (!agent.connectionId || !agent.runtimeAgentId) {
      setNotice("Demo only — connect a runtime to stop real work.");
      return;
    }
    if (isPaused) {
      setNotice("Stopped runs cannot be resumed in place. Send a new command to continue.");
      return;
    }
    pendingActions.current.add(agent.id);
    setPendingAgents((current) => ({ ...current, [agent.id]: true }));
    try {
      await api(`/api/connections/${selected.connectionId}/actions`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          type: "stop",
          agentId: selected.runtimeAgentId,
          runId: runIds[selected.id],
        }),
      });
      if (epoch !== authEpoch.current) return;
      setStoppedAgents((current) => ({ ...current, [agent.id]: true }));
      setNotice(`${selected.name} stop requested.`);
    } catch (error) {
      if (epoch === authEpoch.current) setNotice(error instanceof Error ? error.message : "Could not stop the run.");
    } finally {
      if (epoch === authEpoch.current) {
        pendingActions.current.delete(agent.id);
        setPendingAgents((current) => ({ ...current, [agent.id]: false }));
      }
    }
  }

  return (
    <>
      {authState !== "ready" && (
        <div className="authGate" role="dialog" aria-modal="true" aria-label="Unlock Nerve">
          <form
            className="authCard"
            autoComplete="on"
            onSubmit={(event) => {
              event.preventDefault();
              void unlock();
            }}
          >
            <Image className="brandLogo large" src="/assets/nerve-logo.png" width={54} height={54} alt="Nerve logo" priority />
            <div className="eyebrow">SECURE CONTROL PLANE</div>
            <h1>{authState === "checking" ? "Checking Nerve…" : "Unlock Nerve"}</h1>
            <p>Your access key is exchanged for an HTTP-only session cookie and cleared from this form.</p>
            {session?.configured === false && <p className="formError" role="alert">Server setup is incomplete. Configure an access key and session secret before signing in.</p>}
            {authState === "locked" && (
              <>
                <input
                  type="password"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  placeholder="Your Nerve access key"
                  autoComplete="current-password"
                  name="nerve-admin-access-key"
                  aria-label="Nerve access key"
                  autoFocus
                />
                {authError && <div className="formError" role="alert">{authError}</div>}
                <button className="button primary" disabled={authBusy || !accessKey || session?.configured === false}>{authBusy ? "Unlocking…" : "Open command center"}</button>
              </>
            )}
          </form>
        </div>
      )}

      {showConnect && (
        <dialog
          ref={connectionDialog}
          className="connectionDialog"
          aria-labelledby="connection-title"
          onCancel={(event) => { event.preventDefault(); if (!connectBusy) connectionDialog.current?.close(); }}
          onClose={() => { setShowConnect(false); setConnectForm((current) => ({ ...current, token: "" })); }}
        >
          <form
            className="connectModal"
            autoComplete="off"
            onSubmit={(event) => void connectRuntime(event)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHead">
              <div>
                <div className="eyebrow">RUNTIME CONNECTION</div>
                <h2 id="connection-title">Connect an agent runtime</h2>
              </div>
              <button type="button" className="iconButton compact" aria-label="Close connection dialog" disabled={connectBusy} onClick={() => connectionDialog.current?.close()}>×</button>
            </div>
            <label>
              Display name
              <input
                required
                maxLength={80}
                autoFocus
                value={connectForm.name}
                onChange={(event) => setConnectForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Production OpenClaw"
              />
            </label>
            <label>
              Runtime
              <select
                value={connectForm.runtime}
                onChange={(event) => {
                  const runtime = event.target.value as "openclaw" | "hermes";
                  setConnectForm((current) => ({
                    ...current,
                    runtime,
                    endpoint: runtime === "openclaw" ? "wss://" : "https://",
                  }));
                }}
              >
                <option value="openclaw">OpenClaw Gateway</option>
                <option value="hermes">Hermes API server</option>
              </select>
            </label>
            <label>
              {connectForm.runtime === "openclaw" ? "Gateway WebSocket URL" : "API server URL"}
              <input
                required
                value={connectForm.endpoint}
                onChange={(event) => setConnectForm((current) => ({ ...current, endpoint: event.target.value }))}
                placeholder={connectForm.runtime === "openclaw" ? "wss://agents.example.com" : "https://hermes.example.com"}
              />
            </label>
            <label>
              {connectForm.runtime === "openclaw" ? "Gateway token" : "API_SERVER_KEY"}
              <input
                key={`runtime-credential-${connectForm.runtime}`}
                required
                type="password"
                autoComplete="new-password"
                name="nerve-runtime-credential"
                value={connectForm.token}
                onChange={(event) => setConnectForm((current) => ({ ...current, token: event.target.value }))}
                placeholder="Stored encrypted at rest"
              />
            </label>
            {connectForm.runtime === "openclaw" && (
              <label className="checkLabel">
                <input
                  type="checkbox"
                  checked={connectForm.admin}
                  onChange={(event) => setConnectForm((current) => ({ ...current, admin: event.target.checked }))}
                />
                Request admin scope for ClawHub skill installation
              </label>
            )}
            <div className="securityNote">
              Nerve validates the endpoint server-side, blocks unsafe network targets by default, and never returns this credential to the browser.
            </div>
            {connectError && <div className="formError" role="alert">{connectError}</div>}
            <div className="modalActions">
              <button type="button" className="button ghost" disabled={connectBusy} onClick={() => connectionDialog.current?.close()}>Cancel</button>
              <button className="button primary" disabled={connectBusy}>
                {connectBusy ? "Testing…" : "Test & connect"}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {showMissions && authState === "ready" && <MissionsPanel agents={liveAgents} canCommand={canCommand}
        actor={session?.actor ?? ""} workspaceId={session?.workspaceId ?? "default"} onClose={() => setShowMissions(false)} />}

      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss notification">×</button>
        </div>
      )}

    <main
      className={`shell ${authState !== "ready" ? "isLocked" : ""}`}
      inert={showConnect || showMissions || authState !== "ready" ? true : undefined}
    >
      <header className="topbar">
        <div className="brand">
          <Image className="brandLogo" src="/assets/nerve-logo.png" width={28} height={28} alt="" priority />
          <span>NERVE</span>
          <span className="brandTag">COMMAND</span>
        </div>

        <div className="workspaceSwitcher">
          <span className="workspaceGlyph">N</span>
          <span>
            <small>Workspace · {session?.workspaceId ?? "default"}</small>
            <strong>{session?.actor ?? "Nerve"} · {session?.role ?? "locked"}</strong>
          </span>
          <Icon>⌄</Icon>
        </div>

        <div className="topActions">
          <div className="runtimeHealth">
            <span className={connections.some((connection) => connection.enabled !== false && connection.status === "connected") ? "liveDot" : "offlineDot"} />
            <span>
              {connections.length
                ? `${connections.filter((connection) => connection.enabled !== false && connection.status === "connected").length} of ${connections.length} runtimes connected`
                : "Demo mode · no runtime connected"}
            </span>
          </div>
          <button className="connectButton" disabled={!canManage} title={!canManage ? "Admin access is required" : undefined} onClick={() => setShowConnect(true)}>＋ Connect</button>
          <button className="button ghost" disabled={refreshBusy} onClick={() => void loadConnections()}>{refreshBusy ? "Refreshing…" : "Refresh"}</button>
          <button className="button ghost" onClick={() => void signOut()}>Sign out</button>
        </div>
      </header>

      <aside className="rail" aria-label="Primary navigation">
        <div className="navGroup">
          <button className="railButton active" aria-label="Mission control" onClick={() => { setFilter("All"); setSearch(""); }}><Icon>⌘</Icon><span>Control</span></button>
          <button className="railButton" aria-label="Agents" onClick={() => { setFilter("All"); setSearch(""); }}><Icon>◫</Icon><span>Agents</span></button>
          <button className="railButton" aria-label="Missions" onClick={() => setShowMissions(true)}><Icon>◎</Icon><span>Missions</span></button>
          <button className="railButton" aria-label="Memory" disabled title="Coming in a future release"><Icon>▱</Icon><span>Memory</span></button>
        </div>
        <div className="navGroup">
          <button className="railButton" aria-label="Settings" disabled title="Coming in a future release"><Icon>⚙</Icon><span>Settings</span></button>
        </div>
      </aside>

      <section className="mission">
        <div className="missionHeader">
          <div>
            <div className="eyebrow"><span className={demoMode ? "offlineDot" : "liveDot"} /> {demoMode ? "SAMPLE MISSION" : "RUNTIME FLEET"}</div>
            <h1>{demoMode ? "Launch intelligence" : "Agent command center"} <span>/ {liveAgents.length}</span></h1>
            <p>{demoMode ? "Demo agents show how live OpenClaw and Hermes work will appear." : "Refresh to update discovery. Inspect an agent for runtime output, events, and saved delivery receipts."}</p>
          </div>
          <div className="missionActions">
            <button className="button ghost" onClick={() => setShowMissions(true)}>Saved missions</button>
            <button className="button primary" disabled={!canManage} title={!canManage ? "Admin access is required" : undefined} onClick={() => setShowConnect(true)}><Icon>＋</Icon> Connect runtime</button>
          </div>
        </div>

        <div className="toolbar">
          <div className="filterTabs" role="tablist" aria-label="Filter agents">
            {filters.map((item) => (
              <button
                key={item}
                role="tab"
                aria-selected={filter === item}
                className={filter === item ? "selected" : ""}
                onClick={() => setFilter(item)}
              >
                {item}
                {item === "Needs input" && <b>{liveAgents.filter((agent) => agent.status === "waiting").length}</b>}
              </button>
            ))}
          </div>
          <div className="viewTools">
            <input className="agentSearch" aria-label="Search agents" placeholder="Search agents…" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
        </div>

        {connections.length > 0 && (
          <div className="connectionList" aria-label="Runtime connections">
            {connections.map((connection) => (
              <div key={connection.id}>
                <span><strong>{connection.name}</strong> · {connection.enabled === false ? "disabled" : connection.status.replaceAll("_", " ")}</span>
                {canManage && <button disabled={connectionBusy !== null} onClick={() => void retryConnection(connection)}>
                  {connectionBusy === connection.id ? "Checking…" : connection.status === "pending_pairing" ? "Retry pairing" : "Check connection"}
                </button>}
              </div>
            ))}
          </div>
        )}

        <div className={`mapViewport${demoMode ? "" : " liveFleet"}`}>
          <div className="mapGrid" />
          <div className="mapGlow glowOne" />
          <div className="mapGlow glowTwo" />
          {demoMode && <><div className="connection connectionOne" />
          <div className="connection connectionTwo" />
          <div className="connection connectionThree" /></>}

          <div
            className="agentPlane"
            style={{ transform: `scale(${zoom / 100})` }}
          >
            {visibleAgents.map((agent) => (
              <button
                key={agent.id}
                className={`agentCard ${selected?.id === agent.id ? "selected" : ""} status-${agent.status}`}
                style={demoMode ? { left: `${agent.x}%`, top: `${agent.y}%` } : undefined}
                onClick={() => {
                  setSelectedId(agent.id);
                  setInspectorTab("activity");
                  skillsSequence.current += 1;
                  setSkillsBusy(false);
                  setRuntimeSkills([]);
                  setQuestion("");
                  setSkillKey("");
                }}
                aria-label={`Inspect ${agent.name}, ${statusCopy[agent.status]}`}
              >
                <div className="agentTop">
                  <span className="agentAvatar" style={{ "--agent": agent.color } as React.CSSProperties}>
                    {agent.initials}
                    <i className={`statusDot ${agent.status}`} />
                  </span>
                  <span className="agentIdentity">
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                  </span>
                  <span className={`runtimeBadge ${agent.runtime === "Hermes" ? "hermes" : ""}`}>
                    {agent.runtime === "OpenClaw" ? "OC" : "H"}
                  </span>
                </div>
                <div className="agentTask">{agent.task}</div>
                <div className="agentProgress">
                  <span><i style={{ width: `${agent.progress}%` }} /></span>
                  <b>{agent.live ? "—" : agent.progress ? `${agent.progress}%` : "READY"}</b>
                </div>
                <div className="agentMeta">
                  <span className={`statusLabel ${agent.status}`}><i />{statusCopy[agent.status]}</span>
                  <span>{agent.elapsed}</span>
                </div>
              </button>
            ))}
          </div>

          {visibleAgents.length === 0 && (
            <div className="emptyState">{refreshBusy ? "Refreshing runtime agents…" : liveAgents.length ? "No agents match this view." : "No agents available. Check your runtime connections and refresh."}</div>
          )}

          {demoMode && <><div className="mapLabel researchLabel"><span>01</span> DISCOVERY</div>
          <div className="mapLabel buildLabel"><span>02</span> BUILD</div></>}

          <div className="zoomControls" aria-label="Canvas zoom controls">
            <button onClick={() => setZoom((value) => Math.min(120, value + 8))} aria-label="Zoom in">＋</button>
            <span>{zoom}%</span>
            <button onClick={() => setZoom((value) => Math.max(68, value - 8))} aria-label="Zoom out">−</button>
            <button onClick={() => setZoom(92)} aria-label="Reset zoom">⌗</button>
          </div>

          <div className="mapKey">
            <span><i className="keyWorking" /> Working</span>
            <span><i className="keyInput" /> Needs input</span>
            <span><i className="keyDone" /> Completed</span>
          </div>
        </div>

        <form className="commandBar" onSubmit={(event) => { event.preventDefault(); void sendQuestion(); }}>
          <span className="commandSpark">✦</span>
          <input
            aria-label="Command selected agent"
            value={question}
            maxLength={65_536}
            disabled={!selected || !canCommand || actionBusy}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={!canCommand ? "Read-only access" : selected ? `Send a command to ${selected.name}…` : "Select an agent to send a command"}
          />
          <button disabled={!selected || !canCommand || actionBusy || !question.trim()} aria-label="Send command">↵</button>
        </form>
      </section>

      {selected ? <aside className="inspector" aria-label={`${selected.name} details`}>
        <div className="inspectorHead">
          <div>
            <div className="eyebrow">AGENT / {selected.runtime.toUpperCase()}</div>
            <h2>{selected.name}</h2>
          </div>
        </div>

        <div className="inspectorStatus">
          <span className="bigAgentAvatar" style={{ "--agent": selected.color } as React.CSSProperties}>
            {selected.initials}
          </span>
          <span>
            <strong>{selected.role}</strong>
            <small><i className={`statusDot ${selected.status}`} /> {isPaused ? "Stop requested" : statusCopy[selected.status]} · {selected.elapsed}</small>
          </span>
          <button
            className={`pauseButton ${isPaused ? "resume" : ""}`}
            disabled={!canCommand || !selected.live || actionBusy || isPaused || (selected.runtime === "Hermes" && !runIds[selected.id])}
            title={selected.runtime === "Hermes" && !runIds[selected.id] ? "Start a run here to obtain a run ID before stopping it" : undefined}
            onClick={() => void togglePause()}
          >
            {actionBusy ? "…" : isPaused ? "■ Requested" : "■ Stop"}
          </button>
        </div>

        <div className="inspectorBody">
          <div className="inspectorTabs" role="tablist" aria-label="Agent details">
            <button
              role="tab"
              aria-selected={inspectorTab === "activity"}
              className={inspectorTab === "activity" ? "active" : ""}
              onClick={() => setInspectorTab("activity")}
            >
              Run & activity
            </button>
            <button
              role="tab"
              aria-selected={inspectorTab === "skills"}
              className={inspectorTab === "skills" ? "active" : ""}
              onClick={() => setInspectorTab("skills")}
            >
              Skills
            </button>
          </div>

          {inspectorTab === "activity" ? (
            <>
          <div className="runSection">
            <div className="sectionTitle">
              <span>CURRENT RUN</span>
              <span>{selected.live ? "Runtime snapshot" : "Sample data"}</span>
            </div>
            <h3>{selected.task}</h3>
            <p>{selected.detail}</p>
            {!selected.live && <div className="runProgress">
              <div><span style={{ width: `${isPaused ? Math.max(selected.progress - 4, 0) : selected.progress}%` }} /></div>
              <b>{selected.progress}%</b>
            </div>}
          </div>

          <div className="metrics">
            <div><small>ELAPSED</small><strong>{selected.elapsed}</strong></div>
            <div><small>TOKENS</small><strong>{selected.tokens}</strong></div>
            <div><small>MODEL</small><strong>{selected.live ? selected.model || "Not reported" : "Sample model"}</strong></div>
          </div>

          {selected.live && selected.connectionId && selected.runtimeAgentId ? <DeliveryPanel
            key={`${authEpoch.current}:${selected.id}`}
            connectionId={selected.connectionId} agentId={selected.runtimeAgentId} runtime={selected.runtime}
            canManage={canManage} canCommand={canCommand}
            onContinue={(sessionId) => {
              setContinuationSessions((values) => ({ ...values, [selected.id]: sessionId }));
              setNotice("Your next command will start a new run in this session. This does not resume the stopped run.");
            }}
          /> : <div className="timeline">
            <div className="sectionTitle"><span>SAMPLE ACTIVITY</span></div>
            <div className="timelineItem complete">
              <i>✓</i>
              <div><strong>Plan established</strong><small>Identified 4 workstreams and success criteria</small></div>
              <time>18:42</time>
            </div>
            <div className="timelineItem complete">
              <i>✓</i>
              <div><strong>Sources gathered</strong><small>Added 14 verified items to working memory</small></div>
              <time>18:49</time>
            </div>
            <div className={`timelineItem current ${isPaused ? "paused" : ""}`}>
              <i>{isPaused ? "Ⅱ" : "↻"}</i>
              <div><strong>{isPaused ? "Run paused" : "Synthesizing findings"}</strong><small>{isPaused ? "Resume when you’re ready" : "Comparing narratives and feature claims"}</small></div>
              <time>NOW</time>
            </div>
            <div className="timelineItem future">
              <i>4</i>
              <div><strong>Draft final brief</strong><small>Build recommendation with source links</small></div>
              <time>~6m</time>
            </div>
          </div>}

          <div className="conversation">
            <div className="sectionTitle"><span>ASK {selected.name.toUpperCase()}</span><button disabled={actionBusy} onClick={() => setConversations((current) => ({ ...current, [selected.id]: [] }))}>Clear</button></div>
            {continuationSessions[selected.id] && <p className="conversationHint">Continuing session {continuationSessions[selected.id]} <button className="button ghost" onClick={() => setContinuationSessions((values) => { const next = { ...values }; delete next[selected.id]; return next; })}>Use a new session</button></p>}
            <div className="messages" role="log" aria-label={`${selected.name} command history`}>
              {messages.length === 0 && <p className="conversationHint">{selected.live ? "Send a command to the runtime. Saved receipts and runtime output appear above." : "Sample agent — commands are not sent to a runtime."}</p>}
              {messages.map((message, index) => (
                <div key={`${message.from}-${index}`} className={`message ${message.from}`}>
                  {message.from === "agent" && <span>{selected.initials}</span>}
                  <p>{message.text}</p>
                </div>
              ))}
            </div>
            <div className="askBox">
              <textarea
                value={question}
                maxLength={65_536}
                disabled={!canCommand || actionBusy}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
                placeholder={canCommand ? `Send ${selected.name} a command…` : "Read-only access"}
                aria-label={`Ask ${selected.name} a question`}
              />
              <div>
                <span>{actionBusy ? "Sending…" : selected.live ? "Runtime command" : "Demo only"}</span>
                <span>↵ to send</span>
                <button className="sendButton" onClick={() => void sendQuestion()} disabled={!canCommand || actionBusy || !question.trim()} aria-label="Send question">↑</button>
              </div>
            </div>
          </div>
            </>
          ) : (
            <div className="skillsPanel">
              <div className="skillsIntro">
                <div>
                  <div className="sectionTitle"><span>AGENT SKILLS</span></div>
                  <h3>Capabilities for {selected.name}</h3>
                  <p>
                    {selected.runtime === "OpenClaw"
                      ? "Install a reviewed ClawHub skill into this agent workspace. OpenClaw enforces its own security policy."
                      : "Hermes exposes installed skills read-only. Track an assignment in Nerve; this does not install or activate a skill in Hermes."}
                  </p>
                </div>
              </div>
              {selected.live ? (
                <>
                  <div className="skillAdd">
                    <input
                      value={skillKey}
                      disabled={!canManage || skillsBusy}
                      maxLength={256}
                      onChange={(event) => setSkillKey(event.target.value)}
                      placeholder={selected.runtime === "OpenClaw" ? "ClawHub skill slug" : "Installed Hermes skill name"}
                      aria-label="Skill key"
                    />
                    <button className="button primary" onClick={() => void addSkill()} disabled={!canManage || skillsBusy || !skillKey.trim()}>
                      {skillsBusy ? "Working…" : selected.runtime === "OpenClaw" ? "Install" : "Assign"}
                    </button>
                  </div>
                  <div className="skillList">
                    {skillsBusy && runtimeSkills.length === 0 && <div className="emptySkill">Loading runtime skills…</div>}
                    {!skillsBusy && runtimeSkills.length === 0 && <div className="emptySkill">No skills were reported by this runtime.</div>}
                    {runtimeSkills.map((skill) => (
                      <div className="skillCard" key={skill.key}>
                        <span className="skillGlyph">✦</span>
                        <div>
                          <strong>{skill.name}</strong>
                          <p>{skill.description ?? skill.key}</p>
                        </div>
                        <span className={skill.enabled === false ? "skillOff" : "skillOn"}>
                          {skill.enabled === false ? "Off" : "Ready"}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="emptySkill">Connect a runtime to manage real agent skills.</div>
              )}
            </div>
          )}
        </div>
      </aside> : <aside className="inspector"><div className="emptySkill">Select an available agent to inspect its runtime and send commands.</div></aside>}
    </main>
    </>
  );
}
