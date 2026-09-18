# The slowfirst protocol, v0.2

A protocol for AI-assisted coding that does not depend on any one harness. Adapters
(Claude Code, pi, a CLI, git hooks, CI) enforce it. This file is the single source of
truth; the code implements it.

## The problem

AI makes writing code nearly free. The scarce resource is the human's understanding of
the problem and of the system. When code gets ahead of understanding, work drifts:
effort goes into problems that don't exist, goals change without anyone deciding, and
solutions grow past what anyone can explain.

The protocol has one aim: **keep the human's understanding ahead of the code.**

## Five invariants

1. **Intent belongs to the human and stays fixed.**
   The human writes, in their own words:
   - the problem;
   - who uses the result, and for what;
   - a check for "done" that can fail.

   It is shown to the model every turn. Scope changes only when the human changes it.

2. **Code is justified only by observed facts.**
   Every plan rests on beliefs, for example:
   - "X is broken";
   - "the library can't do Y";
   - "nothing existing does Z";
   - "we need W".

   Each belief is recorded as *observed*, with the command output or `file:line` that
   shows it, or as *assumed*. An assumed belief is checked before any code depends on
   it, cheapest check first.

3. **The human can explain the system before changing it.**
   The AI shows the real code the change touches. It asks the human to predict or
   explain what that code does, and corrects them. The worse the answers, the deeper the
   questions go; there is no fixed checklist.

4. **Steps are small enough to understand, and each one works before the next starts.**
   - Each step fits a size budget the human can review.
   - Each step runs and is verified before the next begins.
   - The total size is tracked against the human's own estimate.

5. **A surprise sends you back to slow.**
   Work stops until understanding is updated when:
   - an observation contradicts a belief or the plan; or
   - repeated attempts fail.

**Three further rules:**
- **Only the human changes the phase.** Phase changes come only from input the human
  typed, never from the model's tool calls.
- **Friction scales with unfamiliarity.** Experts in familiar code pay close to nothing.
- **Every rule can be overridden, and every override is logged** with its reason.

## Phases

**SLOW**: code edits locked.
- The human and the AI produce the brief: intent (1), a ledger of beliefs (2), the
  teach-back (3), and a plan of steps (4).
- The human asks to go FAST. The harness checks the brief is complete and opens the
  gate, or says what is missing.

**FAST**: one step at a time. Work returns to SLOW when:
- a step exceeds its budget;
- the total exceeds 2x the estimate;
- a belief is falsified;
- N attempts in a row fail;
- the current action can't be traced back to the intent;
- the human changes the intent.

**TRIVIAL**: one file, at most 20 lines, no gate. Going over sends you to SLOW.

**OVERRIDE**: always available, always logged with a reason.

## State

State lives in the repository, in `.slowfirst/`, so the same rules apply whichever tool
or person is working.

| File | Written by | Purpose |
|---|---|---|
| `brief.md` | the human and the AI | intent (copied), beliefs, teach-back, steps |
| `log.jsonl` | the harness only, append-only | every event; the phase is replayed from it |
| `archive/` | the harness | briefs of closed tasks |

The pinned intent comes from the log, where only the human's input can put it. Editing
it in `brief.md` has no effect.

Defaults, all configurable:
- 200 lines per step;
- a total budget of 2x the estimate;
- 2 failed attempts before returning to SLOW.

## Measurement

Measurement is local, with no phone-home. Report:
- overrides per rule, with reasons;
- returns to SLOW, per trigger;
- step sizes, and estimated vs actual size;
- time spent in SLOW vs FAST.

How to read it:
- Many overrides of one rule, across people: the rule is bad. Fix the rule.
- Many overrides of every rule, in one project or by one person: that is drift.

## Signals and memory

The invariants are enforced at gates. Between gates, drift shows in numbers, so the
harness records them and, later, learns from them.

- **Signals** are measured from what the harness already sees: files touched that no
  step mentions, size against the estimate, new dependencies and new surface area,
  attempts without a confirmed cause, time since the last passing check, and how much
  the human is still engaging.
- **An episode** is one task, from intent to close. The human labels it in one word at
  the end, and objective outcomes (reverted, abandoned, overridden) are added to it.
- **Memory is personal and local.** Thresholds come from the human's own past tasks,
  not from global numbers, and hold numbers only: never prompts, never code.
- **Escalation is graded:** a nudge, then a checkpoint that asks the human to restate
  how the work serves the intent, and only then a stop. Every alert records whether the
  human accepted or dismissed it, which measures its precision.
- **A rule changes only after a backtest.** Past logs are replayed to ask whether the
  change catches held-out bad episodes, how early, and whether it stays quiet on good
  ones and on the controls.

## Evaluation: staying general

Rules come from general failure modes, never from a single incident. No rule may exist
only because one incident needed it. The protocol is tested on three sets:

1. **Development incidents**: the cases known while designing it. They serve as
   regression tests only.
2. **Held-out incidents**: collected from other teams and public post-mortems, and not
   read while writing rules. The protocol should catch them without changes.
3. **Controls, which must not be slowed**: a typo fix, a dependency bump, an expert
   working in familiar code, a small well-specified feature. Target: a few minutes in
   SLOW at most, and no forced overrides.

A rule change is accepted only if it improves the held-out set without hurting the
controls.
