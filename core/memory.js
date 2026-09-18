// @ts-check
// Personal memory: one record per finished task, across every repo you work in.
// It holds numbers and labels only — never your prompts, and never your code.
// Later versions compare a running task against these records; 0.2 only collects them.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const LABELS = {
  ok: 'went as expected',
  drift: 'drifted from the intent',
  waste: 'wasted time',
};

/** Set SLOWFIRST_HOME to move the memory (tests do). */
export const home = () => process.env.SLOWFIRST_HOME || path.join(os.homedir(), '.slowfirst');

const file = () => path.join(home(), 'episodes.jsonl');

/**
 * @typedef {{ t: string, repo: string, label: keyof typeof LABELS, signals: Record<string, number> }} Episode
 * @param {Episode} episode
 */
export function remember(episode) {
  fs.mkdirSync(home(), { recursive: true });
  fs.appendFileSync(file(), JSON.stringify(episode) + '\n');
}

/** @returns {Episode[]} */
export function episodes() {
  if (!fs.existsSync(file())) return [];
  return fs
    .readFileSync(file(), 'utf8')
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
