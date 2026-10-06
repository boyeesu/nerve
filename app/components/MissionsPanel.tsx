"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson as api } from "../../lib/client-api";

type Target = { connectionId: string; agentId: string };
type Mission = { id: string; name: string; description: string; targets: Target[] };
type Agent = { id: string; name: string; connectionId?: string; runtimeAgentId?: string; live?: boolean };

export function MissionsPanel({ agents, canCommand, actor, workspaceId, onClose }: {
  agents: Agent[]; canCommand: boolean; actor: string; workspaceId: string; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const busyRef = useRef(false);
  const launchKeys = useRef(new Map<string, string>());
  const [launched, setLaunched] = useState<string[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const available = agents.filter((agent) => agent.live && agent.connectionId && agent.runtimeAgentId);
  const storagePrefix = `nerve:mission-launch:v1:${encodeURIComponent(workspaceId)}:${encodeURIComponent(actor)}:`;
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    dialog.current?.showModal();
    void api<{ missions: Mission[] }>("/api/missions", { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setMissions(data.missions);
        const restored: string[] = [];
        for (const mission of data.missions) {
          const key = sessionStorage.getItem(`${storagePrefix}${mission.id}`);
          if (key) { launchKeys.current.set(mission.id, key); restored.push(mission.id); }
        }
        setLaunched(restored);
      })
      .catch((error) => { if (!controller.signal.aborted) setNotice(error.message); });
    return () => { active.current = false; controller.abort(); };
  }, [storagePrefix]);

  async function perform(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try { await work(); }
    catch (error) { if (active.current) setNotice(error instanceof Error ? error.message : "Mission operation failed."); }
    finally { busyRef.current = false; if (active.current) setBusy(false); }
  }

  async function save() {
    const targets = available.filter((agent) => selected.includes(agent.id))
      .map((agent) => ({ connectionId: agent.connectionId!, agentId: agent.runtimeAgentId! }));
    const data = await api<{ mission: Mission }>("/api/missions", {
      method: "POST", body: JSON.stringify({ name, description, targets }),
    });
    if (!active.current) return;
    setMissions((rows) => [data.mission, ...rows]);
    setName(""); setDescription(""); setSelected([]);
    setNotice("Mission saved. Review its targets before launching.");
  }

  async function launch(mission: Mission) {
    if (!window.confirm(`Send “${mission.name}” to ${mission.targets.length} agents? Each target receives a separate command.`)) return;
    const key = launchKeys.current.get(mission.id) ??
      sessionStorage.getItem(`${storagePrefix}${mission.id}`) ?? crypto.randomUUID();
    // Persist before sending. If storage fails, fail closed rather than lose retry identity.
    sessionStorage.setItem(`${storagePrefix}${mission.id}`, key);
    launchKeys.current.set(mission.id, key);
    setLaunched((ids) => ids.includes(mission.id) ? ids : [...ids, mission.id]);
    const data = await api<{ receipts: Array<{ state: string }> }>(`/api/missions/${mission.id}`, {
      method: "POST", headers: { "idempotency-key": key },
      body: JSON.stringify({ confirmTargetCount: mission.targets.length }),
    });
    if (!active.current) return;
    // Keep the key after success too: repeated clicks inspect/replay the same launch, not duplicate work.
    const states = data.receipts.map((receipt) => receipt.state);
    setNotice(`${states.length} target receipts: ${states.join(", ")}. Check each agent’s delivery history; queued does not mean executed.`);
  }

  return <dialog className="operationsDialog" ref={dialog} onCancel={onClose} aria-labelledby="missions-title">
    <div className="sectionTitle"><h2 id="missions-title">Saved missions</h2><button className="button ghost" onClick={onClose}>Close</button></div>
    <p>Save a command for selected agents. Launches are queued durably, with a separate receipt for every target.</p>
    {notice && <p role="status" className="operationsNotice">{notice}</p>}
    {canCommand && <form onSubmit={(event) => { event.preventDefault(); void perform(save); }}>
      <label>Mission name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
      <label>Command<textarea required maxLength={65_536} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <fieldset disabled={busy}><legend>Targets ({selected.length}/25)</legend>
        <button className="button ghost" type="button" disabled={!available.length}
          onClick={() => setSelected(available.slice(0, 25).map((agent) => agent.id))}>Select fleet (up to 25)</button>
        {available.map((agent) => <label className="targetChoice" key={agent.id}>
          <input type="checkbox" checked={selected.includes(agent.id)}
            disabled={selected.length >= 25 && !selected.includes(agent.id)}
            onChange={(event) => setSelected((values) => event.target.checked ? [...values, agent.id] : values.filter((id) => id !== agent.id))} />
          {agent.name}
        </label>)}
        {!available.length && <p>Connect a runtime and discover agents first.</p>}
      </fieldset>
      <button className="button primary" disabled={busy || !selected.length}>Save mission</button>
    </form>}
    <div className="savedMissions">
      {!missions.length && <p>No saved missions in this workspace.</p>}
      {missions.map((mission) => <article key={mission.id}>
        <h3>{mission.name}</h3><p className="preserveText">{mission.description}</p>
        <details><summary>{mission.targets.length} agent targets</summary>
          <ul>{mission.targets.map((target) => <li key={`${target.connectionId}:${target.agentId}`}>{target.agentId} · {target.connectionId}</li>)}</ul>
        </details>
        {canCommand && <div className="operationButtons">
          <button className="button primary" disabled={busy} onClick={() => void perform(() => launch(mission))}>
            {launched.includes(mission.id) ? "Check / retry same launch" : `Launch to ${mission.targets.length} agents`}
          </button>
          {launched.includes(mission.id) && <button className="button ghost" disabled={busy} onClick={() => void perform(async () => {
            if (window.confirm("Start a separate launch? This can duplicate work from the previous launch.")) {
              sessionStorage.removeItem(`${storagePrefix}${mission.id}`);
              launchKeys.current.delete(mission.id);
              setLaunched((ids) => ids.filter((id) => id !== mission.id));
              setNotice("A new launch is ready. Press Launch to confirm its targets.");
            }
          })}>Prepare new launch</button>}
          <button className="button ghost" disabled={busy} onClick={() => void perform(async () => {
            if (!window.confirm(`Delete “${mission.name}”? Existing deliveries are not cancelled.`)) return;
            await api(`/api/missions/${mission.id}`, { method: "DELETE" });
            if (active.current) setMissions((rows) => rows.filter((row) => row.id !== mission.id));
          })}>Delete</button>
        </div>}
      </article>)}
    </div>
  </dialog>;
}
