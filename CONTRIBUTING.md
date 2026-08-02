# Contributing to Nerve

Thank you for helping build a calmer, safer way to operate fleets of AI agents.
All contributions—code, docs, design, testing, and thoughtful issue
reports—are welcome.

By participating, you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Before you begin

1. Search existing issues and pull requests.
2. Open an issue for a large feature, new adapter, data-model change, or
   architectural change.
3. Wait for alignment before investing heavily in work that changes public
   contracts.
4. Never include runtime credentials, private traces, user prompts, or customer
   data in issues, fixtures, screenshots, or commits.

Small fixes, documentation improvements, accessibility changes, and additional
tests can go directly to a pull request.

## Development setup

```bash
git clone https://github.com/boyeesu/nerve.git
cd nerve
npm install
npm run dev
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the full project guide.

## Branches and commits

- Branch from `main`.
- Use a short descriptive branch name such as `feat/openclaw-adapter` or
  `fix/mobile-inspector`.
- Keep commits focused and written in the imperative mood.
- Do not mix unrelated refactors into a feature or bug fix.

## Pull requests

A pull request should:

- explain the problem and why the change is needed;
- describe user, operator, adapter, and security impact;
- include screenshots for visible UI changes;
- include tests for changed behavior;
- update documentation when contracts or workflows change;
- pass build, tests, and lint;
- avoid unrelated generated files or dependency changes.

Draft pull requests are welcome for early feedback.

## Validation

Run the same checks used by continuous integration:

```bash
npm ci
npm run build
node --test tests/rendered-html.test.mjs
npm run lint
```

## Design principles

Contributions should reinforce these principles:

1. **Runtime-neutral core.** Runtime-specific logic belongs in adapters.
2. **Operator clarity.** Show useful summaries, not hidden chain-of-thought.
3. **Safe control.** Destructive or sensitive commands require explicit policy
   and approval boundaries.
4. **Auditable behavior.** Commands, approvals, state transitions, and
   artifacts should be traceable.
5. **Progressive disclosure.** Fleet health first; deep traces when requested.
6. **Accessible by default.** Keyboard, contrast, reduced motion, and semantic
   structure are product requirements.

## Adapter contributions

Read [docs/ADAPTERS.md](docs/ADAPTERS.md) before starting a runtime adapter.
New adapters should:

- declare capabilities rather than assume them;
- normalize events into the shared envelope;
- implement idempotent command handling;
- redact secrets and private runtime data;
- provide mocked contract tests;
- document supported runtime versions.

## Reporting bugs

Use the bug-report issue form. Include the smallest reproducible example,
expected behavior, actual behavior, environment, and sanitized logs.

For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of opening a
public issue.

## Documentation

Use short sentences, concrete examples, and links to canonical contracts.
Update the README only for primary user-facing information; put deeper
technical material under `docs/`.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE).

