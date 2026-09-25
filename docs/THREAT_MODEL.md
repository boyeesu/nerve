# Threat model

## Scope

This model covers the Nerve web application, PostgreSQL data store, operator
browser sessions, and outbound OpenClaw/Hermes connections. Runtime hosts,
models, and skills remain independently trusted systems.

## Assets

- operator access keys and signed sessions;
- OpenClaw and Hermes credentials;
- agent identities, run summaries, commands, approvals, and audit history;
- database backups and `NERVE_ENCRYPTION_KEY`;
- the authority to stop work, start work, approve requests, or install skills.

## Trust boundaries

1. An operator browser crosses the public HTTP boundary into Nerve.
2. Nerve crosses an outbound network boundary to each runtime.
3. Application processes cross the database boundary into PostgreSQL.
4. Maintainer changes cross the source-control and deployment pipeline.
5. Runtime-returned text crosses an untrusted-content boundary before display.

## Primary threats and controls

| Threat | Current controls |
| --- | --- |
| Stolen or shared operator key | Role-scoped keys, constant-time matching, signed expiring HTTP-only sessions, distributed unlock limiter |
| Cross-site command request | SameSite cookies and same-origin enforcement on authenticated mutations |
| Runtime credential disclosure | AES-256-GCM at rest, server-only adapter calls, redacted API responses and audits |
| SSRF through runtime URL | HTTPS/WSS requirement, DNS and IP validation, metadata/link-local blocking, private-network opt-in |
| Unauthorized high-risk action | Viewer/operator/admin permissions, admin-only approvals and skill installation, runtime-native approval gates |
| Duplicate or ambiguous command | Durable action record, idempotency key, dispatching/unknown states, explicit audited retries |
| Malicious runtime output | Render as data, never instructions; preserve React escaping and avoid raw HTML |
| Supply-chain compromise | Locked dependencies, production dependency audit, Dependabot cooldown, CodeQL, signed protected branch |
| Database loss | Platform backups and documented restore drills |
| Cross-team data exposure | Not solved inside one deployment; use separate deployments until workspace isolation ships |

## Security assumptions

- Deployment administrators protect Railway, GitHub, database, and secret
  manager access with strong authentication.
- TLS terminates at a trusted platform and `NERVE_PUBLIC_URL` matches the
  operator-visible origin.
- Operators grant runtime credentials only the scopes they intend Nerve to use.
- `NERVE_ALLOW_PRIVATE_NETWORKS=true` is used only on a trusted network.
- PostgreSQL backups and the encryption key are stored separately.

## Known residual risk

- Nerve is not a multi-tenant security boundary.
- Runtime protocol changes may break compatibility before `v1.0`.
- Request-time runtime delivery cannot guarantee whether a command executed
  when the connection fails after transmission.
- The built-in role model is not a substitute for enterprise identity,
  lifecycle management, or an identity-aware proxy.
- Independent penetration testing is still required before a stable release.

Review this model when adding a runtime adapter, privileged action, new secret,
file/artifact renderer, identity provider, or workspace feature.
