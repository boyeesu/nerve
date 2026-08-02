<p align="center">
  <img src="public/assets/nerve-logo.png" alt="Nerve command-center robot mascot" width="280" />
</p>

<h1 align="center">Nerve</h1>

<p align="center">
  <strong>See every agent. Understand every run. Command the whole fleet.</strong>
</p>

<p align="center">
  An open-source visual command center for OpenClaw and Hermes agents.
</p>

<p align="center">
  <a href="https://github.com/boyeesu/nerve/actions/workflows/ci.yml"><img src="https://github.com/boyeesu/nerve/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-8b5cf6.svg" alt="MIT license" /></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22-4f9b45.svg" alt="Node 22 or newer" /></a>
  <a href="docs/ROADMAP.md"><img src="https://img.shields.io/badge/status-public_alpha-f0a52b.svg" alt="Public alpha" /></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#why-nerve">Why Nerve</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="docs/ADAPTERS.md">Adapter contract</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="public/assets/nerve-dashboard.png" alt="Nerve dashboard showing OpenClaw and Hermes agents on a live mission map" width="100%" />
</p>

> [!IMPORTANT]
> Nerve is currently a public-alpha interface prototype. The dashboard,
> interactions, and normalized domain model are implemented; live OpenClaw and
> Hermes adapters are the next major milestone.

## Why Nerve

Agent runtimes are good at running agents. They are not always the best place
to understand a whole organization of agents at once.

Nerve sits above individual runtimes and gives operators one legible surface:

- a spatial map of agents, missions, handoffs, and dependencies;
- a live view of what each agent is doing and why it needs attention;
- one conversation layer across OpenClaw and Hermes;
- fleet-wide commands with explicit approval and audit boundaries;
- runtime-neutral traces, metrics, artifacts, and memory references.

The goal is not to replace agent runtimes. It is to make operating many of them
calm, observable, and safe.

## Current prototype

- Unified OpenClaw and Hermes agent map
- Working, waiting, completed, and idle states
- Agent filtering and canvas zoom
- Run inspection with progress, trace, model, token, and timing data
- Pause and resume controls
- Direct operator-to-agent questions
- Fleet-wide command bar
- Responsive layouts for desktop and smaller screens

The sample agents and responses are simulated. See the
[roadmap](docs/ROADMAP.md) for the path to live integrations.

## Quickstart

### Requirements

- Node.js 22.13 or newer
- npm 10 or newer

### Run locally

```bash
git clone https://github.com/boyeesu/nerve.git
cd nerve
npm install
npm run dev
```

Open the local URL printed in your terminal.

### Validate a change

```bash
npm run build
node --test tests/rendered-html.test.mjs
npm run lint
```

## How it fits together

```mermaid
flowchart LR
    OC["OpenClaw"] --> OCA["OpenClaw adapter"]
    HE["Hermes"] --> HEA["Hermes adapter"]
    OCA --> EN["Event normalizer"]
    HEA --> EN
    EN --> MG["Mission graph"]
    EN --> TS["Trace store"]
    UI["Nerve UI"] <--> API["Control API"]
    API <--> MG
    API <--> TS
    API --> CB["Command bus"]
    CB --> OCA
    CB --> HEA
    PE["Policy + approvals"] --> CB
```

Nerve treats each runtime as an adapter behind a shared model for agents,
runs, events, messages, commands, approvals, and artifacts. Read
[Architecture](docs/ARCHITECTURE.md) for system boundaries and
[Adapter contract](docs/ADAPTERS.md) for the proposed integration interface.

## Project status

| Area | Status |
| --- | --- |
| Product interface | Interactive prototype |
| Normalized domain model | Draft specification |
| OpenClaw adapter | Planned |
| Hermes adapter | Planned |
| Live event transport | Planned |
| Authentication and tenancy | Planned |
| Policy and approvals | Planned |

No production compatibility promise is made before `v1.0.0`. Breaking changes
will be documented in [CHANGELOG.md](CHANGELOG.md).

## Documentation

| Document | Purpose |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | System boundaries, services, data flow, safety, and deployment |
| [Adapter contract](docs/ADAPTERS.md) | Runtime-neutral types, events, capabilities, and commands |
| [Development](docs/DEVELOPMENT.md) | Setup, project layout, testing, and local workflows |
| [Roadmap](docs/ROADMAP.md) | Milestones from prototype to stable release |
| [Governance](GOVERNANCE.md) | Decision-making, roles, and project stewardship |
| [Contributing](CONTRIBUTING.md) | How to propose, build, test, and submit changes |
| [Security](SECURITY.md) | Supported versions and responsible disclosure |
| [Support](SUPPORT.md) | Where to ask questions and report problems |
| [Code of Conduct](CODE_OF_CONDUCT.md) | Community participation standards |

## Contributing

Contributions are welcome, especially around runtime adapters, event
normalization, observability, accessibility, and operator safety.

Start with [CONTRIBUTING.md](CONTRIBUTING.md), review the
[architecture](docs/ARCHITECTURE.md), and use the repository issue forms before
beginning a large change.

## Security

Please do not report vulnerabilities in public issues. Follow the private
disclosure process in [SECURITY.md](SECURITY.md).

## License

Nerve is available under the [MIT License](LICENSE).
