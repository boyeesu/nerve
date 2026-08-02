# Runtime adapter contract

Adapters connect agent runtimes to ManClaw without teaching the core about
runtime-native APIs.

This is a draft contract for discussion and implementation.

## Responsibilities

An adapter must:

- identify its runtime and supported version;
- declare capabilities;
- discover or receive agent state;
- normalize run events;
- translate supported ManClaw commands;
- verify inbound runtime events when applicable;
- redact secrets and sensitive fields;
- make retries and idempotency behavior explicit;
- report health, lag, and degraded state.

## Capability declaration

Capabilities prevent ManClaw from presenting controls that a runtime cannot
safely support.

```ts
export type AdapterCapabilities = {
  commands: Array<
    | "run.start"
    | "run.pause"
    | "run.resume"
    | "run.cancel"
    | "message.send"
  >;
  events: string[];
  artifacts: boolean;
  conversations: boolean;
  historicalSync: boolean;
  nativeApprovals: boolean;
};
```

Capability values should be discovered per connection when runtime
configuration can change them.

## Event envelope

```ts
export type AgentEventEnvelope<T = unknown> = {
  schema_version: "2026-08-01";
  event_id: string;
  event_type: string;
  workspace_id: string;
  connection_id: string;
  runtime: "openclaw" | "hermes" | string;
  agent_id?: string;
  run_id?: string;
  runtime_sequence?: number;
  observed_at: string;
  emitted_at: string;
  summary?: string;
  payload: T;
  redactions?: string[];
};
```

`summary` is an operator-safe explanation. It must not contain hidden
chain-of-thought or secrets.

## Initial event types

| Type | Meaning |
| --- | --- |
| `connection.health.changed` | Runtime connection health changed |
| `agent.discovered` | Agent identity or capability became available |
| `agent.state.changed` | Agent working, waiting, idle, or unavailable |
| `run.started` | A bounded execution began |
| `run.progressed` | Safe progress summary or percentage changed |
| `run.waiting` | Run requires input, approval, or external state |
| `run.completed` | Run completed successfully |
| `run.failed` | Run ended with an error |
| `message.created` | Operator or agent message was created |
| `artifact.created` | A file, report, link, or result became available |
| `command.acknowledged` | Runtime accepted or rejected a command |

## Commands

```ts
export type AgentCommand<T = unknown> = {
  command_id: string;
  idempotency_key: string;
  workspace_id: string;
  connection_id: string;
  agent_id?: string;
  run_id?: string;
  command_type: string;
  requested_by: string;
  requested_at: string;
  payload: T;
};
```

Adapters return an acknowledgement, not a claim that the desired state has
already occurred. A later runtime event confirms completion.

## Adapter interface

```ts
export interface RuntimeAdapter {
  readonly runtime: string;

  describe(): Promise<{
    adapterVersion: string;
    runtimeVersion?: string;
    capabilities: AdapterCapabilities;
  }>;

  health(): Promise<{
    status: "connected" | "degraded" | "disconnected";
    observedAt: string;
    detail?: string;
  }>;

  sync(cursor?: string): AsyncIterable<AgentEventEnvelope>;

  execute(command: AgentCommand): Promise<{
    commandId: string;
    accepted: boolean;
    runtimeCommandId?: string;
    reason?: string;
  }>;

  dispose(): Promise<void>;
}
```

## Identity mapping

ManClaw IDs are stable within a workspace. Adapters must keep explicit mappings
to runtime-native identifiers. A runtime identifier must never be accepted
without matching its workspace and connection.

## Ordering and delivery

- Events are processed at least once.
- `event_id` must be globally unique.
- `runtime_sequence` is recommended when the runtime provides ordering.
- Adapters should persist cursors for historical synchronization.
- Clock time alone must not determine ordering.

## Redaction

Adapters are the first trust boundary. They should remove:

- access tokens, cookies, and authorization headers;
- private keys and environment secrets;
- configured prompt or memory fields;
- raw tool output that may contain credentials;
- hidden model reasoning.

When a field is removed, record its JSON path in `redactions` without recording
the removed value.

## Contract tests

Every adapter should ship fixtures covering:

- discovery and capability declaration;
- duplicate events;
- out-of-order events;
- reconnect and cursor recovery;
- idempotent command replay;
- unsupported command rejection;
- secret redaction;
- degraded and disconnected health.

## Proposing an adapter

Use the adapter-request issue form. Include the runtime's official
documentation, authentication model, event transport, command surface,
versioning policy, and a maintainer plan.

