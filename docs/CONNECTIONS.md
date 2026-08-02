# Connecting OpenClaw and Hermes

Nerve connects from its server to each runtime. Runtime credentials never pass
back to the browser and are encrypted with AES-256-GCM before PostgreSQL
storage.

## Hermes

Hermes has a documented HTTP API server today.

On the Hermes host:

```bash
# ~/.hermes/.env
API_SERVER_ENABLED=true
API_SERVER_KEY=replace-with-a-long-random-value
```

Start it with `hermes gateway`, then expose `http://127.0.0.1:8642` through a
private network or TLS tunnel. In Nerve choose **Hermes**, enter the public or
private reachable base URL and `API_SERVER_KEY`, then select **Test & connect**.

Nerve uses:

- `/health/detailed` and `/v1/capabilities` for readiness/capability discovery;
- `/v1/runs` for commands and run creation;
- `/v1/runs/{id}/stop` and `/approval` for operator actions;
- `/v1/skills` for installed-skill discovery.

Hermes' documented API exposes installed skills read-only. Nerve can assign an
already-installed skill, while installation still happens through Hermes
itself. Hermes jobs can select skills in their job definition.

## OpenClaw

OpenClaw has a documented Gateway WebSocket control plane today. Create a
gateway token with only the scopes Nerve needs and expose the gateway through
WSS or a trusted private network.

In Nerve choose **OpenClaw**, enter the WSS Gateway URL and token, and choose
whether to request `operator.admin`. Nerve generates a dedicated Ed25519 device
identity. On the first remote connection, OpenClaw may hold it for device
pairing:

1. Nerve shows `pending_pairing`.
2. Approve the Nerve device in OpenClaw.
3. Retry the connection probe.

Default scopes are:

- `operator.read` for agent and skill discovery;
- `operator.write` for messaging and stopping work;
- `operator.approvals` for approval actions.

`operator.admin` is opt-in and is needed for privileged operations such as
installing a ClawHub skill. Nerve calls `agents.list`, `skills.status`,
`skills.install`, `chat.send`, and `sessions.abort` through protocol v4.

OpenClaw's published npm gateway packages are currently reserved at version
`0.0.0`, so Nerve implements the small protocol-v4 subset it needs. The adapter
must be contract-tested against every supported OpenClaw release before Nerve
declares a stable compatibility range.

## Network and credential safety

- Public deployments require HTTPS/WSS by default.
- DNS targets are resolved before connection; private targets are rejected
  unless the operator explicitly enables private networking.
- Link-local and cloud metadata targets remain blocked.
- Redirects are disabled for Hermes API calls.
- Credentials are never logged, returned by list APIs, or included in audit
  metadata.
- Delete a runtime connection to delete its encrypted credential and dependent
  action/skill records.

For a local-only runtime, a hosted Nerve instance cannot use the runtime's
`localhost` address. Use a private network/tunnel, or run Nerve beside the
runtime. An outbound Nerve bridge is a future transport option, not part of the
current release.

## Upstream references

- [Hermes API server](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/api-server.md)
- [Hermes programmatic integration](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/programmatic-integration.md)
- [OpenClaw Gateway protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw external applications](https://docs.openclaw.ai/gateway/external-apps)
