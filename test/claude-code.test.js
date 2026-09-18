import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handle } from '../adapters/claude-code/adapter.js';
import { makeRepo } from './helpers.js';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'claude-code', 'hook.js');
const prompt = (root, text) => handle({ hook_event_name: 'UserPromptSubmit', prompt: text }, root);
const preTool = (root, tool_name, tool_input, tool_use_id = 'toolu_1') =>
  handle({ hook_event_name: 'PreToolUse', tool_name, tool_input, tool_use_id }, root);

test('stays silent in repos that have not turned slowfirst on', () => {
  const root = makeRepo();
  assert.equal(handle({ hook_event_name: 'SessionStart', source: 'startup' }, root), null);
  assert.equal(prompt(root, 'fix the bug'), null);
  assert.equal(preTool(root, 'Edit', { file_path: path.join(root, 'src/app.js') }), null);
});

test('commands that only inform the human are consumed, not sent to the model', () => {
  const root = makeRepo();
  prompt(root, 'sf init');
  const out = prompt(root, 'sf status');
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /SLOW/);
});

test('commands the model must act on are passed on with context', () => {
  const root = makeRepo();
  const out = prompt(root, 'sf init');
  assert.equal(out.decision, undefined);
  assert.match(out.systemMessage, /slowfirst is on/);
  assert.match(out.hookSpecificOutput.additionalContext, /SLOW: you are an examiner/);
});

test('every prompt carries the phase and the pinned intent', () => {
  const root = makeRepo();
  prompt(root, 'sf init');
  prompt(root, 'sf intent speed up the nightly export, done when it finishes before 6am');
  const out = prompt(root, 'where do we start?');
  assert.match(out.hookSpecificOutput.additionalContext, /Phase SLOW[\s\S]*speed up the nightly export/);
});

test('edits are denied in SLOW with a reason for the model', () => {
  const root = makeRepo();
  prompt(root, 'sf init');
  const out = preTool(root, 'Write', { file_path: path.join(root, 'src/app.js'), content: '' });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /locked in SLOW/);
  assert.equal(preTool(root, 'Read', { file_path: path.join(root, 'src/app.js') }), null);
});

test('a shell command that writes files during SLOW gets flagged afterwards', () => {
  const root = makeRepo();
  prompt(root, 'sf init');
  assert.equal(preTool(root, 'Bash', { command: 'sed -i "" s/1/2/ src/app.js' }, 'toolu_9'), null);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 2;\n');
  const out = handle({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_9', tool_input: {} }, root);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /changed files during SLOW: src\/app\.js/);
});

test('the hook script speaks JSON over stdin/stdout and never breaks the session', () => {
  const root = makeRepo();
  prompt(root, 'sf init');
  const run = (stdin) =>
    execFileSync('node', [HOOK], { input: stdin, env: { ...process.env, CLAUDE_PROJECT_DIR: root }, encoding: 'utf8' });

  const denied = JSON.parse(
    run(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/app.js') } })),
  );
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(run('not json'), '');
});
