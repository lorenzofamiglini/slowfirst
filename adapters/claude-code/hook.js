#!/usr/bin/env node
// @ts-check
// Entry point for every Claude Code hook: JSON in on stdin, JSON out on stdout.
// It must never break the session, so any internal error lets the call through
// and is reported on stderr.

import { readFileSync } from 'node:fs';
import { findRoot } from '../../core/store.js';
import { handle } from './adapter.js';

try {
  const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const root = findRoot(process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd());
  const out = handle(input, root);
  if (out) process.stdout.write(JSON.stringify(out));
} catch (error) {
  process.stderr.write(`slowfirst: ${error instanceof Error ? error.message : String(error)}\n`);
}
