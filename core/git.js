// @ts-check
// Detects files changed through the shell. Edit tools can be blocked before they
// run; a shell command can write anywhere, so SLOW compares the repo before and after.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const SCOPE = ['--', '.', ':(exclude).slowfirst'];

/** @param {string} root @param {string[]} args */
function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * @typedef {{ head: string, files: string[], hash: string }} Snapshot
 * @param {string} root
 * @returns {Snapshot | null} null outside a git repo
 */
export function snapshot(root) {
  try {
    let head = '';
    try {
      head = git(root, ['rev-parse', 'HEAD']).trim();
    } catch {
      // no commits yet
    }
    const status = git(root, ['status', '--porcelain=v1', '-uall', ...SCOPE]);
    const diff = git(root, ['diff', '--no-ext-diff', '--no-color', ...SCOPE]);
    return {
      head,
      files: status.split('\n').filter(Boolean),
      hash: createHash('sha1').update(head).update('\0').update(status).update('\0').update(diff).digest('hex'),
    };
  } catch {
    return null;
  }
}

/**
 * Paths changed since `before`, including changes committed in the meantime.
 * @param {string} root
 * @param {Snapshot} before
 * @returns {string[]}
 */
export function changedSince(root, before) {
  const after = snapshot(root);
  if (!after || after.hash === before.hash) return [];
  const names = new Set();
  const was = new Set(before.files);
  const now = new Set(after.files);
  for (const line of [...after.files.filter((l) => !was.has(l)), ...before.files.filter((l) => !now.has(l))]) {
    names.add(line.slice(3));
  }
  if (before.head && after.head && before.head !== after.head) {
    try {
      for (const name of git(root, ['diff', '--name-only', before.head, after.head, ...SCOPE]).split('\n')) {
        if (name) names.add(name);
      }
    } catch {
      // history rewritten; the status comparison above still applies
    }
  }
  // Same status lines but different content: an already-modified file changed again.
  if (names.size === 0) for (const line of after.files) names.add(line.slice(3));
  return [...names];
}
