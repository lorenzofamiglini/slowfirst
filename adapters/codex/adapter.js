// @ts-check
// Maps Codex CLI hook events onto the engine. Reference:
// https://learn.chatgpt.com/docs/hooks
// Codex edits files through apply_patch, whose input is the patch text; the file
// paths are read from its "*** Add/Update/Delete File:" and "*** Move to:" lines.

import path from 'node:path';
import * as engine from '../../core/engine.js';

const HARNESS = 'codex';
const SHELL_TOOLS = new Set(['Bash']);
const EDIT_TOOLS = new Set(['apply_patch', 'Edit', 'Write']);

/** @param {string} patch @returns {string[]} */
export function patchPaths(patch) {
  const paths = [];
  for (const match of patch.matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+?)\s*$/gm)) paths.push(match[1]);
  return paths;
}

/**
 * @param {Record<string, any>} input the hook's stdin JSON
 * @param {string} root
 * @returns {import('../../core/engine.js').ToolCall}
 */
export function toToolCall(input, root) {
  const name = String(input.tool_name ?? '');
  const args = input.tool_input ?? {};
  if (SHELL_TOOLS.has(name)) return { kind: 'shell', command: String(args.command ?? '') };
  if (!EDIT_TOOLS.has(name)) return { kind: 'other', name };
  const text = [args.command, args.input, args.patch].find((v) => typeof v === 'string') ?? '';
  const named = [args.file_path, ...patchPaths(text)].filter(Boolean);
  const base = input.cwd ?? root;
  // An edit whose target can't be read is treated as an edit inside the repo, so SLOW still holds.
  return { kind: 'edit', paths: named.length ? named.map((p) => path.resolve(base, p)) : [path.join(root, '(unknown file)')] };
}

/**
 * @param {Record<string, any>} input
 * @param {string} root
 * @param {Date} [now]
 * @returns {Record<string, any> | null}
 */
export function handle(input, root, now) {
  const env = { harness: HARNESS, now };
  const event = input.hook_event_name;
  const context = (/** @type {string} */ text) => (text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : null);

  if (event === 'SessionStart') return context(engine.sessionContext(root));

  if (event === 'UserPromptSubmit') {
    engine.noteTurn(root, String(input.prompt ?? ''), env);
    const result = engine.handleUserInput(root, String(input.prompt ?? ''), env);
    if (result && !result.context) return { decision: 'block', reason: result.message };
    return context([result?.context, engine.turnContext(root)].filter(Boolean).join('\n\n'));
  }

  if (event === 'PreToolUse') {
    const call = toToolCall(input, root);
    const verdict = engine.checkToolCall(root, call, env);
    if (!verdict.allow) {
      return { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: verdict.reason } };
    }
    if (call.kind === 'shell') engine.beforeShell(root, String(input.tool_use_id ?? ''));
    return null;
  }

  if (event === 'PostToolUse') {
    if (SHELL_TOOLS.has(input.tool_name)) return context(engine.afterShell(root, String(input.tool_use_id ?? ''), env) ?? '');
    const call = toToolCall(input, root);
    if (call.kind === 'edit') for (const file of call.paths) engine.afterEdit(root, file, env);
    return null;
  }

  return null;
}
