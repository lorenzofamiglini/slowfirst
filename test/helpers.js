import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Never let a test write to the developer's real personal memory.
process.env.SLOWFIRST_HOME ??= fs.mkdtempSync(path.join(os.tmpdir(), 'slowfirst-home-'));

/** A throwaway git repo with one committed file, src/app.js. */
export function makeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'slowfirst-')));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.js'), 'export const x = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'init');
  return root;
}

export const completeBrief = (intent) => `# slowfirst brief

## Intent
${intent}

## Beliefs
- [observed] x is read by main.js (evidence: src/main.js:3)
- [refuted] x is cached somewhere (evidence: \`grep -r cache src\` finds nothing)

## Teach-back
Q: what does src/app.js export? A: x = 1. Correct.

## Steps
- [ ] change x to 2 (verify: node -e "import('./src/app.js')")
- [ ] update the caller
`;

export const writeBrief = (root, text) => fs.writeFileSync(path.join(root, '.slowfirst', 'brief.md'), text);
