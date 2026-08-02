# Development guide

## Prerequisites

- Node.js 22.13 or newer
- npm 10 or newer
- Git

## Setup

```bash
git clone https://github.com/boyeesu/nerve.git
cd nerve
npm install
npm run dev
```

The development server prints its local URL.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create the production worker build |
| `npm run test` | Build and run rendered-HTML tests |
| `npm run lint` | Run ESLint |
| `npm run db:generate` | Generate database migrations |

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

The current interface uses sample agent data in `app/page.tsx`. This is
intentional while the adapter contract is stabilized. Runtime-specific payloads
should not be threaded directly through UI components; normalize them first.

## Styling

The visual system lives in `app/globals.css`. Preserve:

- keyboard-visible controls;
- semantic labels;
- responsive behavior;
- reduced-motion support;
- clear working, waiting, completed, and disconnected states.

Include a screenshot in pull requests that change visible behavior.

## Testing

Rendered-HTML tests verify the main product surface and that temporary starter
artifacts do not return.

```bash
npm run build
node --test tests/rendered-html.test.mjs
```

Add focused tests with new behavior. Adapter work should include contract
fixtures described in [ADAPTERS.md](ADAPTERS.md).

## Environment variables

Local `.env*` files are ignored. Never commit credentials.

When runtime integrations arrive, every environment variable must be described
in a checked-in `.env.example` using placeholder values only.

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
node --test tests/rendered-html.test.mjs
npm run lint
git status --short
```

Review [CONTRIBUTING.md](../CONTRIBUTING.md) for the complete checklist.

