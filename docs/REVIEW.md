# App review — updated October 6, 2026

## Production release preparation — October 6

Additional release fixes:

- Quarantine legacy pending commands during the worker upgrade rather than
  unexpectedly executing them after deployment.
- Recheck the actor's role and workspace before delivering queued commands.
- Preserve mission launch identity across dialog closure and page reload,
  scoped by actor/workspace in tab session storage.
- Exclude local Railway metadata, screenshots, and work artifacts from Docker.
- Make the container healthcheck honor the host-assigned `PORT`, including
  Railway's production port rather than assuming 3000.

Verification:

- **34 tests passed, zero skipped**, on both the host and the Docker Node 22
  build environment. Lint, TypeScript, production build, Docker build, and
  whitespace validation passed.
- Browser smoke includes repeated mission launch after closing the dialog and
  after reloading: still one runtime delivery. Other flow/mobile checks passed.
- A fresh migration/backup/restore rehearsal matched all eight application tables.
- The final non-root Docker image migrated a separate fixture database and passed
  its container healthcheck repeatedly on port 8080.
- Production dependency audit remains clean. The development-only `braces`
  advisory remains unpatched; no incompatible lint-framework downgrade was used.

Production preflight:

- Confirmed Railway project `nerve-template-source`, `production` environment,
  service `nerve`, GitHub source `boyeesu/nerve`, branch `main`.
- The current deployment is healthy at
  `https://nerve-production-da9a.up.railway.app`; deployed revision remains
  `014cb5116738c2b99b823c3b29c9a8d9880d59b1`.
- Verified required secret settings exist without changing them. Worker hosting
  is long-lived (not sleeping), private-network access is disabled, and the
  trusted-IP override is unset. Edge abuse protection is not verified.
- Read-only production database inspection found one enabled OpenClaw
  connection, one completed action, no pending actions, and migrations through
  `0002`. Authenticated read-only agent discovery returned four agents. No
  runtime command, skill install, or production database migration was performed.
- Created and confirmed provider backup **Nerve pre-release 2026-10-06**,
  ID `c24f29c6-794d-44ff-8446-516d0c39d009`. This is a backup confirmation,
  not a production restore test.
- GitHub requires passing **Build, test, and lint**, a code-owner approval,
  approval after the last push, and resolved conversations; enforcement includes
  administrators. The only current code owner/collaborator is the PR author.
  Production deployment must wait for an authorized independent reviewer and
  a normal protected merge. Do not bypass this through CLI uploads, an admin
  merge, self-approval, or weakened protection settings.

This release preparation is not completion of the entire product roadmap.
Durable runtime event archival/replay, enterprise identity/provisioning,
high-risk approval policy, production soak/restore testing, and independent
security/accessibility assessments remain explicit follow-up work.

## October 6 completion pass

Implemented the remaining locally actionable corrections:

- **Durable commands:** atomic claims shared by HTTP and background workers,
  attempt fencing, recovery of undispatched requests, and interrupted deliveries
  moved to `unknown` without automatic resend. Added saved delivery history and
  administrator reconciliation with runtime evidence and an atomic audit.
- **Mutation outcomes:** connection/probe/skill/action auditing no longer turns
  a successful operation into an apparent failure. Failed audit writes use a
  transactional recovery outbox; warnings are surfaced to the UI. Probe results
  no longer expose an issued OpenClaw device token.
- **Identity:** workspace-scoped connection, mission, delivery and observation
  routes; atomic concurrent login claims; explicitly configured trusted proxy
  headers; v3 sessions invalidated by key/role/workspace rotation; server-side
  logout revocation and expiry cleanup.
- **Product:** saved missions, reviewed target lists, confirmed durable fleet
  fan-out (up to 25 targets), per-target receipts, Hermes live reply/tool events
  and run status, and OpenClaw polled session history. Hermes continuation starts
  a **new run in the same session**, not an invented resume endpoint.
