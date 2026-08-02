"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

type Status = "working" | "waiting" | "idle" | "done";
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
};

type Connection = {
  id: string;
  name: string;
  runtime: "openclaw" | "hermes";
  endpoint: string;
  status: string;
};

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
  const [connections, setConnections] = useState<Connection[]>([]);
  const [liveAgents, setLiveAgents] = useState<Agent[]>(agents);
  const [selectedId, setSelectedId] = useState("atlas");
  const [zoom, setZoom] = useState(92);
  const [filter, setFilter] = useState<Filter>("All");
  const [isPaused, setIsPaused] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([
    {
      from: "agent",
      text: "I’m mapping seven direct competitors now. The clearest gap is visibility: none of them makes multi-agent work feel spatial or legible.",
    },
  ]);
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
  const [runIds, setRunIds] = useState<Record<string, string>>({});

  const selected = liveAgents.find((agent) => agent.id === selectedId) ?? liveAgents[0] ?? agents[0];

  useEffect(() => {
    void loadSession();
    // Run once: loadSession owns the authentication-to-connection bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      authState !== "ready" ||
      inspectorTab !== "skills" ||
      !selected.connectionId ||
      !selected.runtimeAgentId
    ) {
      return;
    }
    void loadSkills(selected);
    // Selected primitive fields above are the intended refresh boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, inspectorTab, selected.id, selected.connectionId, selected.runtimeAgentId]);

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
    const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status}).`);
    return payload;
  }

  async function loadSession() {
    try {
      const session = await api<{ configured: boolean; authenticated: boolean }>(
        "/api/auth/session",
      );
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
    setAuthError("");
    try {
      await api("/api/auth/session", {
        method: "POST",
        body: JSON.stringify({ token: accessKey }),
      });
      setAccessKey("");
      setAuthState("ready");
      await loadConnections();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not unlock Nerve.");
    }
  }

  async function loadConnections() {
    const payload = await api<{ connections: Connection[] }>("/api/connections");
    setConnections(payload.connections);
    const connected = payload.connections.filter((connection) => connection.status === "connected");
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
              status: agent.status === "unknown" ? "idle" : agent.status,
              task: "Ready for a command",
              detail: `Connected through ${connection.name}. Commands are sent server-to-server.`,
              progress: 0,
              x: 8 + ((seed + index * 29) % 68),
              y: 8 + ((seed * 3 + index * 17) % 58),
              color: ["#b8f555", "#ff9b78", "#75b9ff", "#b99cff"][seed % 4],
              elapsed: "LIVE",
              tokens: "—",
              connectionId: connection.id,
              runtimeAgentId: agent.id,
              live: true,
            } satisfies Agent;
          });
        } catch {
          return [];
        }
      }),
    );
    const discovered = results.flat();
    if (discovered.length > 0) {
      setLiveAgents(discovered);
      setSelectedId(discovered[0].id);
    }
  }

  async function connectRuntime(event: React.FormEvent) {
    event.preventDefault();
    setConnectBusy(true);
    setConnectError("");
    try {
      const scopes = ["operator.read", "operator.write", "operator.approvals"];
      if (connectForm.admin) scopes.push("operator.admin");
      const result = await api<{ connection: Connection }>("/api/connections", {
        method: "POST",
        body: JSON.stringify({ ...connectForm, scopes }),
      });
      setNotice(
        result.connection.status === "pending_pairing"
          ? "Approve the Nerve device in OpenClaw, then retry the connection."
          : `${result.connection.name} connected.`,
      );
      setShowConnect(false);
      setConnectForm({ name: "", runtime: "openclaw", endpoint: "", token: "", admin: false });
      await loadConnections();
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : "Connection failed.");
    } finally {
      setConnectBusy(false);
    }
  }

  async function loadSkills(agent: Agent) {
    if (!agent.connectionId || !agent.runtimeAgentId) return;
    setSkillsBusy(true);
    try {
      const result = await api<{ skills: RuntimeSkill[] }>(
        `/api/connections/${agent.connectionId}/skills?agentId=${encodeURIComponent(agent.runtimeAgentId)}`,
      );
      setRuntimeSkills(result.skills);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not load skills.");
      setRuntimeSkills([]);
    } finally {
      setSkillsBusy(false);
    }
  }

  async function addSkill() {
    if (!selected.connectionId || !selected.runtimeAgentId || !skillKey.trim()) return;
    setSkillsBusy(true);
    try {
      await api(`/api/connections/${selected.connectionId}/skills`, {
        method: "POST",
        body: JSON.stringify({
          agentId: selected.runtimeAgentId,
          skillKey: skillKey.trim(),
        }),
      });
      setNotice(`${skillKey.trim()} added to ${selected.name}.`);
      setSkillKey("");
      await loadSkills(selected);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add skill.");
    } finally {
      setSkillsBusy(false);
    }
  }

  const visibleAgents = useMemo(() => {
    return liveAgents.filter((agent) => {
      if (filter === "All") return true;
      if (filter === "Working") return agent.status === "working";
      if (filter === "Needs input") return agent.status === "waiting";
      return agent.status === "done";
    });
  }, [filter, liveAgents]);

  async function sendQuestion() {
    const trimmed = question.trim();
    if (!trimmed) return;
    setMessages((current) => [
      ...current,
      { from: "user", text: trimmed },
      {
        from: "agent",
        text: `Got it. I’ll fold that into the current run and report back here. My next checkpoint is in about ${selected.id === "atlas" ? "4" : "6"} minutes.`,
      },
    ]);
    setQuestion("");
    if (selected.connectionId && selected.runtimeAgentId) {
      try {
        const response = await api<{
          result?: { run_id?: string; runId?: string };
        }>(`/api/connections/${selected.connectionId}/actions`, {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({
            type: "message",
            agentId: selected.runtimeAgentId,
            input: trimmed,
          }),
        });
        const runId = response.result?.run_id ?? response.result?.runId;
        if (runId) setRunIds((current) => ({ ...current, [selected.id]: runId }));
        setMessages((current) => [
          ...current,
          {
            from: "agent",
            text: runId
              ? `Run ${runId} started. Nerve will keep this thread attached to the runtime.`
              : "Command accepted by the runtime.",
          },
        ]);
      } catch (error) {
        setMessages((current) => [
          ...current,
          {
            from: "agent",
            text: error instanceof Error ? error.message : "The runtime rejected the command.",
          },
        ]);
      }
    }
  }

  async function togglePause() {
    if (!selected.connectionId || !selected.runtimeAgentId) {
      setIsPaused((value) => !value);
      return;
    }
    if (isPaused) {
      setNotice("Stopped runs cannot be resumed in place. Send a new command to continue.");
      return;
    }
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
      setIsPaused(true);
      setNotice(`${selected.name} stop requested.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not stop the run.");
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
            <p>Your access key stays in this browser session and is exchanged for an HTTP-only cookie.</p>
            {authState === "locked" && (
              <>
                <input
                  type="password"
                  value={accessKey}
                  onChange={(event) => setAccessKey(event.target.value)}
                  placeholder="NERVE_ADMIN_TOKEN"
                  autoComplete="current-password"
                  name="nerve-admin-access-key"
                  aria-label="Nerve access key"
                  autoFocus
                />
                {authError && <div className="formError">{authError}</div>}
                <button className="button primary" disabled={!accessKey}>Open command center</button>
              </>
            )}
          </form>
        </div>
      )}

      {showConnect && (
        <div className="modalBackdrop" role="presentation" onMouseDown={() => setShowConnect(false)}>
          <form
            className="connectModal"
            autoComplete="off"
            onSubmit={(event) => void connectRuntime(event)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modalHead">
              <div>
                <div className="eyebrow">RUNTIME CONNECTION</div>
                <h2>Connect an agent runtime</h2>
              </div>
              <button type="button" className="iconButton compact" onClick={() => setShowConnect(false)}>×</button>
            </div>
            <label>
              Display name
              <input
                required
                maxLength={80}
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
            {connectError && <div className="formError">{connectError}</div>}
            <div className="modalActions">
              <button type="button" className="button ghost" onClick={() => setShowConnect(false)}>Cancel</button>
              <button className="button primary" disabled={connectBusy}>
                {connectBusy ? "Testing…" : "Test & connect"}
              </button>
            </div>
          </form>
        </div>
      )}

      {notice && (
        <button className="notice" onClick={() => setNotice("")} aria-label="Dismiss notification">
          <span>{notice}</span><b>×</b>
        </button>
      )}

    <main
      className={`shell ${authState !== "ready" ? "isLocked" : ""}`}
      inert={showConnect || authState !== "ready" ? true : undefined}
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
            <small>Workspace</small>
            <strong>Northstar OS</strong>
          </span>
          <Icon>⌄</Icon>
        </div>

        <div className="topActions">
          <div className="runtimeHealth">
            <span className={connections.some((connection) => connection.status === "connected") ? "liveDot" : "offlineDot"} />
            <span>
              {connections.length
                ? `${connections.filter((connection) => connection.status === "connected").length} of ${connections.length} runtimes connected`
                : "Demo mode · no runtime connected"}
            </span>
          </div>
          <button className="connectButton" onClick={() => setShowConnect(true)}>＋ Connect</button>
          <button className="iconButton" aria-label="Search agents"><Icon>⌕</Icon></button>
          <button className="iconButton" aria-label="Notifications"><Icon>◌</Icon><i /></button>
          <button className="avatarButton" aria-label="Account menu">DE</button>
        </div>
      </header>

      <aside className="rail" aria-label="Primary navigation">
        <div className="navGroup">
          <button className="railButton active" aria-label="Mission control"><Icon>⌘</Icon><span>Control</span></button>
          <button className="railButton" aria-label="Agents"><Icon>◫</Icon><span>Agents</span></button>
          <button className="railButton" aria-label="Missions"><Icon>◎</Icon><span>Missions</span></button>
          <button className="railButton" aria-label="Memory"><Icon>▱</Icon><span>Memory</span></button>
        </div>
        <div className="navGroup">
          <button className="railButton" aria-label="Settings"><Icon>⚙</Icon><span>Settings</span></button>
        </div>
      </aside>

      <section className="mission">
        <div className="missionHeader">
          <div>
            <div className="eyebrow"><span className="liveDot" /> LIVE MISSION</div>
            <h1>Launch intelligence <span>/ 02</span></h1>
            <p>{liveAgents.some((agent) => agent.live) ? "Live agents discovered from your connected runtimes." : "Demo agents show how live OpenClaw and Hermes work will appear."}</p>
          </div>
          <div className="missionActions">
            <div className="collaborators" aria-label="Mission collaborators">
              <span>SO</span><span>MA</span><span>+3</span>
            </div>
            <button className="button ghost"><Icon>↗</Icon> Share view</button>
            <button className="button primary" onClick={() => setShowConnect(true)}><Icon>＋</Icon> Connect runtime</button>
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
                {item === "Needs input" && <b>1</b>}
              </button>
            ))}
          </div>
          <div className="viewTools">
            <button className="toolButton"><Icon>≡</Icon> Activity</button>
            <button className="toolButton"><Icon>⌗</Icon> Group by mission</button>
            <button className="iconButton compact" aria-label="More view options"><Icon>•••</Icon></button>
          </div>
        </div>

        <div className="mapViewport">
          <div className="mapGrid" />
          <div className="mapGlow glowOne" />
          <div className="mapGlow glowTwo" />
          <div className="connection connectionOne" />
          <div className="connection connectionTwo" />
          <div className="connection connectionThree" />

          <div
            className="agentPlane"
            style={{ transform: `scale(${zoom / 100})` }}
          >
            {visibleAgents.map((agent) => (
              <button
                key={agent.id}
                className={`agentCard ${selected.id === agent.id ? "selected" : ""} status-${agent.status}`}
                style={{ left: `${agent.x}%`, top: `${agent.y}%` }}
                onClick={() => {
                  setSelectedId(agent.id);
                  setIsPaused(false);
                  setInspectorTab("activity");
                  setRuntimeSkills([]);
                  setMessages([
                    {
                      from: "agent",
                      text: `${agent.detail} Ask me anything about this run.`,
                    },
                  ]);
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
                  <b>{agent.progress ? `${agent.progress}%` : "READY"}</b>
                </div>
                <div className="agentMeta">
                  <span className={`statusLabel ${agent.status}`}><i />{statusCopy[agent.status]}</span>
                  <span>{agent.elapsed}</span>
                </div>
              </button>
            ))}
          </div>

          {visibleAgents.length === 0 && (
            <div className="emptyState">No agents match this view.</div>
          )}

          <div className="mapLabel researchLabel"><span>01</span> DISCOVERY</div>
          <div className="mapLabel buildLabel"><span>02</span> BUILD</div>

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

        <div className="commandBar">
          <span className="commandSpark">✦</span>
          <input
            aria-label="Command all agents"
            placeholder="Ask all agents, assign work, or type / for commands…"
          />
          <kbd>⌘ K</kbd>
          <button aria-label="Send command">↵</button>
        </div>
      </section>

      <aside className="inspector" aria-label={`${selected.name} details`}>
        <div className="inspectorHead">
          <div>
            <div className="eyebrow">AGENT / {selected.runtime.toUpperCase()}</div>
            <h2>{selected.name}</h2>
          </div>
          <div className="inspectorHeadActions">
            <button className="iconButton compact" aria-label="Open agent in new view">↗</button>
            <button className="iconButton compact" aria-label="Close agent panel">×</button>
          </div>
        </div>

        <div className="inspectorStatus">
          <span className="bigAgentAvatar" style={{ "--agent": selected.color } as React.CSSProperties}>
            {selected.initials}
          </span>
          <span>
            <strong>{selected.role}</strong>
            <small><i className={`statusDot ${selected.status}`} /> {isPaused ? "Paused by you" : statusCopy[selected.status]} · {selected.elapsed}</small>
          </span>
          <button
            className={`pauseButton ${isPaused ? "resume" : ""}`}
            onClick={() => void togglePause()}
          >
            {isPaused ? "■ Stopped" : "Ⅱ Stop"}
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
              <button>View trace ↗</button>
            </div>
            <h3>{selected.task}</h3>
            <p>{selected.detail}</p>
            <div className="runProgress">
              <div><span style={{ width: `${isPaused ? Math.max(selected.progress - 4, 0) : selected.progress}%` }} /></div>
              <b>{selected.progress}%</b>
            </div>
          </div>

          <div className="metrics">
            <div><small>ELAPSED</small><strong>{selected.elapsed}</strong></div>
            <div><small>TOKENS</small><strong>{selected.tokens}</strong></div>
            <div><small>MODEL</small><strong>{selected.runtime === "OpenClaw" ? "Sonnet 4" : "GPT-5"}</strong></div>
          </div>

          <div className="timeline">
            <div className="sectionTitle"><span>LIVE ACTIVITY</span><i className="liveDot" /></div>
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
          </div>

          <div className="conversation">
            <div className="sectionTitle"><span>ASK {selected.name.toUpperCase()}</span><button>Clear</button></div>
            <div className="messages">
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
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    sendQuestion();
                  }
                }}
                placeholder={`Ask ${selected.name} about this run…`}
                aria-label={`Ask ${selected.name} a question`}
              />
              <div>
                <button className="attachButton" aria-label="Attach context">＋</button>
                <span>↵ to send</span>
                <button className="sendButton" onClick={sendQuestion} disabled={!question.trim()} aria-label="Send question">↑</button>
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
                      : "Hermes exposes installed skills read-only. Nerve can assign one to this agent; install new skills in Hermes first."}
                  </p>
                </div>
              </div>
              {selected.live ? (
                <>
                  <div className="skillAdd">
                    <input
                      value={skillKey}
                      onChange={(event) => setSkillKey(event.target.value)}
                      placeholder={selected.runtime === "OpenClaw" ? "ClawHub skill slug" : "Installed Hermes skill name"}
                      aria-label="Skill key"
                    />
                    <button className="button primary" onClick={() => void addSkill()} disabled={skillsBusy || !skillKey.trim()}>
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
      </aside>
    </main>
    </>
  );
}
