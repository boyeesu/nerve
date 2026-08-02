# ADR 0001: Runtime adapters behind a normalized core

- Status: Accepted
- Date: 2026-08-02

## Context

OpenClaw, Hermes, and future agent runtimes expose different identities, event
models, command capabilities, and reliability semantics. Allowing native
payloads to reach the product core would couple every feature to every runtime.

## Decision

Nerve will integrate runtimes through explicit adapters. Adapters declare
capabilities and translate events and commands into a versioned runtime-neutral
contract.

The core will not assume that every runtime supports every command. The UI will
derive available controls from declared capabilities.

## Consequences

### Positive

- Core product behavior remains runtime-neutral.
- New runtimes have a bounded integration surface.
- Capability differences are explicit.
- Contract fixtures can test adapters consistently.

### Negative

- Some native runtime features require extension fields or delayed support.
- Schema evolution needs careful versioning.
- Adapter authors must handle identity, ordering, retries, and redaction.

