#!/usr/bin/env node
// Entry point for every Codex CLI hook.
import { runHook } from '../run-hook.js';
import { handle } from './adapter.js';

runHook(handle);
