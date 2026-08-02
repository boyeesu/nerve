"use client";

import { useMemo, useState } from "react";

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

  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

  const visibleAgents = useMemo(() => {
    return agents.filter((agent) => {
      if (filter === "All") return true;
      if (filter === "Working") return agent.status === "working";
      if (filter === "Needs input") return agent.status === "waiting";
      return agent.status === "done";
    });
  }, [filter]);

  function sendQuestion() {
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
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark"><span /><span /><span /></div>
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
            <span className="liveDot" />
            <span>2 runtimes connected</span>
          </div>
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
            <p>Six agents building the market, product, and launch brief together.</p>
          </div>
          <div className="missionActions">
            <div className="collaborators" aria-label="Mission collaborators">
              <span>SO</span><span>MA</span><span>+3</span>
            </div>
            <button className="button ghost"><Icon>↗</Icon> Share view</button>
            <button className="button primary"><Icon>＋</Icon> Add agent</button>
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
            onClick={() => setIsPaused((value) => !value)}
          >
            {isPaused ? "▶ Resume" : "Ⅱ Pause"}
          </button>
        </div>

        <div className="inspectorBody">
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
        </div>
      </aside>
    </main>
  );
}
