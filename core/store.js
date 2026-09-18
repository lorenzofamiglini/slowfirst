// @ts-check
// Repo-local state. Everything slowfirst knows lives in `.slowfirst/` inside the
// repository, so the same rules apply whichever tool or person is working.
// The phase is not stored anywhere: it is replayed from the append-only log.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const DIR = '.slowfirst';

/** @param {string} start */
export function findRoot(start) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: start,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return path.resolve(start);
  }
}

/** @param {string} root */
export function paths(root) {
  const dir = path.join(root, DIR);
  return {
    dir,
    log: path.join(dir, 'log.jsonl'),
    brief: path.join(dir, 'brief.md'),
    archive: path.join(dir, 'archive'),
  };
}

/** slowfirst is opt-in per repo: it does nothing until `.slowfirst/` exists. */
export const isActive = (/** @type {string} */ root) => fs.existsSync(paths(root).dir);

/**
 * @typedef {{ t: string, type: string, [key: string]: any }} Event
 * @param {string} root
 * @returns {Event[]}
 */
export function readLog(root) {
  const file = paths(root).log;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

/**
 * @param {string} root
 * @param {{ type: string, [key: string]: any }} event
 * @param {Date} [now]
 */
export function append(root, event, now = new Date()) {
  const entry = { t: now.toISOString(), ...event };
  fs.appendFileSync(paths(root).log, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * @param {Event[]} events
 * @returns {{ phase: 'slow' | 'fast' | 'trivial', intent: string | null, since: string | null }}
 */
export function currentState(events) {
  /** @type {'slow' | 'fast' | 'trivial'} */
  let phase = 'slow';
  /** @type {string | null} */
  let intent = null;
  /** @type {string | null} */
  let since = null;
  for (const e of events) {
    if (e.type === 'init') since = e.t;
    if (e.type === 'intent') intent = e.text;
    if (e.type === 'phase') {
      phase = e.to;
      since = e.t;
    }
    if (e.type === 'done') {
      intent = null;
      phase = 'slow';
      since = e.t;
    }
  }
  return { phase, intent, since };
}

/** @param {string} root */
export function readBrief(root) {
  const file = paths(root).brief;
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** @param {string} root @param {string} text */
export function writeBrief(root, text) {
  fs.writeFileSync(paths(root).brief, text);
}
