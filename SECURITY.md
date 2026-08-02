# Security policy

Nerve is pre-release software and is not yet recommended for production
control of sensitive or multi-tenant agent fleets. The public alpha is intended
for a single operator on a trusted deployment. See
[Production readiness](docs/PRODUCTION.md).

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Public alpha snapshots | Best effort |
| Versions before `0.1.0` | No |

Support policy will become versioned before the first stable release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Include the affected commit or version, impact, reproduction steps, and any
   suggested mitigation.
4. Remove credentials, private prompts, agent memory, and customer data.

If private vulnerability reporting is unavailable, contact the maintainer
through the options on the
[maintainer's GitHub profile](https://github.com/boyeesu) and request a private
reporting channel.

You can expect an acknowledgement within seven days. Timelines for validation,
remediation, and disclosure will depend on severity and complexity.

## Security-sensitive areas

Extra care is required around:

- runtime access tokens and connector credentials;
- command authorization and tenant boundaries;
- pause, cancel, file, shell, and network-capable commands;
- approval spoofing and confused-deputy behavior;
- prompt, memory, trace, and artifact redaction;
- webhook authenticity, replay protection, and event ordering;
- cross-workspace data isolation;
- model-generated content rendered in the operator interface.

## Deployment requirements

- Set independent high-entropy values for `NERVE_ADMIN_TOKEN`,
  `NERVE_SESSION_SECRET`, and `NERVE_ENCRYPTION_KEY`.
- Keep `NERVE_ALLOW_PRIVATE_NETWORKS=false` on public deployments.
- Expose Nerve and remote runtimes only through HTTPS/WSS.
- Put rate limiting and preferably an identity-aware proxy in front of Nerve.
- Grant OpenClaw `operator.admin` only when skill installation is required.
- Do not change `NERVE_ENCRYPTION_KEY` without re-encrypting saved credentials.
- Back up PostgreSQL and verify restore procedures.

## Safe research

Good-faith research that avoids privacy violations, data destruction,
service disruption, and access beyond what is necessary to demonstrate a
problem is welcome. Please allow reasonable remediation time before disclosure.
