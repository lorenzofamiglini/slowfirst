# slowfirst

[![tests](https://github.com/lorenzofamiglini/slowfirst/actions/workflows/test.yml/badge.svg)](https://github.com/lorenzofamiglini/slowfirst/actions/workflows/test.yml)

**Pair programming with an AI that will not let you skip the understanding.**

Five days hunting a bug that was never in the code. A local script that quietly became a
production system. A ten-thousand-line rewrite of a library that already did the job,
which nobody on the team can explain.

None of these start with a bad decision. They start with a plausible first step, and an
AI that can produce ten more before anyone asks whether the first one was right.

Pairing with a person does not fail this way. A colleague asks what you are doing and
why, says the bug sounds like something else, and refuses to review a thousand-line
diff. An AI does none of that: hand it a task and it starts, whatever state your
understanding is in. slowfirst puts that missing half of the pair back.

Writing code is now the cheap part. **Understanding is the scarce part**, and drift is
what happens when code gets ahead of it. So the work runs in two phases:

```
   SLOW                                    FAST
   code edits locked                       edits unlocked, one step at a time
   ────────────────────────────────►│────────────────────────────────────►
   your intent, in your words       │      small steps, each verified
   beliefs checked against reality  │      anything off-intent is refused
   the AI quizzes you on the code   │      past 2x your estimate → back to SLOW
                                  gate
```

- **Nothing is generated until you can say what the problem is**, in your own words.
- **"The bug is in the code" is a belief, not a fact.** It has to be checked, cheapest
  check first, before anything is built on it.
- **The AI asks you to explain the code it's about to change**, and tells you where
  you're wrong. Reading a summary is not understanding.
- **Then it moves fast**, in steps small enough for you to read.
- **Every gate can be overridden**, and every override is logged. Friction you can't
  skip is friction people uninstall.

Not a linter, not a prompt, not a checklist. Your AI tool physically cannot edit the
code until the gate opens. Delegation becomes pairing: you keep the problem, it keeps
the typing.

The rules are in [PROTOCOL.md](PROTOCOL.md), written to hold in any tool. This repo is
the reference implementation: a Claude Code plugin, plus adapters for Codex CLI and
Gemini CLI that nobody has run live yet.

## Status

Early, and honest about it.

| | State |
|---|---|
| **Claude Code** | Tested in real sessions: the gate holds, the model stops, the budgets fire. |
| **Codex CLI, Gemini CLI** | **Not tested against the live tools.** Written from each tool's published hook docs and covered by unit tests, which is not the same as working. Expect to be the first person to run them, and please report what breaks. |
| **Any other tool** | Manual, through the terminal command. Nothing is enforced. |

There is also no field data at all. Nobody has lived with slowfirst for a month and
reported what it cost them, so treat every claim here as a hypothesis with a working
implementation attached. If you try it, [tell me where it got in your
way](CONTRIBUTING.md): that is worth more to this project than a pull request.

## Install (Claude Code)

```
/plugin marketplace add lorenzofamiglini/slowfirst
/plugin install slowfirst@slowfirst
```

Requires Node.js 18 or later on your `PATH`. slowfirst is opt-in per repository and does
nothing until you type `sf init` in a session inside that repo.

## Install (Codex CLI, Gemini CLI)

Untested against the real tools. They follow each tool's published hook docs and pass
unit tests, so the shape should be right, but the first person to run them is doing the
testing. If a hook misbehaves, your tool keeps working: a hook that errors is ignored.

1. Clone this repo.
2. Copy the hook config into your tool's settings, replacing `<path-to-slowfirst>` with
   the path to your clone:
   - **Codex CLI:** [`adapters/codex/hooks.json`](adapters/codex/hooks.json) goes in
     `~/.codex/hooks.json` or `<repo>/.codex/hooks.json`.
   - **Gemini CLI:** the `hooks` block in
     [`adapters/gemini/settings.json`](adapters/gemini/settings.json) goes in your
     Gemini `settings.json`.

## In a hurry?

`sf trivial fix the typo` gives you one file and 20 lines with no gate. `sf override
<reason>` skips the gate entirely. Both are logged, so you can see later which gates
keep getting in the way. A gate that everyone skips is a bad gate.

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
| `sf trivial [reason]` | One file, 20 lines, no gate. Going over returns you to SLOW |
| `sf slow [reason]` | Go back to understanding |
| `sf override <reason>` | Skip the gate. The reason is logged |
| `sf done` | Close the task, archive the brief, and start the next task in SLOW |
| `sf status` | Show the phase, the intent, and what the gate still needs |
| `sf stats` | Show overrides, gate results and time per phase |
| `sf report` | Build the local dashboard from your personal memory |

The same commands work in a terminal from a clone of this repo:
`node bin/slowfirst.js <command>`. An npm package will come later. Commands that loosen
the lock only run in an interactive terminal.

## The brief

`.slowfirst/brief.md` is the working document of the SLOW phase. The gate checks that:

- there is an intent, set by you with `sf intent`;
- every belief is tagged, none is still `[assumed]`, and each `[observed]` or `[refuted]`
  belief has evidence (a command and its output, or `file:line`);
- there is a teach-back;
- there is at least one step, and an estimate for the whole task.

While you work, two budgets run off that estimate:

- **Per step:** past 200 lines, slowfirst says so once. Finish the step and tick it so
  it can be reviewed, or split it. A step can ask for more with `(budget: 400)`.
- **For the task:** past twice your estimate, work stops and returns to SLOW. Being that
  far out means the plan was wrong, not that you need more lines.

## What's enforced, and what isn't

slowfirst is built to stop drift, not to contain an adversary. On your machine, an AI
with a shell runs as you, so a determined one can get around anything local. Here is
exactly what the Claude Code plugin does:

- **Blocked before it runs:** the AI's edit tools (Edit, Write, NotebookEdit) on files
  in the repo during SLOW, and on `.slowfirst/log.jsonl` at any time.
- **Stopped as it happens:** work past twice your estimate, or past the trivial lane.
  The session returns to SLOW and the AI is told why.
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

## The dashboard

`sf report` in your agent, or `node bin/slowfirst.js report --open` in a terminal,
builds a single local HTML page from your personal memory: no scripts, no network, light
and dark. [See an example](https://htmlpreview.github.io/?https://github.com/lorenzofamiglini/slowfirst/blob/main/docs/dashboard-example.html) (made-up data).

It keeps three kinds of number apart, on purpose:

- **Measured:** hours per week split by how you labelled each task, the median time the
  gate costs you, overrides and failed gate attempts.
- **Caught:** beliefs that turned out false, work that was stopped or sent back, files
  touched that no step named. Each is a moment the work could have carried on in the
  wrong direction.
- **Estimated:** one number, "rework avoided", with its assumption printed next to it.
  It only appears once you have labelled at least three tasks `waste`, so the
  multiplier comes from your own history.

There is no "time saved" figure. Nobody can measure how long a task would have gone on
had it not been stopped, and an invented number is the first thing a sceptical
colleague would pull apart. The number to watch is the one you can measure: **hours in
tasks you called drift or waste**, going down.

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

- **0.2** Done: signals and personal memory (recording only), step and task budgets, and
  the trivial lane.
- **0.3** A replay tool, so any rule can be backtested on past logs. Then nudges driven
  by the signals, measured by whether you accept or dismiss them, and only then stops.
- **0.4** The Codex CLI and Gemini CLI adapters run against the live tools, plus a pi
  adapter. pi's extension API can also remove tools and replace compaction, so no fork
  is needed.
- **0.5** Git pre-commit hook and a GitHub Action, the layer no tool switch can dodge.
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
