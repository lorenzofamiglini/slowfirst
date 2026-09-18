// @ts-check
// The harness-independent engine. Adapters translate their tool's hooks into four
// calls: handleUserInput, checkToolCall, beforeShell/afterShell, and the context
// builders. Nothing in here knows which harness is calling.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import * as brief from './brief.js';
import { snapshot, changedSince } from './git.js';
import { computeStats, formatStats } from './stats.js';

/**
 * @typedef {{ kind: 'edit', paths: string[] } | { kind: 'shell', command: string } | { kind: 'other', name: string }} ToolCall
 * @typedef {{ allow: true } | { allow: false, reason: string }} Verdict
 * @typedef {{ message: string, context?: string }} InputResult
 *   message is shown to the human. When context is present the input is passed on
 *   to the model with that context; otherwise the harness consumes the input.
 * @typedef {{ now?: Date, harness?: string }} Env
 */

const COMMAND = /^\s*sf\s+(init|intent|fast|slow|override|done|status|stats)(?:\s+([\s\S]*?))?\s*$/i;
// These two patterns only give the model a clear early answer for the obvious
// spellings. The real guards are afterShell (which undoes any change to the log made
// by a shell command) and the CLI's refusal to change the phase without a terminal.
const PHASE_CHANGE_IN_SHELL = /slowfirst(?:\.js)?['"]?\s+(?:init|intent|fast|slow|override|done)\b/i;
const PROTECTED_IN_SHELL = /\.slowfirst[\\/]+log\.jsonl/i;
// Event types only the human's input may write. A shell command that adds them is undone.
const HUMAN_ONLY = new Set(['init', 'intent', 'phase', 'override', 'done']);
const INTENT_HINT = "`sf intent <the problem, who uses the result and for what, how you'll know it's done>`";

const SKILL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'slowfirst', 'SKILL.md');

/** @param {string} root @param {{ type: string, [k: string]: any }} event @param {Env} env */
const log = (root, event, env) => store.append(root, env.harness ? { ...event, harness: env.harness } : event, env.now);

/** @param {string} root */
function load(root) {
  const events = store.readLog(root);
  const md = store.readBrief(root);
  return { events, md, ...store.currentState(events) };
}

/**
 * Handle text typed by the human. Only this path can change the phase, so the
 * model can't unlock itself: adapters must call it with human input only.
 * @param {string} root
 * @param {string} text
 * @param {Env} [env]
 * @returns {InputResult | null} null when the text is not a slowfirst command
 */
export function handleUserInput(root, text, env = {}) {
  const match = text.match(COMMAND);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const arg = (match[2] ?? '').trim();

  if (command === 'init') return init(root, env);
  if (!store.isActive(root)) return { message: "slowfirst isn't on in this repo. Type `sf init` to turn it on." };

  const state = load(root);
  switch (command) {
    case 'intent': {
      if (!arg) return { message: `Write the intent after the command: ${INTENT_HINT}` };
      log(root, { type: 'intent', text: arg }, env);
      store.writeBrief(root, brief.withIntent(state.md, arg));
      if (state.phase === 'fast') {
        log(root, { type: 'phase', to: 'slow', via: 'intent' }, env);
        return {
          message: 'Intent changed. Back to SLOW: the plan was built on the old intent.',
          context: '[slowfirst] The human changed the intent, so the session is back in SLOW. Work out with them which beliefs and steps in the brief still hold.',
        };
      }
      return {
        message: 'Intent recorded.',
        context: `[slowfirst] The human set the intent. Start the SLOW work: list the beliefs any plan would rest on, tag them [assumed] in .slowfirst/brief.md, and propose the cheapest way to check each. Don't propose a solution yet.`,
      };
    }

    case 'fast': {
      if (state.phase === 'fast') return { message: 'Already in FAST.' };
      const problems = brief.checkGate(state.intent, state.md);
      if (problems.length) {
        log(root, { type: 'gate_failed', missing: problems.map((p) => p.label) }, env);
        return {
          message: [
            'Not ready for FAST yet:',
            ...problems.map((p) => `  ✗ ${p.detail}`),
            'Fix these in .slowfirst/brief.md, or skip the gate with `sf override <reason>` (logged).',
          ].join('\n'),
        };
      }
      log(root, { type: 'phase', to: 'fast', via: 'gate' }, env);
      return {
        message: `Gate passed. FAST. Current step: ${brief.currentStep(state.md) ?? '(none open)'}`,
        context: '[slowfirst] The human passed the gate. Start on the first open step in the brief.',
      };
    }

    case 'override': {
      if (!arg) {
        return {
          message: 'An override needs a reason: `sf override <why>`. It goes in the log, so you can see later which gates get in the way.',
        };
      }
      if (state.phase === 'fast') return { message: 'Already in FAST, so there is nothing to override.' };
      const skipped = brief.checkGate(state.intent, state.md).map((p) => p.label);
      log(root, { type: 'override', gate: 'fast', reason: arg, skipped }, env);
      log(root, { type: 'phase', to: 'fast', via: 'override' }, env);
      const unknown = skipped.length ? ` The gate had not checked: ${skipped.join(', ')}, so treat those as unknown and keep changes small.` : '';
      return {
        message: `Override logged ("${arg}"). FAST.`,
        context: `[slowfirst] The human skipped the gate (reason: ${arg}). Phase FAST.${unknown}`,
      };
    }

    case 'slow': {
      if (state.phase === 'slow') return { message: 'Already in SLOW.' };
      log(root, { type: 'phase', to: 'slow', via: 'human', ...(arg && { reason: arg }) }, env);
      return {
        message: 'Back to SLOW. Code edits are locked.',
        context: `[slowfirst] The human went back to SLOW${arg ? ` (reason: ${arg})` : ''}. Stop building. Work out with them what was wrong in the picture or the plan, and update the brief.`,
      };
    }

    case 'done': {
      if (!state.intent) return { message: 'No active task to close.' };
      const p = store.paths(root);
      fs.mkdirSync(p.archive, { recursive: true });
      const slug = state.intent.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-|-$/g, '');
      const file = path.join(p.archive, `${(env.now ?? new Date()).toISOString().slice(0, 10)}-${slug || 'task'}.md`);
      fs.writeFileSync(file, state.md);
      log(root, { type: 'done', archive: path.relative(root, file) }, env);
      store.writeBrief(root, brief.template(null));
      return { message: `Task closed. Brief archived to ${path.relative(root, file)}. Back to SLOW for the next task.` };
    }

    case 'status':
      return { message: status(state) };

    case 'stats':
      return { message: formatStats(computeStats(state.events, env.now)) };
  }
  return null;
}

