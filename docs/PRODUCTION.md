# Production readiness

This release is a production-oriented foundation, not a `v1.0` compatibility
guarantee. Operators should review each control below before exposing Nerve.

## Implemented controls

- HTTP-only, Secure, SameSite operator sessions backed by a high-entropy access
  key;
- server-side API authorization and same-origin checks on cookie-authenticated
  mutations;
- AES-256-GCM encryption for runtime credentials;
- SSRF controls for runtime endpoints, including DNS resolution and metadata
  address blocking;
- PostgreSQL migrations with an advisory lock and checksum verification;
- action persistence, idempotency keys, and append-only audit events;
- least-privilege OpenClaw scopes with admin opt-in;
- no credential fields in connection list responses or audit metadata;
- container runs as a non-root user;
- public readiness endpoint that fails closed when auth, encryption, or
  database configuration is missing;
- protected GitHub main branch, required CI, code-owner review, signed commits,
  secret scanning, Dependabot, and CodeQL.

## Required before a stable release

- a multi-user identity provider and workspace-level RBAC;
- durable event streaming/reconciliation rather than request-time polling;
- runtime compatibility fixtures pinned to supported OpenClaw/Hermes versions;
- an approval policy engine for every high-risk action;
- distributed rate limiting and abuse controls;
- telemetry, alerting, backup restore drills, and credential rotation tooling;
- a background job queue for long-running fan-out;
- independent penetration testing and threat-model review.

Until these items land, use Nerve as a single-operator control plane on a
trusted deployment. Put an identity-aware proxy or Railway access policy in
front of any internet-facing instance.
