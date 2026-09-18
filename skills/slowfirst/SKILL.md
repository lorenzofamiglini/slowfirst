---
name: slowfirst
description: How to work in a repository that uses slowfirst, where a SLOW phase (understanding, no code edits) comes before a FAST phase (small verified steps). Use whenever the repo has a .slowfirst/ directory or the human types an `sf` command.
---

# Working with slowfirst

This repository keeps the human's understanding ahead of the code. Writing code is cheap for you. The scarce resource is the human's understanding of the problem and of the system, and your job is to build it, not replace it.

## The human's commands

The human types these. You never run them, and you never pretend one was run.

- `sf intent <text>`: the problem, who uses the result and for what, and how they'll know it's done
- `sf fast`: check the brief and, if it's complete, unlock code edits
- `sf trivial [reason]`: one file, 20 lines, no gate
- `sf slow [reason]`: go back to understanding
- `sf override <reason>`: skip the gate (logged)
- `sf done`: close the task and archive the brief
- `sf status`, `sf stats`

## SLOW: you are an examiner, not an author

Code edits are blocked, except `.slowfirst/brief.md`. Reading, searching and running commands are allowed and encouraged.

1. **Intent.** If there is none, ask for it and don't draft it for them. If it's vague, ask the one question that makes it concrete: who uses the result, and how will we know it's done?
2. **Beliefs.** List what has to be true for any plan to work. That includes "this is actually broken", "nothing that already exists does this" and "this is needed at all". Tag each one `[assumed]`. Check them with the cheapest observation first: run it, read it, query it. Look at the system's state and recent changes before theorising about code. Mark each belief `[observed]` or `[refuted]`, with the evidence: a command and its output, or file:line. Only mark something observed if you saw the evidence in this session.
3. **Teach-back.** Show the real code the change touches, as file:line with short excerpts. Ask the human to predict or explain what it does. Check their answer against the code and say plainly where they're wrong. Go deeper where they're wrong and move on where they're right. Ask questions; don't lecture or summarise in their place.
4. **Steps.** Propose the smallest approach first: use, configure or wrap what exists before building anything new. Break it into steps that are each small enough to review and can be verified on their own, and estimate the whole task in lines. The human chooses.

Record all of this in `.slowfirst/brief.md`.

## FAST: small steps, each verified

- Work on the current step only, and keep the diff small enough for the human to read and explain.
- Verify each step by running or testing it before starting the next, then tick it in the brief. Ticking a step is what starts the next one's budget.
- A step past its budget is a warning: finish and tick it, or split it. A task past twice the estimate stops on its own, because that means the plan was wrong.
- Anything that doesn't serve the intent is out of scope. Say so instead of doing it.
- If an observation contradicts a belief or the plan, or two attempts in a row fail, stop. Tell the human what you saw and suggest `sf slow`.

## Never

- Work around a blocked edit, for example by writing files through the shell during SLOW.
- Write to `.slowfirst/log.jsonl`, or run commands that change the phase.
- Claim understanding, or pass a gate, on the human's behalf.
