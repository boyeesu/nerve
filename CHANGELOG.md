# Changelog

All notable changes to Nerve will be documented here.

The project follows [Semantic Versioning](https://semver.org/) once public
releases begin. During public alpha, minor releases may contain breaking
changes.

## Unreleased

## 0.2.0 — 2026-09-25

### Added

- Open-source community documentation and contribution templates
- Nerve logo and product screenshot
- Continuous-integration workflow
- Authenticated control-plane APIs and secure runtime onboarding
- Encrypted PostgreSQL connection registry, skill assignments, action ledger,
  and audit events
- Hermes HTTP and OpenClaw Gateway protocol-v4 adapter foundations
- Live agent discovery, operator commands, stop controls, and skill drill-down
- Railway Docker/config-as-code packaging, migrations, and readiness health
  checks
- Endpoint SSRF policy, pinned dependency install-script policy, and production
  security headers
- Viewer, operator, and admin access keys with signed role-scoped sessions
- Distributed unlock rate limiting and duplicate-connection protection
- OpenClaw WebSocket and Hermes HTTP adapter contract tests
- Production operations runbook and threat model

### Changed

- Actions now preserve dispatch attempts and ambiguous outcomes for explicit,
  audited reconciliation
- The runtime dependency set was reduced to the supported Next.js deployment
  path and upgraded to patched releases
- CI now enforces production dependency audit and TypeScript checks

### Security

- AES-GCM decryption requires a full 128-bit authentication tag
- High-risk connection, approval, and skill mutations require admin permission
- Action idempotency keys are bound to the original connection and payload

## 0.1.0 — 2026-08-02

### Added

- Spatial mission map for OpenClaw and Hermes agents
- Agent status filtering and zoom controls
- Agent run inspector with progress, activity, and metrics
- Pause and resume interaction
- Direct agent Q&A prototype
- Fleet-wide command bar
- Responsive layouts
