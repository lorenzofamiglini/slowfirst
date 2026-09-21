// @ts-check
// Shared entry point for harnesses whose hooks speak JSON over stdin/stdout.
// A hook must never break the session, so any internal error lets the call
// through and is reported on stderr.

import { readSync } from 'node:fs';
import { findRoot } from '../core/store.js';

/**
 * Read all of stdin. `readFileSync(0)` is not enough: on Windows a pipe raises
 * EOF, and a non-blocking pipe raises EAGAIN, and either one would leave the hook
 * silent — which reads as "no opinion" and quietly opens every gate.
 * @returns {string}
 */
function readStdin() {
  const chunks = [];
  const buffer = Buffer.alloc(65536);
  for (;;) {
    let read = 0;
    try {
      read = readSync(0, buffer, 0, buffer.length, null);
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'EAGAIN') continue; // stdin not ready yet
      if (code === 'EOF' || code === 'EPIPE') break;
      throw error;
    }
    if (read === 0) break;
    chunks.push(Buffer.from(buffer.subarray(0, read)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * @param {(input: Record<string, any>, root: string) => Record<string, any> | null} handle
 * @param {string} [rootEnv] environment variable holding the project directory, if the harness sets one
 */
export function runHook(handle, rootEnv) {
  try {
    const input = JSON.parse(readStdin() || '{}');
    const start = (rootEnv && process.env[rootEnv]) || input.cwd || process.cwd();
    const out = handle(input, findRoot(start));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (error) {
    process.stderr.write(`slowfirst: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}