/** @param {string} root @param {Env} env @returns {InputResult} */
function init(root, env) {
  if (store.isActive(root)) return { message: 'slowfirst is already on in this repo.' };
  const p = store.paths(root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(path.join(p.dir, '.gitignore'), 'log.jsonl\n');
  store.writeBrief(root, brief.template(null));
  log(root, { type: 'init' }, env);
  return {
    message: `slowfirst is on. You're in SLOW: code edits stay locked until the gate passes. Start with ${INTENT_HINT}, in your own words.`,
    context: sessionContext(root),
  };
}

/** @param {ReturnType<typeof load>} state */
function status(state) {
  const lines = [`slowfirst: ${state.phase.toUpperCase()}${state.since ? ` since ${state.since.slice(0, 16).replace('T', ' ')}` : ''}`];
  lines.push(`Intent: ${state.intent ?? '(not set)'}`);
  if (state.phase === 'slow') {
    const problems = brief.checkGate(state.intent, state.md);
    lines.push(problems.length ? `Gate still needs: ${problems.map((p) => p.label).join(', ')}` : 'Gate: ready. Type `sf fast`.');
  } else {
    lines.push(`Current step: ${brief.currentStep(state.md) ?? '(none open)'}`);
  }
  return lines.join('\n');
}

/**
 * @param {string} root
 * @param {ToolCall} call
 * @param {Env} [env]
 * @returns {Verdict}
 */
export function checkToolCall(root, call, env = {}) {
  if (!store.isActive(root)) return { allow: true };

  if (call.kind === 'shell') {
    if (PROTECTED_IN_SHELL.test(call.command)) {
      return { allow: false, reason: '[slowfirst] .slowfirst/log.jsonl is the human\'s record and only slowfirst writes to it. Run `slowfirst status` or `slowfirst stats` to read the state.' };
    }
    if (PHASE_CHANGE_IN_SHELL.test(call.command)) {
      return { allow: false, reason: '[slowfirst] Only the human changes the phase, by typing an `sf` command. Ask them.' };
    }
    return { allow: true };
  }

  if (call.kind !== 'edit') return { allow: true };
  const { phase } = store.currentState(store.readLog(root));
  const realRoot = real(root);
  for (const file of call.paths) {
    const rel = path.relative(realRoot, real(path.resolve(root, file))).split(path.sep).join('/');
    if (rel.startsWith('../') || path.isAbsolute(rel)) continue; // outside the repo
    // Lower-cased because macOS and Windows file systems ignore case.
    if (rel.toLowerCase() === '.slowfirst/log.jsonl') {
      return { allow: false, reason: "[slowfirst] .slowfirst/log.jsonl is the human's record and only slowfirst writes to it." };
    }
    if (phase === 'slow' && !rel.startsWith('.slowfirst/')) {
      log(root, { type: 'blocked_edit', file: rel }, env);
      return {
        allow: false,
        reason:
          '[slowfirst] Code edits are locked in SLOW. The human unlocks them with `sf fast` once the brief is complete. ' +
          "Don't work around this, for example through the shell. Use this phase to check beliefs and help the human understand the code; you can write to .slowfirst/brief.md.",
      };
    }
  }
  return { allow: true };
}

/**
 * Resolve symlinks so the same file can't look like it's outside the repo
 * (for example /var vs /private/var on macOS). Works for files that don't exist yet.
 * @param {string} p @returns {string}
 */
function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(real(parent), path.basename(p));
  }
}

/**
 * Where the state before a shell command is kept. Outside the repo, so the command
 * can't reach it by deleting `.slowfirst/`.
 * @param {string} root @param {string} id
 */
