// @ts-check
// Measurement is local: everything here is computed from the repo's own log.

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

/** @param {number} ms */
function duration(ms) {
  const minutes = Math.round(ms / 60000);
  const h = Math.floor(minutes / 60);
  return h ? `${h}h${String(minutes % 60).padStart(2, '0')}m` : `${minutes}m`;
}

/** @param {ReturnType<typeof computeStats>} s */
export function formatStats(s) {
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
  return lines.join('\n');
}
