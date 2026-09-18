// @ts-check
// Maps Claude Code hook events onto the engine. Reference:
// https://code.claude.com/docs/en/hooks

import * as engine from '../../core/engine.js';

const HARNESS = 'claude-code';
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/**
 * @param {string} name
 * @param {Record<string, any>} [input]
 * @returns {import('../../core/engine.js').ToolCall}
 */
export function toToolCall(name, input = {}) {
  if (EDIT_TOOLS.has(name)) return { kind: 'edit', paths: [input.file_path ?? input.notebook_path].filter(Boolean) };
  if (SHELL_TOOLS.has(name)) return { kind: 'shell', command: String(input.command ?? '') };
  return { kind: 'other', name };
}

/**
 * @param {Record<string, any>} input the hook's stdin JSON
 * @param {string} root repository root
 * @param {Date} [now]
 * @returns {Record<string, any> | null} JSON for stdout, or null for no output
 */
export function handle(input, root, now) {
  const env = { harness: HARNESS, now };
  const event = input.hook_event_name;

  if (event === 'SessionStart') {
    const context = engine.sessionContext(root);
    return context ? { hookSpecificOutput: { hookEventName: event, additionalContext: context } } : null;
  }

  if (event === 'UserPromptSubmit') {
    // The prompt the human typed. This is the only channel that can change the phase.
    engine.noteTurn(root, String(input.prompt ?? ''), env);
    const result = engine.handleUserInput(root, String(input.prompt ?? ''), env);
    if (result && !result.context) return { decision: 'block', reason: result.message };
    const context = [result?.context, engine.turnContext(root)].filter(Boolean).join('\n\n');
    /** @type {Record<string, any>} */
    const out = {};
    if (result) out.systemMessage = result.message;
    if (context) out.hookSpecificOutput = { hookEventName: event, additionalContext: context };
    return Object.keys(out).length ? out : null;
  }

  if (event === 'PreToolUse') {
    const call = toToolCall(input.tool_name, input.tool_input);
    const verdict = engine.checkToolCall(root, call, env);
    if (!verdict.allow) {
      return { hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: verdict.reason } };
    }
    if (call.kind === 'shell') engine.beforeShell(root, String(input.tool_use_id ?? ''));
    return null; // no opinion: the normal permission flow applies
  }

  if (event === 'PostToolUse') {
    if (SHELL_TOOLS.has(input.tool_name)) {
      const note = engine.afterShell(root, String(input.tool_use_id ?? ''), env);
      return note ? { decision: 'block', reason: note } : null;
    }
    const call = toToolCall(input.tool_name, input.tool_input);
    if (call.kind === 'edit') for (const file of call.paths) engine.afterEdit(root, file, env);
    return null;
  }

  return null;
}
