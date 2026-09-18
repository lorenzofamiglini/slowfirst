import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as engine from '../core/engine.js';
import { readLog, currentState } from '../core/store.js';
import { makeRepo, completeBrief, writeBrief } from './helpers.js';

import * as memory from '../core/memory.js'; // helpers.js points it at a temp directory

const sf = (root, text) => engine.handleUserInput(root, text);
const edit = (root, file) => engine.checkToolCall(root, { kind: 'edit', paths: [path.join(root, file)] });
const shell = (root, command) => engine.checkToolCall(root, { kind: 'shell', command });
const phase = (root) => currentState(readLog(root)).phase;

/** A repo that is ready for `sf fast`. */
function readyRepo() {
  const root = makeRepo();
  sf(root, 'sf init');
  sf(root, 'sf intent make x configurable for the report job, done when the job reads it');
  writeBrief(root, completeBrief('ignored: the pinned intent comes from the log'));
  return root;
}

test('does nothing in a repo until sf init', () => {
  const root = makeRepo();
  assert.deepEqual(edit(root, 'src/app.js'), { allow: true });
  assert.match(sf(root, 'sf fast').message, /isn't on/);
  assert.equal(engine.turnContext(root), '');
  assert.equal(engine.sessionContext(root), '');
});

test('only exact sf commands are treated as commands', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  assert.equal(sf(root, 'please fix the failing test'), null);
  assert.equal(sf(root, 'sf fastest route'), null);
  assert.notEqual(sf(root, '  SF status  '), null);
});

test('SLOW blocks code edits, but not the brief or files outside the repo', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  const verdict = edit(root, 'src/app.js');
  assert.equal(verdict.allow, false);
  assert.match(verdict.reason, /locked in SLOW/);
  assert.deepEqual(edit(root, '.slowfirst/brief.md'), { allow: true });
  const outside = engine.checkToolCall(root, { kind: 'edit', paths: [path.join(os.tmpdir(), 'notes.md')] });
  assert.deepEqual(outside, { allow: true });
  assert.ok(readLog(root).some((e) => e.type === 'blocked_edit' && e.file === 'src/app.js'));
});

test('the log and the phase are out of the model\'s reach in every phase', () => {
  const root = readyRepo();
  sf(root, 'sf fast');
  assert.equal(phase(root), 'fast');
  assert.equal(edit(root, '.slowfirst/log.jsonl').allow, false);
  assert.equal(shell(root, 'echo {} >> .slowfirst/log.jsonl').allow, false);
  assert.equal(shell(root, 'npx slowfirst fast').allow, false);
  assert.equal(shell(root, 'slowfirst override "just do it"').allow, false);
  assert.deepEqual(shell(root, 'slowfirst status'), { allow: true });
  assert.deepEqual(shell(root, 'npm test'), { allow: true });
});

test('case variants and script paths get the early refusal too', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  assert.equal(edit(root, '.SLOWFIRST/LOG.jsonl').allow, false);
  assert.equal(shell(root, 'echo {} >> .SLOWFIRST/log.jsonl').allow, false);
  assert.equal(shell(root, 'node bin/slowfirst.js fast').allow, false);
  assert.equal(shell(root, 'node "$CLAUDE_PLUGIN_ROOT/bin/slowfirst.js" override "go"').allow, false);
});

test('a shell command that forges human-only events is undone, whatever its spelling', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  const logFile = path.join(root, '.slowfirst', 'log.jsonl');
  engine.beforeShell(root, 'forge');
  // Stands in for any spelling: python, node -e, a variable path, a case variant.
  fs.appendFileSync(logFile, JSON.stringify({ t: 'x', type: 'blocked_edit', file: 'a.js' }) + '\n');
  fs.appendFileSync(logFile, JSON.stringify({ t: 'x', type: 'phase', to: 'fast', via: 'gate' }) + '\n');
  assert.match(engine.afterShell(root, 'forge'), /undone and logged/);
  assert.equal(phase(root), 'slow');
  const types = readLog(root).map((e) => e.type);
  assert.ok(types.includes('blocked_edit'), 'events from other hooks are kept');
  assert.ok(types.includes('state_restored'));
});

