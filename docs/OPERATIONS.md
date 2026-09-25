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
remove the old key and deploy again. Existing sessions expire naturally or can
be invalidated immediately by rotating `NERVE_SESSION_SECRET`.

### Session secret

Replace `NERVE_SESSION_SECRET` with a new high-entropy value. This signs out all
operators but does not affect saved runtime connections.

### Runtime credentials

Update the connection from Nerve after rotating the credential in OpenClaw or
Hermes. Verify a probe before revoking the old runtime credential.

### Encryption key

Do not replace `NERVE_ENCRYPTION_KEY` in place. Saved credentials are encrypted
with it and become unreadable. Export and re-encrypt credentials using an
audited migration procedure, or recreate every connection after the change.

## Ambiguous actions

An action in `unknown` state may have reached the runtime even though Nerve did
not receive an acknowledgement. Inspect the runtime first. Retry only when the
operation is safe to repeat and use Nerve's explicit retry path so the audit
record and attempt count are preserved.

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
