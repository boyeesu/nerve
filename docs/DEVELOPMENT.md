# Development guide

## Prerequisites

- Node.js 22.13 or newer
- npm 10 or newer
- Git
- PostgreSQL 15 or newer

## Setup

```bash
git clone https://github.com/boyeesu/nerve.git
cd nerve
npm install
cp .env.example .env.local
npm run db:migrate
npm run dev
```

The development server prints its local URL.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run dev:next` | Alias for the Next.js development server |
| `npm run build` | Create the Railway/Node production build |
| `npm run test` | Run source and production-contract tests |
| `npm run test:integration` | Migrate a disposable local DB, start the built server, and run all integration tests |
| `npm run db:restore-drill` | Restore into an empty local database and compare application data |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Typecheck without emitting files |
| `npm run audit` | Fail on high-severity production dependency findings |
| `npm run db:migrate` | Apply checked-in PostgreSQL migrations |

## Project layout

```text
app/                    Product interface and routes
db/                     Database access and schema
docs/                   Architecture and contributor documentation
drizzle/                Database migration metadata
examples/               Capability examples
public/                 Public assets
tests/                  Automated tests
.github/                CI and contribution templates
```

## Product data

The interface uses sample agent data until at least one connected runtime
returns agents. Runtime-specific payloads stay behind `lib/adapters/`; UI and
API routes consume normalized agent and skill records.

## Styling

The visual system lives in `app/globals.css`. Preserve:

- keyboard-visible controls;
- semantic labels;
- responsive behavior;
- reduced-motion support;
- clear working, waiting, completed, and disconnected states.

Include a screenshot in pull requests that change visible behavior.

## Testing

Tests verify the product surface, adapter/control-plane boundaries, deployment
contract, and absence of starter artifacts.

```bash
npm run build
npm test
```

Add focused tests with new behavior. Adapter work should include contract
fixtures described in [ADAPTERS.md](ADAPTERS.md).

## Environment variables

Local `.env*` files are ignored. Never commit credentials.

Every environment variable is described in `.env.example` using placeholder
values only. Use separate secrets for encryption, session signing, and operator
access.

## Database changes

Edit the schema under `db/`, add the corresponding numbered SQL migration
under `drizzle/`, and test it against a disposable PostgreSQL database. Do not
rewrite applied migration history. Explain destructive or irreversible schema
changes and their rollback procedure in the pull request.

## Dependency changes

- Prefer the existing stack.
- Explain why a new runtime dependency is necessary.
- Commit `package-lock.json` with `package.json`.
- Avoid broad upgrades inside unrelated changes.

## Before opening a pull request

```bash
npm ci
npm run build
npm test
npm run lint
npm run typecheck
npm run audit
git status --short
```

Review [CONTRIBUTING.md](../CONTRIBUTING.md) for the complete checklist.

## Full integration checks

Build first, then set `NERVE_TEST_DATABASE_URL` to a **disposable local**
PostgreSQL database and run `npm run test:integration`. The runner generates
fixture keys, migrates the database, starts the production server, enables both
HTTP and database suites, and stops the server afterward. Tests cover workspace
boundaries, session revocation, concurrent login limits, mission replay,
background delivery, interrupted claims, fencing, observation, and audit recovery.
The database suites insert records and temporarily create an audit-failure
trigger. Never use a database containing valuable data.

CI provides PostgreSQL and runs this full suite rather than silently skipping it.
Plain `npm test` skips the two database/server-dependent suites.

Optional browser smoke: set `NERVE_PLAYWRIGHT_MODULE` to the absolute path of an
installed Playwright `index.mjs`. Optionally set `NERVE_TEST_BROWSER_EXECUTABLE`.
The integration runner then checks the saved-mission workflow, real fixture
output, continuation, mobile layout, keyboard dismissal, logout and viewer UI.
Screenshots go into ignored `outputs/`. Browser tooling is not a production
dependency.
