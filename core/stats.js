// @ts-check
// Measurement is local: everything here is computed from the repo's own log.

import { steps as briefSteps } from './brief.js';

/**
 * @param {import('./store.js').Event[]} events
 * @param {Date} [now]
 */
export function computeStats(events, now = new Date()) {
  const s = {
    since: events[0]?.t ?? null,
    tasks: 0,
    intentChanges: 0,
    done: 0,
    gatePassed: 0,
    gateFailed: 0,
    /** @type {{ t: string, reason: string, skipped: string[] }[]} */
    overrides: [],
    backToSlow: 0,
    blockedEdits: 0,
    shellWritesInSlow: 0,
    stateRestored: 0,
    ms: { slow: 0, fast: 0 },
  };
  /** @type {'slow' | 'fast'} */
  let phase = 'slow';
  /** @type {string | null} */
  let since = null;
  let hasIntent = false;
  const tick = (/** @type {string} */ t) => {
    if (since) s.ms[phase] += Date.parse(t) - Date.parse(since);
    since = t;
  };

  for (const e of events) {
    switch (e.type) {
      case 'init':
        since = e.t;
        break;
      case 'intent':
        if (hasIntent) s.intentChanges++;
        else s.tasks++;
        hasIntent = true;
        break;
      case 'gate_failed':
        s.gateFailed++;
        break;
      case 'override':
        s.overrides.push({ t: e.t, reason: e.reason, skipped: e.skipped ?? [] });
        break;
      case 'phase':
        tick(e.t);
        if (e.to === 'fast' && e.via === 'gate') s.gatePassed++;
        if (e.to === 'slow' && e.via === 'human') s.backToSlow++;
        phase = e.to;
        break;
      case 'done':
        tick(e.t);
        s.done++;
        hasIntent = false;
        phase = 'slow';
        break;
      case 'blocked_edit':
        s.blockedEdits++;
        break;
      case 'shell_write_in_slow':
        s.shellWritesInSlow++;
        break;
      case 'state_restored':
        s.stateRestored++;
        break;
    }
  }
  if (since) s.ms[phase] += now.getTime() - Date.parse(since);
  return s;
}

/**
 * Numbers describing how the current task has gone so far. Numbers only: no prompt
 * text and no code, so they can be kept in personal memory and compared across repos.
 * @param {import('./store.js').Event[]} events every event in the repo's log
 * @param {string} md the brief
 * @param {{ files: number, added: number, removed: number }} diff
 * @param {Date} [now]
 */
export function taskSignals(events, md, diff, now = new Date()) {
  let start = 0;
  events.forEach((e, i) => {
    if (e.type === 'done') start = i + 1;
  });
  const task = events.slice(start);
  const s = computeStats(task, now);
  const steps = briefSteps(md);
  /** @type {Set<string>} */
  const files = new Set();
  let turns = 0;
  let promptChars = 0;
  let edits = 0;
  for (const e of task) {
    if (e.type === 'turn') {
      turns++;
      promptChars += e.chars ?? 0;
    }
    if (e.type === 'edit') {
      edits++;
      if (e.file) files.add(e.file);
    }
    if (e.type === 'shell_write_in_slow') for (const f of e.files ?? []) files.add(f);
  }
  const minutes = task[0] ? Math.round((now.getTime() - Date.parse(task[0].t)) / 60000) : 0;
  return {
    minutes,
    slowMinutes: Math.round(s.ms.slow / 60000),
    fastMinutes: Math.round(s.ms.fast / 60000),
    turns,
    promptChars,
    edits,
    filesTouched: files.size,
    // Files worked on that no step mentions: a first proxy for scope creep.
    undeclaredFiles: [...files].filter((f) => !steps.text.includes(f) && !steps.text.includes(f.split('/').pop() ?? f)).length,
    added: diff.added,
    removed: diff.removed,
    stepsPlanned: steps.planned,
    stepsDone: steps.done,
    gateFailed: s.gateFailed,
    overrides: s.overrides.length,
    backToSlow: s.backToSlow,
    blockedEdits: s.blockedEdits,
    shellWritesInSlow: s.shellWritesInSlow,
    stateRestored: s.stateRestored,
    intentChanges: s.intentChanges,
  };
}

/** @param {number} ms */
function duration(ms) {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  return h ? `${h}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

/**
 * @param {ReturnType<typeof computeStats>} s
 * @param {import('./memory.js').Episode[]} [episodes] tasks remembered across every repo
 */
export function formatStats(s, episodes = []) {
  const lines = [
    `slowfirst stats${s.since ? ` since ${s.since.slice(0, 10)}` : ''}`,
    `Tasks: ${s.tasks} started, ${s.done} done, ${s.intentChanges} intent changes`,
    `Gate: ${s.gatePassed} passed, ${s.gateFailed} failed attempts, ${s.overrides.length} overridden`,
  ];
  for (const o of s.overrides) {
    const skipped = o.skipped.length ? ` (skipped: ${o.skipped.join(', ')})` : '';
    lines.push(`  ${o.t.slice(0, 10)}  "${o.reason}"${skipped}`);
  }
  lines.push(
    `Back to SLOW by the human: ${s.backToSlow}`,
    `Edits blocked during SLOW: ${s.blockedEdits}`,
    `Shell commands that changed files during SLOW: ${s.shellWritesInSlow}`,
    `Shell commands that changed slowfirst's own state (undone): ${s.stateRestored}`,
    `Time: SLOW ${duration(s.ms.slow)}, FAST ${duration(s.ms.fast)}`,
  );
  if (episodes.length) {
    const count = (/** @type {string} */ label) => episodes.filter((e) => e.label === label).length;
    lines.push(
      `Personal memory: ${episodes.length} finished tasks (ok ${count('ok')}, drift ${count('drift')}, waste ${count('waste')})`,
    );
  }
  return lines.join('\n');
}