test('deleting .slowfirst through the shell is undone', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  sf(root, 'sf intent keep the lock on');
  engine.beforeShell(root, 'rm');
  fs.rmSync(path.join(root, '.slowfirst'), { recursive: true });
  assert.match(engine.afterShell(root, 'rm'), /undone/);
  assert.equal(currentState(readLog(root)).intent, 'keep the lock on');
  assert.equal(edit(root, 'src/app.js').allow, false);
});

test('a SLOW write hidden by committing in the same command is still reported', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  engine.beforeShell(root, 'commit');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 2;\n');
  execFileSync('git', ['commit', '-qam', 'sneaky'], { cwd: root });
  assert.match(engine.afterShell(root, 'commit'), /changed files during SLOW: src\/app\.js/);
});

test('the CLI refuses to loosen the lock without an interactive terminal', () => {
  const root = makeRepo();
  const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'slowfirst.js');
  const run = (...args) => execFileSync('node', [cli, ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  run('init');
  assert.throws(() => run('fast'), /only runs in an interactive terminal/);
  assert.throws(() => run('override', 'because'), /only runs in an interactive terminal/);
  assert.match(run('status'), /SLOW/);
  assert.equal(phase(root), 'slow');
});

test('the gate lists everything missing and stays closed', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  const result = sf(root, 'sf fast');
  assert.equal(result.context, undefined);
  for (const expected of [/No intent/, /No beliefs/, /No teach-back/, /No steps/]) assert.match(result.message, expected);
  assert.equal(phase(root), 'slow');
  assert.ok(readLog(root).some((e) => e.type === 'gate_failed'));
});

test('assumed, untagged or unsupported beliefs keep the gate closed', () => {
  const root = readyRepo();
  writeBrief(
    root,
    completeBrief('x').replace(
      /## Beliefs\n[\s\S]*?\n\n/,
      '## Beliefs\n- [assumed] the job reads x at startup\n- [observed] nobody else uses x\n- x is an int\n\n',
    ),
  );
  const { message } = sf(root, 'sf fast');
  assert.match(message, /Still assumed[\s\S]*reads x at startup/);
  assert.match(message, /No evidence[\s\S]*nobody else uses x/);
  assert.match(message, /Tag each belief[\s\S]*x is an int/);
  assert.equal(phase(root), 'slow');
});

test('a complete brief passes the gate and unlocks edits', () => {
  const root = readyRepo();
  const result = sf(root, 'sf fast');
  assert.match(result.message, /Gate passed[\s\S]*change x to 2/);
  assert.ok(result.context);
  assert.deepEqual(edit(root, 'src/app.js'), { allow: true });
  assert.match(engine.turnContext(root), /Phase FAST[\s\S]*Current step: change x to 2/);
});

test('the pinned intent comes from the human, not from edits to the brief', () => {
  const root = readyRepo();
  assert.match(engine.turnContext(root), /the human's words\): make x configurable/);
  assert.doesNotMatch(engine.turnContext(root), /ignored/);
});

test('an override needs a reason and records what it skipped', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  assert.match(sf(root, 'sf override').message, /needs a reason/);
  assert.equal(phase(root), 'slow');
  const result = sf(root, 'sf override typo in the README');
  assert.match(result.context, /skipped the gate[\s\S]*unknown/);
  assert.equal(phase(root), 'fast');
  const override = readLog(root).find((e) => e.type === 'override');
  assert.equal(override.reason, 'typo in the README');
  assert.ok(override.skipped.includes('intent'));
});

test('changing the intent during FAST goes back to SLOW', () => {
  const root = readyRepo();
  sf(root, 'sf fast');
  const result = sf(root, 'sf intent also expose it in the API');
  assert.match(result.message, /Back to SLOW/);
  assert.equal(phase(root), 'slow');
});