- **Operations:** mandatory PostgreSQL integration in checked-in CI, a
  self-contained local integration runner, optional browser smoke runner, local
  backup/restore rehearsal, migration-aware readiness, and updated runbooks.
- **Dependencies:** `source-map-js` 1.2.2, `sharp` 0.35.5 (including patched
  libvips packages), and development `brace-expansion` 1.1.21 / 5.0.12.

### Verification of this pass

- **32 tests passed, zero skipped**, including real HTTP routes and disposable
  PostgreSQL integration.
- Covered concurrent claims, stale-claim fencing, no unsafe redelivery,
  concurrent mission replay, foreign-workspace rejection without contacting the
  runtime, signed-cookie logout revocation, key rotation, 24 concurrent login
  claims admitting only eight, injected audit failure/outbox recovery, and
  scoped runtime observation.
- Production build, type checking, lint and whitespace validation passed.
- Browser smoke passed for mission creation/launch/persistence, queued delivery,
  visible runtime output/events, session-continuation selection, keyboard modal
  close, sign-out, viewer restrictions and 390px mobile layout. A hidden mobile
  mission button was found and fixed. Desktop/mobile screenshots were inspected.
- PostgreSQL backup restored into a distinct empty fixture database; migration
  checksums and all eight application tables matched. A restored encrypted
  credential decrypted successfully using the retained fixture encryption key.
- Production dependency audit: **zero known vulnerabilities**. Full development
  audit still reports **five high-severity entries** arising from one unpatched
  `braces` issue and its dependency chain. The upstream advisory
  `GHSA-vfj7-8cjw-p6xm` lists no fixed release. The offered automated workaround
  downgrades Next's lint configuration across major versions; it was not applied.
  Do not pass attacker-controlled pathological glob patterns into lint tooling.

### Still required / intentionally limited

1. **Real deployments:** verify actual OpenClaw/Hermes versions, pairing and
   skill installation, hosted ingress/edge limits, production load/soak behavior,
   and the hosting provider's backup/restore procedure. See the newer release
   preflight above for the subsequently confirmed production access, backup,
   read-only discovery, and protected-merge gate.
2. **Independent review:** security/penetration testing and a complete
   accessibility assessment remain external release gates.
3. **Event durability and identity scope:** live previews are bounded and not a
   durable event archive/replay service. Reconciliation is explicit
   administrator verification, not automatic proof of execution. Application
   workspaces are not isolated databases or runtime tenants; use separate
   credentials/deployments for mutually untrusted teams. SSO/MFA/provisioning and
   a general high-risk approval policy engine remain roadmap work.
4. **Runtime-native resume:** the inspected Hermes API has stop, status, SSE,
   steer and approval routes but no in-place resume route. Session continuation
   is labeled accurately. OpenClaw output currently uses history polling rather
   than a persistent event subscription.
5. **Upstream dependency fix:** replace the development-only `braces` chain when
   a compatible fixed release becomes available.

Runtime interface checks used local upstream source snapshots: Hermes
`2eeaeff0` (`api_server_runs.py`, status/events/session continuation) and
OpenClaw `92c51f4` (chat-history handler and protocol schema). These source
checks and fixtures do **not** establish deployed-runtime compatibility.

No deployment or Git commit was performed during this earlier completion pass.
See the release-preparation section above for the subsequent release status.

---

## September 25 review (historical baseline)

## Scope

Reviewed the command-center UI, authentication and API routes, runtime adapters,
database access, request validation, network policy, local setup, deployment
configuration, and tests. Implemented targeted corrections rather than a broad
framework or dependency upgrade. Existing authentication work was preserved
and extended. No production services or real runtime credentials were used.

## Corrections implemented

