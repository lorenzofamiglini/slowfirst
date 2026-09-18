// @ts-check
// Shared entry point for harnesses whose hooks speak JSON over stdin/stdout.
// A hook must never break the session, so any internal error lets the call
// through and is reported on stderr.

import { readFileSync } from 'node:fs';
import { findRoot } from '../core/store.js';

/**
 * @param {(input: Record<string, any>, root: string) => Record<string, any> | null} handle
 * @param {string} [rootEnv] environment variable holding the project directory, if the harness sets one
 */
export function runHook(handle, rootEnv) {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
    const start = (rootEnv && process.env[rootEnv]) || input.cwd || process.cwd();
    const out = handle(input, findRoot(start));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (error) {
    process.stderr.write(`slowfirst: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
