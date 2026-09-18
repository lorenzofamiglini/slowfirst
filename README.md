# slowfirst

AI makes writing code nearly free. What's scarce is your understanding of the problem
and of the system. When code gets ahead of that understanding, work drifts: days spent
on a bug that isn't there, a small tool that grows into a platform, a rewrite nobody can
explain.

slowfirst keeps your understanding ahead of the code.

- **SLOW.** Code edits are locked. You state the intent in your own words. The AI
  helps you check the beliefs the plan rests on, and quizzes you on the real code
  you're about to change.
- **FAST.** Once that's done, work goes in small steps, each one verified before the
  next.

The rules are in [PROTOCOL.md](PROTOCOL.md). This repo is the reference implementation,
starting with a Claude Code plugin.

## Install (Claude Code)

```
/plugin marketplace add lorenzofamiglini/slowfirst
/plugin install slowfirst@slowfirst
```

Requires Node.js 18 or later on your `PATH`. slowfirst is opt-in per repository and does
nothing until you type `sf init` in a session inside that repo.

## Install (Codex CLI, Gemini CLI)

These adapters follow each tool's published hook docs and are covered by unit tests.
They haven't been run against the live CLIs yet, so please report what breaks.

1. Clone this repo.
2. Copy the hook config into your tool's settings, replacing `<path-to-slowfirst>` with
   the path to your clone:
   - **Codex CLI:** [`adapters/codex/hooks.json`](adapters/codex/hooks.json) goes in
     `~/.codex/hooks.json` or `<repo>/.codex/hooks.json`.
   - **Gemini CLI:** the `hooks` block in
     [`adapters/gemini/settings.json`](adapters/gemini/settings.json) goes in your
     Gemini `settings.json`.

## A session

```
you   sf init
you   sf intent Add rate limiting to the public API. Ops needs it so one client can't
      starve the others. Done when a client over 100 req/min gets 429s and others don't.
AI    Before any design: what has to be true? I've added three [assumed] beliefs to
      the brief. The cheapest to check is "nothing in the stack already rate-limits":
      can we look at the gateway config together?
      ...
you   sf fast
      Not ready for FAST yet:
        ✗ Still assumed. Check them before building on them:
            - [assumed] limits must be per client, not per IP
        ✗ No teach-back yet.
      ...
you   sf fast
      Gate passed. FAST. Current step: enable the gateway's limiter for /v1 (verify: load test)
```

## Commands

You type these in the prompt. The AI can't run them, so it can't unlock itself.

| Command | What it does |
|---|---|
| `sf init` | Turn slowfirst on in this repo |
| `sf intent <text>` | The problem, who uses the result and for what, and how you'll know it's done |
| `sf fast` | Check the brief. If it's complete, unlock code edits; if not, list what's missing |
| `sf slow [reason]` | Go back to understanding |
| `sf override <reason>` | Skip the gate. The reason is logged |
| `sf done` | Close the task, archive the brief, and start the next task in SLOW |
| `sf status` | Show the phase, the intent, and what the gate still needs |
| `sf stats` | Show overrides, gate results and time per phase |

The same commands work in a terminal from a clone of this repo:
`node bin/slowfirst.js <command>`. An npm package will come later. Commands that loosen
the lock only run in an interactive terminal.

## The brief

`.slowfirst/brief.md` is the working document of the SLOW phase. The gate checks that:

- there is an intent, set by you with `sf intent`;
- every belief is tagged, none is still `[assumed]`, and each `[observed]` or `[refuted]`
  belief has evidence (a command and its output, or `file:line`);
- there is a teach-back;
- there is at least one step.

## What's enforced, and what isn't

slowfirst is built to stop drift, not to contain an adversary. On your machine, an AI
with a shell runs as you, so a determined one can get around anything local. Here is
exactly what the Claude Code plugin does:

- **Blocked before it runs:** the AI's edit tools (Edit, Write, NotebookEdit) on files
  in the repo during SLOW, and on `.slowfirst/log.jsonl` at any time.
- **Undone after it runs:** a shell command that changes slowfirst's own state. That
  covers forging a phase change in the log, rewriting the log, or deleting
  `.slowfirst/`. The previous state is restored, the AI is told, and the event is
  logged. This works however the command is spelled.
- **Refused:** `slowfirst intent|fast|override|done` in a terminal that isn't
  interactive. An AI's shell never is, so the AI can't run these for you.
- **Detected, not blocked:** files changed through the shell during SLOW, including
  changes committed in the same command. The AI is told and the event is logged.
- **Not covered:**
  - shell commands left running in the background after the tool call returns;
  - a faked terminal (for example `script`);
  - edits made outside the AI's tools.
- **Not checked:** whether your teach-back answers were any good. The gate checks
  structure; the understanding comes from doing the teach-back honestly.
  `sf override` is always there, and always logged.

## Signals and personal memory

Drift shows up in numbers before anyone names it: files nobody planned to touch, a
change several times the estimate, fix after fix with no confirmed cause, your own turns
shrinking to "ok, continue".

From 0.2 slowfirst records those numbers. It does not act on them yet.

- **In the repo's log:** each turn (its length, never its text), each edit (the file and
  the size of the change so far), and the existing gate, override and phase events.
- **In your personal memory** at `~/.slowfirst/episodes.jsonl`, shared across every repo
  you work in: one record per finished task, with how you labelled it at `sf done`
  (`ok`, `drift` or `waste`) and its signals.