| Area | Correction |
| --- | --- |
| Action replay | Compare structured values instead of serialized JSON, so PostgreSQL JSONB key ordering does not break replay. Bind each key to its actor, connection, agent, action, and payload. |
| Retry safety | Permit explicit redispatch only for OpenClaw messages that forward the original deduplication key. Block unsafe Hermes, stop, and approval retries. |
| Outcome integrity | Treat HTTP 202 error responses as uncertain, not successful. Do not mark delivered commands failed because later audit logging fails. |
| Authentication | Enforce the configured origin for cookie mutations, reject invalid bearer credentials without falling back to cookies, and expose the authenticated role to the UI. |
| Input boundaries | Bound actual streamed request bytes; reject malformed/non-object JSON, invalid action identifiers, missing runtime-specific parameters, and malformed connection UUIDs. |
| Network policy | Handle IPv6 and IPv4-mapped IPv6 consistently, retain metadata blocking, and revalidate stored endpoints before use, including IP literals. |
| Runtime adapters | Bound HTTP/WebSocket responses, reject malformed protocol frames, prevent duplicate handshake messages from redispatching commands, and allow enough time for skill installation. |
| Disabled connections | Reject discovery, probing, skill access, and actions without contacting a disabled runtime. |
| Runtime state | Do not interpret historical Hermes runs as active work. Clear failed/stale discoveries and show their connection error rather than a healthy fleet or demo fallback. |
| Command UI | Send to the selected agent, isolate receipts and pending state per agent, block duplicate clicks, and prevent late responses from updating a new signed-in session. |
| Product accuracy | Remove fabricated runtime replies, progress, traces, and elapsed time. Explain that Hermes skill assignments are Nerve bookkeeping, not runtime activation. Disable unimplemented navigation. |
| Usability | Add working search, refresh, sign-out, and connection checks; preserve selection; cancel stale skill loads; use a native connection dialog and visible keyboard focus. |
| Layout | Use a non-overlapping grid for live agents, stack cards on small screens, and correct header button contrast. |
| Setup | Load local environment files for migrations and make the sample public origin and development content policy compatible with local development. |

## Verification

- **28 tests passed, zero skipped** with the optional real-HTTP integration
  suite enabled against a disposable PostgreSQL database and local mock runtime.
- Production build, lint, type checking, and whitespace validation passed.
- Production dependency audit reported **zero known vulnerabilities**.
- Additional HTTP checks confirmed all five runtime access paths reject a
  disabled connection.
- Browser checks covered sign-in/sign-out, viewer restrictions, search,
  connection dialog, refresh/selection, per-agent command routing, pending
  controls, unknown outcomes, delayed skill responses, and offline discovery.
- At a 390px viewport, agent cards stack and the document has no horizontal
  overflow. Desktop rendering was also inspected.

Without integration environment variables, the HTTP test intentionally skips;
the remaining tests still run. See [DEVELOPMENT.md](DEVELOPMENT.md).

## Original remaining work (superseded by October 6 status above)

1. **Validate real runtime versions.** Local contract fixtures do not prove
   compatibility with a deployed OpenClaw or Hermes version, pairing policy,
   or real skill installation.
2. **Complete outcome reconciliation.** Delivery remains request-time. Add
   durable workers, runtime event ingestion, and recovery for actions stranded
   in `dispatching` or `unknown`; do not infer execution from a transport error.
3. **Make other mutation outcomes resilient to audit failures.** Connection and
   skill operations can still return an error after their primary operation
   succeeds if later persistence/audit bookkeeping fails. Inspect stored state
   and the runtime before repeating such operations.
4. **Harden deployment identity and ingress.** This is a shared trusted
   deployment, not a tenant-isolation boundary. Verify proxy header handling,
   edge rate limits, concurrent-login throttling, session revocation, and
   backup restoration in the actual hosting environment.
5. **Finish intentionally absent product capabilities.** Live reply/trace
   streaming, fleet-wide command fan-out, mission persistence, runtime-native
   resume, and workspace isolation were not implemented by this review.
6. **Perform independent security and accessibility assessments.** These
   corrections and passing checks are not a penetration-test certification or
   a complete accessibility audit.

No deployment or Git commit was performed.
