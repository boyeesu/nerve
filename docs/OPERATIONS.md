# Operations runbook

This runbook covers one trusted Nerve deployment and its PostgreSQL database.
Use separate deployments and databases for staging and production.

## Service objectives

- `/api/health` returns HTTP 200 and `status: ok`.
- Connection probes complete within the runtime's configured timeout.
- No action remains in `dispatching` longer than the operator's expected
  runtime response window.
- Authentication failures and rate-limit rejections remain explainable from
  application and proxy logs without recording access keys.

## Monitoring

Monitor these signals in Railway or the platform running Nerve:

- readiness check failures, restarts, CPU, memory, and disk pressure;
- PostgreSQL availability, storage, connection count, and slow queries;
- HTTP 5xx rate and latency for `/api/connections/*`;
- spikes in authentication failures or rate-limit rejections;
- action records in `failed` or `unknown` state;
- runtime connection health and repeated pairing requests.

Alerts should link to this runbook and identify the environment, deployment,
request ID, and affected connection without including runtime credentials.

## Backup and restore

Enable Railway PostgreSQL backups before adding production runtime credentials.
At least quarterly:

1. create a fresh database in an isolated restore environment;
2. restore the latest backup;
3. point a disposable Nerve deployment at the restored database;
4. verify `/api/health`, connection metadata, audit history, and encrypted
   credential decryption;
5. delete the disposable environment and record the restore time and result.

Backups contain encrypted runtime credentials. Protect backup access and retain
the matching `NERVE_ENCRYPTION_KEY` in a separate secret manager.

## Credential rotation

### Operator access keys

With `NERVE_ACCESS_KEYS`, add the replacement key, deploy, verify sign-in, then
remove the old key and deploy again. Removing or changing a key, role, or
workspace immediately invalidates sessions issued for that key. Sign-out
revokes that specific session in PostgreSQL. Rotating `NERVE_SESSION_SECRET`
invalidates all sessions. Deploying v3 sessions signs out older v2 cookies.

### Session secret

Replace `NERVE_SESSION_SECRET` with a new high-entropy value. This signs out all
operators but does not affect saved runtime connections.

### Runtime credentials

There is no credential-edit screen yet. Preserve delivery evidence before
deleting and recreating a connection with its replacement runtime credential.
Deleting a connection cascades its assignments and delivery records; audit
events remain. Plan this maintenance rather than deleting active connections.

### Encryption key

Do not replace `NERVE_ENCRYPTION_KEY` in place. Saved credentials are encrypted
with it and become unreadable. Export and re-encrypt credentials using an
audited migration procedure, or recreate every connection after the change.

## Ambiguous actions

An action in `unknown` state may have reached the runtime even though Nerve did
not receive an acknowledgement. Inspect the runtime first. Retry only when the
operation is safe to repeat and use Nerve's explicit retry path so the audit
record and attempt count are preserved.

The retry path (`x-nerve-retry: true` with the original `idempotency-key`)
currently permits only OpenClaw message actions, which forward the same key
to `chat.send`. Hermes runs, stops, and approvals are not automatically
redispatched: their adapters do not provide a deduplication guarantee.
An HTTP 202 response with `state: unknown` is not a success receipt.
Delivered actions are never reclassified as failed because a later audit write
fails. Monitor application logs for audit or outcome-persistence failures.

## Incident response

1. Limit exposure at the proxy or Railway service without deleting evidence.
2. Preserve deployment logs, audit rows, action rows, and relevant runtime
   logs.
3. Rotate affected operator and runtime credentials.
4. If session integrity is in doubt, rotate `NERVE_SESSION_SECRET`.
5. If database or encryption-key access is in doubt, disconnect runtimes and
   follow a controlled encryption-key migration.
6. Patch and validate in staging, then redeploy production.
7. Document impact, timeline, root cause, and follow-up controls.

Report suspected product vulnerabilities through the process in
[SECURITY.md](../SECURITY.md).

## Durable delivery and observation

The worker runs every five seconds in a **long-lived Node process**, including
the standalone/Railway image. `NERVE_WORKER_ENABLED=false` disables recovery and
rejects asynchronous delivery/mission launches. Do not rely on it in a
serverless or suspended instance.

- A `requested` record older than five seconds can be claimed atomically by one
  worker/HTTP request. A crashed claim becomes `unknown` after two minutes.
- Migration `0004_queue_upgrade_safety.sql` quarantines pre-upgrade `requested`
  records as `unknown`, without dispatching them. Review these records manually.
  New deliveries recheck the requesting actor's current role and workspace;
  removing an actor or downgrading the actor to viewer blocks queued delivery.
- Unknown actions are **not** automatically resent. Attempt fencing prevents a
  late worker from overwriting a newer claim. “Completed” in stored delivery
  records means runtime acceptance, **not** completed execution.
- Administrators can record runtime evidence in the agent's delivery history.
  This changes the record to `reconciled`, preserves its receipt, records an
  audit atomically, and sends no runtime command.
- Deferred audits drain transactionally; expired login buckets and revoked
  sessions are removed. Alert on repeated `Nerve recovery failed`, growing
  `audit_outbox`, or `requested` records older than one minute.
- Missions validate every connection and enqueue all targets transactionally.
  Runtime execution is independent per target, not an all-or-nothing transaction.
  Keep a launch's idempotency key when retrying API requests.
- The mission dialog retains launch keys in tab-scoped session storage, scoped
  by actor and workspace. Closing the dialog or reloading the page reuses the
  original launch. **Prepare new launch** explicitly starts another batch.
  A different tab/browser or cleared session storage does not retain that key;
  inspect delivery history before launching again. Keys contain no credentials.
- Hermes SSE is bounded to 25 seconds/2 MiB per connection and reconnects with
  event IDs. The browser keeps only the latest 100 events. OpenClaw history is
  polled; neither preview is a durable trace archive. Inspect runtime retention
  policies when investigating missing events.

## Workspace and ingress setup

Access-key entries can include `workspaceId`; legacy/admin keys without one
belong to `default`. Connection, mission, receipt, observation, and mutation
routes enforce this scope. Roles apply within a workspace. This is application
record isolation, **not** independent database/runtime isolation: use separate
runtime tokens/endpoints and separate deployments for mutually untrusted teams.
Sharing one powerful runtime credential across workspaces defeats isolation at
the runtime itself. Enterprise SSO/MFA and automatic provisioning are not built in.

Leave `NERVE_TRUSTED_IP_HEADER` empty unless your trusted proxy **overwrites**
that header and prevents direct origin access. Supported names are
`cf-connecting-ip`, `x-real-ip`, `x-forwarded-for`. Nerve otherwise uses one
shared ingress bucket. Atomic claims allow eight login attempts (successful
or failed) per 15 minutes. Configure edge abuse limits and verify forwarding
behavior in the actual hosting environment; the shared fallback can block
legitimate logins under attack.

## Local restore rehearsal

Quiesce the fixture database. Set `NERVE_DRILL_SOURCE_URL` and
`NERVE_DRILL_TARGET_URL` to distinct local disposable databases; the target must
be empty. With PostgreSQL `pg_dump`/`pg_restore` available, run
`npm run db:restore-drill`. Optional `PG_DUMP_BIN`/`PG_RESTORE_BIN` select explicit
executables. The script streams a transactionally restored backup and compares
migration checksums and all eight application tables. It does not delete either
database. Full-table comparison is intended for small fixtures, not production
backups. Verify decrypted credentials separately with the matching encryption
key. This does not replace a Railway backup/restore drill.
