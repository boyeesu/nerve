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
npm run dev:next
```

The development server prints its local URL.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the OpenAI Sites/Vinext development server |
| `npm run dev:next` | Start the production-compatible Next.js development server |
| `npm run build` | Create the Railway/Node production build |
| `npm run build:sites` | Create the OpenAI Sites worker build |
| `npm run test` | Run source and production-contract tests |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate database migrations |
| `npm run db:migrate` | Apply checked-in PostgreSQL migrations |

## Project layout

```text
app/                    Product interface and routes
build/                  Sites/Vite integration
db/                     Database access and schema
docs/                   Architecture and contributor documentation
drizzle/                Database migration metadata
examples/               Capability examples
public/                 Public assets
tests/                  Automated tests
worker/                 Cloudflare Worker entrypoint
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

Edit the schema under `db/`, then generate and inspect migrations:

```bash
npm run db:generate
```

Do not edit generated migration history casually. Explain destructive or
irreversible schema changes in the pull request.

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
git status --short
```

Review [CONTRIBUTING.md](../CONTRIBUTING.md) for the complete checklist.
