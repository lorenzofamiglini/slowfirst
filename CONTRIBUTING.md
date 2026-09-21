# Contributing

The most useful contributions are not code.

## Send an incident

A case where AI-assisted work went days in the wrong direction. Anonymise freely: no
company names, no colleague names, no code. What matters is the shape of the drift.

These become the **held-out set**: cases the rules were not designed against. A rule is
only worth having if it catches these without being rewritten for each one.
[Open an incident](../../issues/new?template=incident.yml).

## Tell me where it got in your way

A task where the gates cost more than they were worth. These are the **control set**.
slowfirst is meant to be nearly free for someone who already understands the code, so a
gate you had to override on ordinary work is a bug in the gate.
[Open a friction report](../../issues/new?template=friction.yml).

## Code

- `npm test` runs everything. The core has no dependencies, and keeping it that way is
  deliberate: a hook runs on every tool call, so start-up time is the budget.
- A new harness adapter maps its hooks onto four engine calls. See
  [adapters/claude-code/adapter.js](adapters/claude-code/adapter.js), about 70 lines.
- A change to a rule or a threshold needs a reason that is not a single incident. See
  [PROTOCOL.md](PROTOCOL.md#evaluation-staying-general).