test('files changed through the shell during SLOW are reported', () => {
  const root = makeRepo();
  sf(root, 'sf init');
  engine.beforeShell(root, 'call-1');
  assert.equal(engine.afterShell(root, 'call-1'), null);

  engine.beforeShell(root, 'call-2');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 2;\n');
  fs.writeFileSync(path.join(root, 'src', 'new.js'), '');
  const note = engine.afterShell(root, 'call-2');
  assert.match(note, /src\/app\.js/);
  assert.match(note, /src\/new\.js/);
  assert.ok(readLog(root).some((e) => e.type === 'shell_write_in_slow'));

  // Changing a file that was already modified is still caught.
  engine.beforeShell(root, 'call-3');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 3;\n');
  assert.match(engine.afterShell(root, 'call-3'), /src\/app\.js/);
});

test('shell commands are not tracked during FAST', () => {
  const root = readyRepo();
  sf(root, 'sf fast');
  engine.beforeShell(root, 'call-1');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 2;\n');
  assert.equal(engine.afterShell(root, 'call-1'), null);
});

test('done asks for one word about how the task went', () => {
  const root = readyRepo();
  sf(root, 'sf fast');
  const asked = sf(root, 'sf done');
  assert.match(asked.message, /sf done ok\s+went as expected/);
  assert.equal(phase(root), 'fast', 'the task is not closed until it is labelled');
});

test('a finished task is remembered as numbers, with no prompt text or code', () => {
  const root = readyRepo();
  engine.noteTurn(root, 'can you look at the exporter first?');
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 2;\n');
  engine.afterEdit(root, path.join(root, 'src', 'app.js'));
  sf(root, 'sf fast');
  sf(root, 'sf done drift');

  const episode = memory.episodes().at(-1);
  assert.equal(episode.label, 'drift');
  assert.equal(episode.signals.turns, 1);
  assert.equal(episode.signals.edits, 1);
  assert.equal(episode.signals.added, 1);
  assert.equal(episode.signals.filesTouched, 1);
  assert.equal(episode.signals.undeclaredFiles, 0, 'src/app.js is named in the steps');
  assert.doesNotMatch(JSON.stringify(episode), /exporter|export const/, 'no prompt text, no code');
  assert.match(sf(root, 'sf stats').message, /Personal memory: \d+ finished tasks \(ok \d+, drift [1-9]/);
});

test('work on files no step mentions is counted as undeclared', () => {
  const root = readyRepo();
  sf(root, 'sf fast');
  engine.afterEdit(root, path.join(root, 'src', 'app.js'));
  fs.writeFileSync(path.join(root, 'src', 'billing.js'), 'export const rate = 1;\n');
  engine.afterEdit(root, path.join(root, 'src', 'billing.js'));
  sf(root, 'sf done ok');
  assert.equal(memory.episodes().at(-1).signals.undeclaredFiles, 1);
});

test('done archives the brief and starts the next task in SLOW', () => {
  const root = readyRepo();
  sf(root, 'sf fast');
  const result = sf(root, 'sf done ok');
  const archived = result.message.match(/archived to (\S+)\./)[1];
  assert.match(fs.readFileSync(path.join(root, archived), 'utf8'), /change x to 2/);
  const state = currentState(readLog(root));
  assert.equal(state.phase, 'slow');
  assert.equal(state.intent, null);
  assert.match(engine.turnContext(root), /No intent yet/);
});

test('stats report gate results, overrides and time per phase', () => {
  const root = makeRepo();
  const at = (minutes) => ({ now: new Date(Date.UTC(2026, 8, 18, 9, minutes)) });
  engine.handleUserInput(root, 'sf init', at(0));
  engine.handleUserInput(root, 'sf fast', at(5));
  engine.handleUserInput(root, 'sf override hotfix, will backfill the brief', at(10));
  engine.handleUserInput(root, 'sf slow the fix did not hold', at(40));
  const { message } = engine.handleUserInput(root, 'sf stats', at(50));
  assert.match(message, /0 passed, 1 failed attempts, 1 overridden/);
  assert.match(message, /"hotfix, will backfill the brief"/);
  assert.match(message, /Back to SLOW by the human: 1/);
  assert.match(message, /SLOW 20m, FAST 30m/);
});
