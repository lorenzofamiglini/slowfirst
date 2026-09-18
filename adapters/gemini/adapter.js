// @ts-check
// Maps Gemini CLI hook events onto the engine. Reference:
// https://geminicli.com/docs/hooks/reference

import path from 'node:path';
import * as engine from '../../core/engine.js';

const HARNESS = 'gemini';
const SHELL_TOOLS = new Set(['run_shell_command']);
const EDIT_TOOLS = new Set(['write_file', 'replace']);

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
  const file = args.file_path ?? args.absolute_path;
  return { kind: 'edit', paths: [file ? path.resolve(input.cwd ?? root, file) : path.join(root, '(unknown file)')] };
}

/**
 * Gemini's hook input carries no tool-call id, so BeforeTool and AfterTool are paired
 * per session. Two shell commands running at once in one session share this slot.
 */
const shellId = (/** @type {Record<string, any>} */ input) => `gemini-${input.session_id ?? 'session'}`;

/**
 * @param {Record<string, any>} input
 * @param {string} root
 * @param {Date} [now]
 * @returns {Record<string, any> | null}
 */
export function handle(input, root, now) {
  const env = { harness: HARNESS, now };
  const context = (/** @type {string} */ text) => (text ? { hookSpecificOutput: { additionalContext: text } } : null);

  switch (input.hook_event_name) {
    case 'SessionStart':
      return context(engine.sessionContext(root));

    case 'BeforeAgent': {
      engine.noteTurn(root, String(input.prompt ?? ''), env);
      const result = engine.handleUserInput(root, String(input.prompt ?? ''), env);
      if (result && !result.context) return { decision: 'deny', reason: result.message };
      const out = context([result?.context, engine.turnContext(root)].filter(Boolean).join('\n\n')) ?? {};
      return result ? { ...out, systemMessage: result.message } : Object.keys(out).length ? out : null;
    }

    case 'BeforeTool': {
      const call = toToolCall(input, root);
      const verdict = engine.checkToolCall(root, call, env);
      if (!verdict.allow) return { decision: 'deny', reason: verdict.reason };
      if (call.kind === 'shell') engine.beforeShell(root, shellId(input));
      return null;
    }

    case 'AfterTool': {
      if (SHELL_TOOLS.has(input.tool_name)) return context(engine.afterShell(root, shellId(input), env) ?? '');
      const call = toToolCall(input, root);
      if (call.kind !== 'edit') return null;
      return context(call.paths.map((file) => engine.afterEdit(root, file, env)).filter(Boolean).join('\n'));
    }
  }
  return null;
}