function guardFile(root, id) {
  const repo = createHash('sha1').update(real(root)).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), 'slowfirst', repo, `${id.replace(/[^\w-]/g, '_')}.json`);
}

/**
 * Call before a shell command runs. Remembers slowfirst's own state, and in SLOW
 * the state of the repo, so afterShell can tell what the command changed.
 * @param {string} root @param {string} id a unique id for this command
 */
export function beforeShell(root, id) {
  if (!store.isActive(root)) return;
  const p = store.paths(root);
  const guard = {
    log: fs.existsSync(p.log) ? fs.readFileSync(p.log, 'utf8') : '',
    brief: store.readBrief(root),
    tree: store.currentState(store.readLog(root)).phase === 'slow' ? snapshot(root) : null,
  };
  const file = guardFile(root, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(guard));
}

/**
 * Call after a shell command ran. Undoes any change the command made to slowfirst's
 * state, and reports files it changed during SLOW.
 * @param {string} root @param {string} id @param {Env} [env]
 * @returns {string | null} a note for the model, or null if nothing happened
 */
export function afterShell(root, id, env = {}) {
  const file = guardFile(root, id);
  if (!fs.existsSync(file)) return null;
  const guard = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(file, { force: true });

  const notes = [];
  if (restoreState(root, guard, env)) {
    notes.push(
      "[slowfirst] That command changed slowfirst's own state (.slowfirst/). The change has been undone and logged. " +
        'Only the human changes the phase, by typing an `sf` command. If they want slowfirst off, they remove .slowfirst/ themselves.',
    );
  }
  if (guard.tree) {
    const changed = changedSince(root, guard.tree);
    if (changed.length) {
      log(root, { type: 'shell_write_in_slow', files: changed }, env);
      notes.push(
        `[slowfirst] This command changed files during SLOW: ${changed.join(', ')}. Code changes are locked in this phase. Tell the human, and revert them unless they ask you to keep them.`,
      );
    }
  }
  return notes.length ? notes.join('\n') : null;
}

/**
 * Keeps events other hooks appended while the command ran; drops anything only the
 * human may write, and restores the log or the folder if they were rewritten or removed.
 * @param {string} root @param {{ log: string, brief: string }} guard @param {Env} env
 * @returns {boolean} whether anything had to be restored
 */
function restoreState(root, guard, env) {
  const p = store.paths(root);
  const current = fs.existsSync(p.log) ? fs.readFileSync(p.log, 'utf8') : null;
  if (current === guard.log) return false;

  let tampered = current === null || !current.startsWith(guard.log);
  let kept = '';
  if (!tampered) {
    for (const line of /** @type {string} */ (current).slice(guard.log.length).split('\n').filter(Boolean)) {
      try {
        if (HUMAN_ONLY.has(JSON.parse(line).type)) tampered = true;
        else kept += `${line}\n`;
      } catch {
        tampered = true;
      }
    }
  }
  if (!tampered) return false;

  fs.mkdirSync(p.dir, { recursive: true });
  const ignore = path.join(p.dir, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, 'log.jsonl\n');
  if (!fs.existsSync(p.brief)) store.writeBrief(root, guard.brief);
  fs.writeFileSync(p.log, guard.log + kept);
  log(root, { type: 'state_restored' }, env);
  return true;
}

/** @param {string} text @param {number} max */
const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/**
 * Short context pinned to every turn.
 * @param {string} root
 * @returns {string}
 */
export function turnContext(root) {
  if (!store.isActive(root)) return '';
  const state = load(root);
  if (state.phase === 'slow' && !state.intent) {
    return [
      '[slowfirst] Phase SLOW. No intent yet.',
      `Ask the human to state the problem in their own words with ${INTENT_HINT}. Don't write it for them, and don't start on a solution.`,
    ].join('\n');
  }
  const intent = `Intent (the human's words): ${clip(state.intent ?? '(not set)', 1500)}`;
  if (state.phase === 'slow') {
    const missing = brief.checkGate(state.intent, state.md).map((p) => p.label);
    return [
      '[slowfirst] Phase SLOW: code edits are locked until the human types `sf fast`.',
      intent,
      'Help the human understand before anything is built: check [assumed] beliefs cheapest first, show real code at file:line, and ask them to predict or explain it. Record results in .slowfirst/brief.md.',
      missing.length ? `The gate still needs: ${missing.join(', ')}.` : 'The brief is complete. The human can type `sf fast`.',
    ].join('\n');
  }
  return [
    '[slowfirst] Phase FAST.',
    intent,
    `Current step: ${brief.currentStep(state.md) ?? "none open. Ask the human what's next, or suggest `sf done`"}`,
    'Work on this step only, keep the diff small, and verify it before the next. If something contradicts a belief or the plan, stop and tell the human; they can type `sf slow`.',
  ].join('\n');
}

/**
 * Full rules, for the start of a session and after compaction.
 * @param {string} root
 * @returns {string}
 */
export function sessionContext(root) {
  if (!store.isActive(root)) return '';
  const rules = fs.readFileSync(SKILL, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  return `${rules}\n\n${turnContext(root)}`;
}
