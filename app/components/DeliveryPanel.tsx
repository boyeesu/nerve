"use client";

import { useEffect, useState } from "react";
import { requestJson as api } from "../../lib/client-api";

type Receipt = {
  id: string; idempotencyKey: string; action: string; state: string; createdAt: string;
  lastError?: string; response?: Record<string, unknown>; request: Record<string, unknown>;
};
type Observation = { kind: "run" | "history"; snapshot: Record<string, unknown> };

export function DeliveryPanel({ connectionId, agentId, runtime, canManage, canCommand, onContinue }: {
  connectionId: string; agentId: string; runtime: string; canManage: boolean; canCommand: boolean;
  onContinue: (sessionId: string) => void;
}) {
  const [actions, setActions] = useState<Receipt[]>([]);
  const [notice, setNotice] = useState("");
  const [observationState, setObservation] = useState<{ id: string; data: Observation } | null>(null);
  const [eventState, setEvents] = useState<{ id: string; items: Array<Record<string, unknown>> } | null>(null);
  const [selectedAction, setSelectedAction] = useState("");
  const [reconcileId, setReconcileId] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("delivered");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const base = `/api/connections/${connectionId}/actions`;
  const latestMessage = actions.find((action) => action.action === "message");
  const observedId = selectedAction || latestMessage?.id;
  const observation = observationState?.id === observedId ? observationState?.data : null;
  const events = eventState?.id === observedId ? eventState?.items ?? [] : [];
  const observedAction = actions.find((action) => action.id === observedId);
  const hasRun = Boolean(observedAction?.response?.run_id ?? observedAction?.response?.runId);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await api<{ actions: Receipt[] }>(`${base}?agentId=${encodeURIComponent(agentId)}`, { signal: controller.signal });
        if (!controller.signal.aborted) setActions(data.actions);
      } catch (error) {
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Could not load delivery history.");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [base, agentId, revision]);

  useEffect(() => {
    if (!observedId || (runtime === "Hermes" && !hasRun)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function refresh() {
      let terminal = false;
      try {
        const data = await api<Observation>(`${base}/${observedId}/observe`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setObservation({ id: observedId!, data });
        failures = 0;
        terminal = data.kind === "run" && ["completed", "failed", "cancelled"].includes(String(data.snapshot.status));
      } catch (error) {
        failures++;
        if (!controller.signal.aborted) setNotice(error instanceof Error ? error.message : "Runtime observation unavailable.");
      } finally {
        if (!controller.signal.aborted && !terminal && failures < 3) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    let source: EventSource | undefined;
    if (runtime === "Hermes" && hasRun) {
      source = new EventSource(`${base}/${observedId}/events`);
      let streamFailures = 0;
      source.onmessage = (event) => {
        if (controller.signal.aborted || event.data.length > 131_072) return;
        try {
          const data: unknown = JSON.parse(event.data);
          if (!data || typeof data !== "object" || Array.isArray(data)) return;
          const item = data as Record<string, unknown>;
          setEvents((state) => ({ id: observedId!, items: [
            ...(state?.id === observedId ? state.items.slice(-99) : []), item,
          ] }));
          if (["run.completed", "run.failed", "run.cancelled"].includes(String(item.event))) source?.close();
        } catch { /* Ignore invalid events; the bounded status view remains available. */ }
      };
      source.onerror = () => {
        if (++streamFailures >= 3) {
          source?.close();
          if (!controller.signal.aborted) setNotice("Live events unavailable; showing runtime status when supported.");
        }
      };
    }
    return () => { controller.abort(); clearTimeout(timer); source?.close(); };
  }, [base, observedId, runtime, hasRun, revision]);

  function chooseAction(id: string) {
    setSelectedAction(id); setObservation(null); setEvents(null); setNotice("");
  }
  const sessionId = observation?.snapshot.session_id;
  const runtimeMessages = Array.isArray(observation?.snapshot.messages) ? observation.snapshot.messages : [];
  return <section className="deliveryPanel" aria-label="Runtime output and delivery history">
    <div className="sectionTitle"><span>RUNTIME OUTPUT</span><button onClick={() => { setNotice(""); setRevision((value) => value + 1); }}>Refresh</button></div>
    {notice && <p role="status">{notice}</p>}
    {!observedId && <p>No saved commands for this agent yet.</p>}
    {observedId && runtime === "Hermes" && !hasRun && <p>No run ID was saved. Inspect the runtime before repeating this command.</p>}
    {observation && <div className="runtimeOutput">
      <p>{observation.kind === "history" ? "Recent runtime session history (polled)" : `Run status: ${String(observation.snapshot.status ?? "unknown")}`}</p>
      {typeof observation.snapshot.output === "string" && <p className="preserveText">{observation.snapshot.output}</p>}
      {runtimeMessages.map((message, index) => {
        if (!message || typeof message !== "object") return null;
        const row = message as Record<string, unknown>;
        const text = typeof row.content === "string" ? row.content : Array.isArray(row.content)
          ? row.content.filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
            .map((part) => part.text).join("\n") : "";
        return text ? <div key={index}><strong>{String(row.role ?? "runtime")}</strong><p className="preserveText">{text}</p></div> : null;
      })}
      <details><summary>Runtime details and messages</summary><pre>{JSON.stringify(observation.snapshot, null, 2)}</pre></details>
      {canCommand && typeof sessionId === "string" && sessionId.length <= 256 &&
        ["completed", "failed", "cancelled"].includes(String(observation.snapshot.status)) &&
        <button className="button ghost" onClick={() => onContinue(sessionId)}>Continue in this session (new run)</button>}
    </div>}
    {events.length > 0 && <details open><summary>Live runtime events (latest 100)</summary>
      <div className="runtimeEvents" role="log" aria-label="Runtime events">
        {events.map((event, index) => <div key={`${event.seq ?? index}:${index}`}>
          <strong>{String(event.event ?? "event")}</strong>
          <pre>{typeof event.delta === "string" ? event.delta : JSON.stringify(event, null, 2)}</pre>
        </div>)}
      </div>
    </details>}
    <h4>Delivery history</h4>
    <p>“Delivered” means accepted by the runtime, not finished execution. Uncertain commands are never automatically resent.</p>
    {actions.slice(0, 20).map((action) => <article className="deliveryReceipt" key={action.id}>
      <strong>{action.action} · {action.state === "completed" ? "delivered" : action.state}</strong>
      <small>{new Date(action.createdAt).toLocaleString()}</small>
      {action.lastError && <p>{action.lastError}</p>}
      <details><summary>Receipt and original request</summary><pre>{JSON.stringify(action, null, 2)}</pre></details>
      {action.action === "message" && <button className="button ghost" onClick={() => chooseAction(action.id)}>Inspect runtime output</button>}
      {canManage && action.state === "unknown" && <button className="button ghost" onClick={() => { setReconcileId(action.id); setNote(""); }}>Record verified outcome</button>}
    </article>)}
    {reconcileId && <form onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setSaving(true);
      try {
        await api(`${base}/${reconcileId}`, { method: "PATCH", body: JSON.stringify({ observedOutcome: outcome, note }) });
        setReconcileId(""); setRevision((value) => value + 1);
        setNotice("Verification recorded. No command was resent.");
      } catch (error) { setNotice(error instanceof Error ? error.message : "Could not record verification."); }
      finally { setSaving(false); }
    }}>
      <label>Observed in the runtime<select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
        <option value="delivered">Command was delivered</option><option value="not_delivered">Command was not delivered</option>
      </select></label>
      <label>Evidence (run ID, timestamp, or runtime log)<textarea required minLength={10} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="button primary" disabled={saving}>Save verification</button>
      <button className="button ghost" type="button" onClick={() => setReconcileId("")}>Cancel</button>
    </form>}
  </section>;
}
