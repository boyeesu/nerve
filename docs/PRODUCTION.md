# Production readiness

This release is a production-oriented foundation, not a `v1.0` compatibility
guarantee. Operators should review each control below before exposing Nerve.

## Implemented controls

- HTTP-only, Secure, SameSite operator sessions backed by a high-entropy access
  key;
- viewer, operator, and admin authorization with independently rotatable access
  keys;
- server-side API authorization and same-origin checks on cookie-authenticated
  mutations;
- AES-256-GCM encryption for runtime credentials;
- SSRF controls for runtime endpoints, including DNS resolution and metadata
  address blocking;
- PostgreSQL migrations with an advisory lock and checksum verification;
- action persistence, idempotency keys, explicit dispatching/unknown states,
  controlled retries, and append-only audit events;
- database-backed distributed login rate limiting;
- least-privilege OpenClaw scopes with admin opt-in;
- no credential fields in connection list responses or audit metadata;
- container runs as a non-root user;
- public readiness endpoint that fails closed when auth, encryption, or
  database configuration is missing;
- protected GitHub main branch, required CI, code-owner review, signed commits,
  secret scanning, Dependabot, and CodeQL.
- contract tests for live-shaped OpenClaw WebSocket and Hermes HTTP exchanges;
- zero known production dependency vulnerabilities at release time.

## Required before a stable release

- a multi-user identity provider and workspace-level isolation;
- durable event streaming/reconciliation rather than request-time polling;
- an approval policy engine for every high-risk action;
- a background job queue for long-running fan-out;
- independent penetration testing and threat-model review.

Until these items land, use one Nerve deployment per trusted team and data
boundary. Put an identity-aware proxy or Railway access policy in front of any
internet-facing instance, and follow [Operations](OPERATIONS.md) and the
[Threat model](THREAT_MODEL.md).
