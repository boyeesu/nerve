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
- atomic concurrent login claims, server-side logout revocation, key/role/workspace
  rotation invalidation, and application-level workspace scoping;
- durable background delivery, audit outbox recovery, attempt fencing, and
  evidence-backed manual reconciliation;
- persisted missions with confirmed, atomic queueing of up to 25 target commands;
- least-privilege OpenClaw scopes with admin opt-in;
- no credential fields in connection list responses or audit metadata;
- container runs as a non-root user;
- public readiness endpoint that fails closed when auth, encryption, or
  database configuration is missing;
- checked-in CI, code-owner, Dependabot, and CodeQL configuration; verify hosted
  branch protection, required checks, signing and scanning settings separately;
- contract tests for live-shaped OpenClaw WebSocket and Hermes HTTP exchanges;
- production dependency audit gate; dated scan results in [REVIEW.md](REVIEW.md).

## Required before a stable release

- real-runtime compatibility and version/pairing/skill-install checks;
- hosted identity/ingress verification and backup restoration;
- a multi-user identity provider, provisioning, and stronger tenant isolation
  for mutually untrusted customers (beyond application workspace scoping);
- durable event archival/replay beyond the bounded live preview;
- an approval policy engine for every high-risk action;
- production load/soak testing of the durable queue and rate limits;
- independent penetration testing and threat-model review.

Use one Nerve deployment per trusted team and data boundary. Put an
identity-aware proxy or Railway access policy in front of any
internet-facing instance, and follow [Operations](OPERATIONS.md) and the
[Threat model](THREAT_MODEL.md).
