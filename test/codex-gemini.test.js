// The Codex and Gemini adapters are written against their published hook docs.
// These tests pin the mapping; they are not a substitute for running the real CLIs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as codex from '../adapters/codex/adapter.js';
import * as gemini from '../adapters/gemini/adapter.js';
import { makeRepo } from './helpers.js';

const PATCH = `*** Begin Patch
*** Update File: src/app.js
@@
-export const x = 1;
+export const x = 2;
*** Add File: src/new.js
+export {};
*** End Patch`;

test('codex: reads every file path out of an apply_patch', () => {
  assert.deepEqual(codex.patchPaths(PATCH), ['src/app.js', 'src/new.js']);
});

test('codex: apply_patch is denied in SLOW, relative to the cwd Codex reports', () => {
  const root = makeRepo();
  codex.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'sf init' }, root);
  const out = codex.handle(
    { hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: PATCH }, cwd: root, tool_use_id: 'c1' },
    root,
  );
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('codex: a patch whose files cannot be read is still denied in SLOW', () => {
  const root = makeRepo();
  codex.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'sf init' }, root);
  const out = codex.handle({ hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: 'garbled' } }, root);
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('codex: sf commands are consumed or passed on, like Claude Code', () => {
  const root = makeRepo();
  codex.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'sf init' }, root);
  assert.equal(codex.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'sf status' }, root).decision, 'block');
  const out = codex.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'what does app.js do?' }, root);
  assert.match(out.hookSpecificOutput.additionalContext, /Phase SLOW/);
});

test('codex: a shell write during SLOW is reported after the command', () => {
  const root = makeRepo();
  codex.handle({ hook_event_name: 'UserPromptSubmit', prompt: 'sf init' }, root);
  const call = { tool_name: 'Bash', tool_input: { command: 'echo 2 > src/app.js' }, tool_use_id: 'c2' };
  assert.equal(codex.handle({ hook_event_name: 'PreToolUse', ...call }, root), null);
  fs.writeFileSync(path.join(root, 'src', 'app.js'), '2\n');
  const out = codex.handle({ hook_event_name: 'PostToolUse', ...call }, root);
  assert.match(out.hookSpecificOutput.additionalContext, /changed files during SLOW/);
});

test('gemini: write_file and replace are denied in SLOW; reads are not touched', () => {
  const root = makeRepo();
  gemini.handle({ hook_event_name: 'BeforeAgent', prompt: 'sf init' }, root);
  for (const tool_name of ['write_file', 'replace']) {
    const out = gemini.handle({ hook_event_name: 'BeforeTool', tool_name, tool_input: { file_path: path.join(root, 'src/app.js') } }, root);
    assert.equal(out.decision, 'deny');
    assert.match(out.reason, /locked in SLOW/);
  }
  assert.equal(gemini.handle({ hook_event_name: 'BeforeTool', tool_name: 'read_file', tool_input: { file_path: 'src/app.js' } }, root), null);
});

test('gemini: sf commands are consumed or passed on with a message to the human', () => {
  const root = makeRepo();
  const init = gemini.handle({ hook_event_name: 'BeforeAgent', prompt: 'sf init' }, root);
  assert.match(init.systemMessage, /slowfirst is on/);
  assert.match(init.hookSpecificOutput.additionalContext, /examiner/);
  const status = gemini.handle({ hook_event_name: 'BeforeAgent', prompt: 'sf status' }, root);
  assert.equal(status.decision, 'deny');
  assert.match(status.reason, /SLOW/);
});

test('gemini: a shell write during SLOW is reported after the command', () => {
  const root = makeRepo();
  gemini.handle({ hook_event_name: 'BeforeAgent', prompt: 'sf init' }, root);
  const call = { session_id: 's1', tool_name: 'run_shell_command', tool_input: { command: 'touch src/b.js' } };
  assert.equal(gemini.handle({ hook_event_name: 'BeforeTool', ...call }, root), null);
  fs.writeFileSync(path.join(root, 'src', 'b.js'), '');
  const out = gemini.handle({ hook_event_name: 'AfterTool', ...call }, root);
  assert.match(out.hookSpecificOutput.additionalContext, /src\/b\.js/);
});
