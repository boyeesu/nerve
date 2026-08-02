# Roadmap

Nerve is in public alpha. This roadmap communicates direction, not guaranteed
dates. Priorities may change as runtime APIs and contributor feedback evolve.

## Phase 0 — Product proof

Status: **complete**

- Spatial mission map
- OpenClaw and Hermes representation
- Agent run inspector
- Status filtering and zoom
- Pause/resume interaction prototype
- Direct agent Q&A prototype
- Responsive product shell
- Open-source project foundation

## Phase 1 — Runtime foundation

Status: **next**

- Publish versioned adapter contract
- Implement connection registry and capability negotiation
- Build event ingestion and normalized state reducer
- Add OpenClaw adapter
- Add Hermes adapter
- Replace sample fleet data with live streams
- Add adapter contract fixtures and replay tests

Exit criterion: operators can connect one supported instance of each runtime
and observe live agents and runs.

## Phase 2 — Safe command

- Durable command bus and idempotency
- Pause, resume, cancel, start, and message commands
- Policy evaluation and approval-required states
- Complete command audit trail
- Degraded runtime and reconnect handling
- Operator notifications for waiting and failed runs

Exit criterion: supported commands are delivered safely and their outcomes are
confirmed by runtime events.

## Phase 3 — Mission operations

- Persisted missions and fleet layout
- Agent-to-agent handoff visualization
- Artifact and report browser
- Search across agents, runs, and safe summaries
- Saved views and filters
- Cost, token, latency, and health analytics
- Team workspaces and role-based access

## Phase 4 — Ecosystem

- Adapter SDK and conformance suite
- Community adapter registry
- Webhook and automation API
- Exportable audit history
- Deployment guides
- Accessibility audit
- Localization foundation

## Toward 1.0

The stable release requires:

- documented compatibility policy;
- production authentication and workspace isolation;
- security review of command and connector boundaries;
- reliable event recovery and adapter health;
- migration and upgrade documentation;
- stable public adapter and API contracts;
- end-to-end tests for supported runtimes.

## How to influence the roadmap

Open a feature or adapter request with the user problem, affected operators,
runtime constraints, safety implications, and a proposed success measure.

