# ManClaw

ManClaw is an open-source visual command center for fleets of OpenClaw and
Hermes agents.
Instead of switching between individual agent runtimes, operators get one
spatial map of every agent, its mission, current work, status, and conversation.

The current interface prototype is codenamed **Nerve**.

## Prototype

The first version demonstrates the core operating loop:

- view OpenClaw and Hermes agents on one mission map;
- filter agents by working, waiting, and completed states;
- zoom the fleet canvas;
- select an agent to inspect its task, progress, runtime, trace, and metrics;
- pause or resume an agent run;
- ask a selected agent questions without leaving the command center;
- issue a command to the whole fleet from the shared command bar.

The current agent data and responses are simulated. The interface is structured
so real runtime events can replace the sample data without changing the product
model.

## Integration model

Nerve should treat OpenClaw and Hermes as adapters behind a shared event model:

```text
OpenClaw ─┐
          ├─ Runtime adapters ─ Event normalizer ─ Mission graph ─ Live UI
Hermes  ──┘                         │                    │
                                   ├─ Command bus       ├─ Agent inspector
                                   ├─ Trace store       └─ Conversation relay
                                   └─ Policy/approval engine
```

Each adapter should normalize these primitives:

- `agent`: identity, runtime, capabilities, model, health;
- `run`: task, state, progress, timestamps, token and cost metrics;
- `event`: thought-safe summary, tool call, approval request, output, error;
- `message`: operator-to-agent and agent-to-operator conversation;
- `command`: start, pause, resume, cancel, reassign, broadcast;
- `artifact`: file, report, code change, link, or structured result.

For a production service, use an ingestion gateway for runtime webhooks and
streaming events, a command bus for reversible control actions, Postgres for
missions and traces, and a WebSocket or Server-Sent Events channel for the live
map. Runtime credentials should remain encrypted and scoped per workspace.

## Local development

```bash
npm install
npm run dev
```

Validation:

```bash
npm run build
node --test tests/rendered-html.test.mjs
npm run lint
```

## License

[MIT](LICENSE)