- **Numbers and paths only.** Your prompts and your code never leave the repo, and
  nothing leaves your machine.

The label is the point. With enough labelled tasks, a later version can compare a
running task against your own past ones and say "this looks like a task you called
*waste*, and here is the signal that matched". Personal history beats a global
threshold, because the same number means different things in different codebases.

Any rule built on these signals will be backtested by replaying past logs before it
ships: does it catch the bad tasks, how early, and does it stay quiet on the good ones?

## Measurement

`sf stats` reads the local log. Nothing leaves your machine.

- Many overrides of one gate, across people: the gate is bad. Open an issue.
- Many overrides of everything, in one project: that is the drift slowfirst is meant to
  show.

## How it generalises

The rules live in the repository, not in the tool.
- `.slowfirst/` holds the brief and an append-only log, and the phase is replayed from
  that log.
- Switching tools, or people, doesn't reset the gate.

One engine serves every tool through a thin adapter:

```
 human's typed input ─┐                        ┌─ .slowfirst/brief.md   (the working document)
 tool calls ──────────┼─ adapter ─> core/engine ┤
 shell commands ──────┘                        └─ .slowfirst/log.jsonl  (append-only; the phase is replayed from it)
```

An adapter maps its harness's events onto four engine calls:

| Engine call | When |
|---|---|
| `handleUserInput(root, text)` | on text the human typed; the only path that changes the phase |
| `checkToolCall(root, call)` | before an edit or shell call; returns allow or deny with a reason |
| `beforeShell` / `afterShell` | around shell commands; undoes changes to slowfirst's state and reports files written during SLOW |
| `sessionContext` / `turnContext` | the rules and the pinned intent for the model's context |

The Claude Code adapter is about 70 lines: [adapters/claude-code/adapter.js](adapters/claude-code/adapter.js).

Enforcement comes in three layers. Each adapter provides what its harness allows.

| Layer | Mechanism | Can be bypassed by | Status |
|---|---|---|---|
| Advisory | [`skills/slowfirst/SKILL.md`](skills/slowfirst/SKILL.md) | a model or human ignoring it | done |
| Harness | hooks that block tool calls | switching to a tool without an adapter | Claude Code done; others below |
| Repository | git pre-commit hook and a CI check on the brief and PR size | nothing short of disabling CI | planned |

### Which tools can host an adapter

An adapter needs a harness that can do four things:
- block an edit before it runs;
- run something before and after shell commands;
- catch the human's typed prompt before the model sees it;
- add context for the model.

Surveyed in September 2026. ✓ means confirmed in the tool's official docs or source.
Check the linked docs before relying on this table.

| Tool | Block edits | Around shell | Catch the prompt | Add context | Enforcement possible | Adapter |
|---|---|---|---|---|---|---|
| [Claude Code](https://code.claude.com/docs/en/hooks) | ✓ | ✓ | ✓ | ✓ | full | ✓ tested in Claude Code |
| [Codex CLI](https://learn.chatgpt.com/docs/hooks) | ✓ | ✓ | ✓ | ✓ | full | ✓ unit-tested, not yet run live |
| [Gemini CLI](https://geminicli.com/docs/hooks/reference) | ✓ | ✓ | ✓ | ✓ | full | ✓ unit-tested, not yet run live |
| [pi](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md) | ✓ | ✓ | ✓ | ✓ | full | planned |
| [Kiro](https://kiro.dev/docs/hooks/actions) | ✓ | ✓ | ✓ | ✓ | full | wanted |
| [Cursor](https://cursor.com/docs/agent/hooks) | ✓ | ✓ | ✓ | session start only | nearly full | wanted |
| [Windsurf](https://docs.devin.ai/desktop/cascade/hooks) | ✓ | ✓ | ✓ | ✗ | partial | wanted |
| [Copilot CLI](https://docs.github.com/en/copilot/reference/hooks-configuration) | ✓ | ✓ | ✗ | ✓ | partial | wanted |
| [OpenCode](https://opencode.ai/docs/plugins), [Amp](https://ampcode.com/manual/plugin-api) | ✓ | ✓ | sees it, can't stop it | ✓ | partial | wanted |
| Roo Code, Aider, Zed's own agent | ✗ | ✗ | ✗ | ✗ | guidance only (`SKILL.md` / `AGENTS.md`) | n/a |

Each adapter is about 70 lines. See [adapters/](adapters/).

## Roadmap

- **0.2** Signals and personal memory (done: recording only). Next: step budgets, per
  step and total against your estimate, and the trivial lane.
- **0.2.x** A replay tool, so any rule can be backtested on past logs. Then nudges from
  the signals, measured by whether you accept or dismiss them, and only then stops.
- **0.3** Codex CLI and Gemini CLI adapters run live, and a pi adapter. pi's extension
  API can also remove tools and replace compaction, so no fork is needed.
- **0.4** Git pre-commit hook and a GitHub Action.
- **Evaluation.** A held-out set of incidents and a set of control tasks that must not
  be slowed; see [PROTOCOL.md](PROTOCOL.md#evaluation-staying-general).

## Contributing

The most useful contributions right now aren't code:
- an anonymised incident where AI-assisted work drifted;
- a task where slowfirst got in your way.

Both go into the evaluation sets.

Run the tests with `npm test`. The core has no dependencies.

## License

MIT
