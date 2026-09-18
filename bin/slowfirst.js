#!/usr/bin/env node
// @ts-check
// The human's terminal channel: the same commands as `sf ...` in a chat prompt,
// for harnesses without an adapter or for working outside any AI tool.

import { spawn } from 'node:child_process';
import { findRoot } from '../core/store.js';
import { handleUserInput, writeReport } from '../core/engine.js';

const USAGE = `usage: slowfirst <command>

  init                 turn slowfirst on in this repo
  intent <text>        the problem, who uses the result and for what, how you'll know it's done
  fast                 check the brief and unlock code edits
  slow [reason]        go back to understanding
  override <reason>    skip the gate (logged)
  done                 close the task and archive the brief
  status               phase, intent and what the gate still needs
  stats                overrides, gate results and time per phase
  report [--open]      build the local dashboard from your personal memory`;

const args = process.argv.slice(2);
if (args.length === 0 || ['help', '-h', '--help'].includes(args[0])) {
  console.log(USAGE);
  process.exit(0);
}

// Commands that loosen the lock or speak for the human need an interactive terminal.
// An AI agent's shell has none, so the agent can't run them however it spells the call.
const HUMAN_ONLY = new Set(['intent', 'fast', 'override', 'done']);
if (HUMAN_ONLY.has(args[0]) && !(process.stdin.isTTY && process.stdout.isTTY)) {
  console.error(
    `slowfirst: "${args[0]}" only runs in an interactive terminal, so an AI agent can't run it for you. ` +
      `In your agent, type \`sf ${args[0]}\` in the prompt instead.`,
  );
  process.exit(1);
}

// The dashboard reads the personal memory, so it works outside a slowfirst repo too.
if (args[0] === 'report') {
  const file = writeReport();
  console.log(file);
  if (args.includes('--open')) {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    spawn(opener, [file], { detached: true, stdio: 'ignore' }).unref();
  }
  process.exit(0);
}

const result = handleUserInput(findRoot(process.cwd()), `sf ${args.join(' ')}`, { harness: 'cli' });
if (!result) {
  console.error(`slowfirst: unknown command "${args[0]}"\n\n${USAGE}`);
  process.exit(1);
}
console.log(result.message);
