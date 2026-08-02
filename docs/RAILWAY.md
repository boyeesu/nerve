# Deploy Nerve on Railway

Nerve ships with a production Docker image, Railway config-as-code, PostgreSQL
migrations, and a readiness endpoint. A complete deployment has two services:

1. the `nerve` web/control-plane service from this repository;
2. Railway PostgreSQL, referenced by the web service as `DATABASE_URL`.

## Deploy from GitHub

1. In Railway, create a project from `boyeesu/nerve`.
2. Add Railway PostgreSQL to the same project.
3. On the Nerve service, add a reference variable:
   `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
4. Generate three independent secrets locally:

   ```bash
   openssl rand -base64 32
   openssl rand -base64 48
   openssl rand -base64 32
   ```

5. Set the results as `NERVE_ENCRYPTION_KEY`,
   `NERVE_SESSION_SECRET`, and `NERVE_ADMIN_TOKEN`, respectively.
6. Set `NERVE_PUBLIC_URL` to the HTTPS Railway domain.
7. Generate a public domain and redeploy.
8. Open `/api/health`. Do not send traffic until it returns `status: ok`.

`railway.json` runs migrations before deployment and uses `/api/health` as the
readiness check. A failed migration prevents the new release from replacing the
currently healthy release.

## Template definition

The reusable Railway template should contain:

| Service | Source | Required wiring |
| --- | --- | --- |
| Nerve | `https://github.com/boyeesu/nerve` | Public HTTPS domain; Dockerfile build |
| Postgres | Railway `postgres` template | `DATABASE_URL` reference into Nerve |

Template variables:

| Variable | Template behavior |
| --- | --- |
| `DATABASE_URL` | Reference `${{Postgres.DATABASE_URL}}` |
| `NERVE_ENCRYPTION_KEY` | Required generated secret, 32 bytes |
| `NERVE_SESSION_SECRET` | Required generated secret, at least 32 characters |
| `NERVE_ADMIN_TOKEN` | Required generated operator access key |
| `NERVE_PUBLIC_URL` | Required user input after domain generation |
| `NERVE_ALLOW_PRIVATE_NETWORKS` | Default `false` |

Railway marketplace templates are project definitions, not files in a Git
repository. A maintainer must generate and publish the final template from a
Railway project after this branch is merged. The repository portion is complete:
the Dockerfile, health check, migration command, variables, and service wiring
contract are checked in here.

## Connecting local runtimes

A Railway service cannot reach `localhost` on a user workstation. Use one of:

- a private Tailscale network with a reachable HTTPS/WSS hostname;
- a narrowly scoped Cloudflare Tunnel or equivalent outbound tunnel;
- Nerve on the same trusted private network as the runtime.

Keep `NERVE_ALLOW_PRIVATE_NETWORKS=false` on an internet-facing deployment.
When it is enabled, Nerve permits private address ranges but still blocks
link-local and cloud metadata addresses.

## Production operations

- Use separate Railway environments and databases for staging and production.
- Back up PostgreSQL before applying irreversible migrations.
- Rotate `NERVE_ADMIN_TOKEN` without changing `NERVE_ENCRYPTION_KEY`.
- Rotating `NERVE_ENCRYPTION_KEY` requires an explicit credential
  re-encryption procedure; changing it directly makes saved connections
  unreadable.
- Put Railway WAF/rate limits or an identity-aware proxy in front of public
  deployments.
- Monitor `/api/health`, deployment restarts, database connections, and failed
  audit events.

Railway references:
[Next.js with PostgreSQL](https://docs.railway.com/guides/nextjs),
[config as code](https://docs.railway.com/config-as-code), and
[template creation](https://docs.railway.com/templates/create).
