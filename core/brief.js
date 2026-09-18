// @ts-check
// The brief is the working document of the SLOW phase. The gate only checks its
// structure; whether the understanding behind it is real is what the teach-back is for.

const NO_INTENT = '(not set: the human types `sf intent ...`)';

/** @param {string | null} intent */
export function template(intent) {
  return `# slowfirst brief

## Intent
<!-- Set by the human with \`sf intent ...\` and copied here. Editing it here has no effect. -->
${intent ?? NO_INTENT}

## Beliefs
<!-- What must be true for the plan to work. One per line, tagged:
- [observed] <belief> (evidence: command and output, or file:line)
- [assumed] <belief> (check it before any code depends on it, cheapest check first)
- [refuted] <belief> (evidence: what showed it was false) -->

## Teach-back
<!-- The AI shows real code and asks the human to predict or explain it.
Record the questions, the human's answers, and where they were wrong. -->

## Steps
<!-- Small steps, each verified before the next starts. Estimate the whole task first;
work that runs past twice the estimate goes back to SLOW. A step that needs more than
200 lines can say so with (budget: 400).
Estimate: <n> lines
- [ ] <step> (verify: how) -->
`;
}

/** @param {string} md @param {string} intent */
export function withIntent(md, intent) {
  const body = md || template(null);
  if (!/^## Intent$/m.test(body)) return `## Intent\n${intent}\n\n${body}`;
  return body.replace(/(## Intent\n(?:<!--[\s\S]*?-->\n)?)[\s\S]*?(?=\n## |$)/, (_, head) => `${head}${intent}\n`);
}

/** @param {string} md @returns {Record<string, string[]>} */
function sections(md) {
  const clean = md.replace(/<!--[\s\S]*?-->/g, '');
  /** @type {Record<string, string[]>} */
  const out = {};
  let current = '';
  for (const line of clean.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      current = heading[1].toLowerCase();
      out[current] = [];
    } else if (current) {
      out[current].push(line);
    }
  }
  return out;
}

const bullets = (/** @type {string[] | undefined} */ lines) =>
  (lines ?? []).map((l) => l.trim()).filter((l) => /^[-*]\s+\S/.test(l));

const hasEvidence = (/** @type {string} */ belief) =>
  /evidence:\s*\S/i.test(belief) || /`[^`]+`/.test(belief) || /[\w./-]+:\d+/.test(belief);

/**
 * @typedef {{ label: string, detail: string }} Problem
 * @param {string | null} intent
 * @param {string} md
 * @returns {Problem[]}
 */
export function checkGate(intent, md) {
  /** @type {Problem[]} */
  const problems = [];
  const s = sections(md);
  const list = (/** @type {string[]} */ items) => items.map((b) => `      ${b}`).join('\n');

  if (!intent) {
    problems.push({
      label: 'intent',
      detail: "No intent. Type `sf intent <the problem, who uses the result and for what, how you'll know it's done>`.",
    });
  }

  const beliefs = bullets(s['beliefs']);
  if (beliefs.length === 0) {
    problems.push({ label: 'beliefs', detail: 'No beliefs recorded. What has to be true for the plan to work?' });
  }
  const untagged = beliefs.filter((b) => !/\[(observed|assumed|refuted)\]/i.test(b));
  if (untagged.length) {
    problems.push({
      label: 'untagged beliefs',
      detail: `Tag each belief [observed], [assumed] or [refuted]:\n${list(untagged)}`,
    });
  }
  const assumed = beliefs.filter((b) => /\[assumed\]/i.test(b));
  if (assumed.length) {
    problems.push({
      label: 'assumed beliefs',
      detail: `Still assumed. Check them before building on them:\n${list(assumed)}`,
    });
  }
  const unsupported = beliefs.filter((b) => /\[(observed|refuted)\]/i.test(b) && !hasEvidence(b));
  if (unsupported.length) {
    problems.push({
      label: 'evidence',
      detail: `No evidence given (a command and its output, or file:line):\n${list(unsupported)}`,
    });
  }

  if (!(s['teach-back'] ?? []).some((l) => l.trim())) {
    problems.push({
      label: 'teach-back',
      detail: 'No teach-back yet. Ask the AI to show you the code this change touches and quiz you on it.',
    });
  }

  if (!bullets(s['steps']).some((b) => /^[-*]\s+\[[ xX]\]/.test(b))) {
    problems.push({ label: 'steps', detail: 'No steps planned. Write them as `- [ ] <step> (verify: how)`.' });
  } else if (estimate(md) === null) {
    problems.push({
      label: 'estimate',
      detail: 'No estimate. Add `Estimate: <n> lines` for the whole task; work past twice that goes back to SLOW.',
    });
  }

  return problems;
}

/** The planned steps as written, and how many are ticked. @param {string} md */
export function steps(md) {
  const all = bullets(sections(md)['steps']).filter((b) => /^[-*]\s+\[[ xX]\]/.test(b));
  return { text: all.join('\n'), planned: all.length, done: all.filter((b) => /^[-*]\s+\[[xX]\]/.test(b)).length };
}

/** How the beliefs in the brief ended up. @param {string} md */
export function beliefs(md) {
  const all = bullets(sections(md)['beliefs']);
  const count = (/** @type {string} */ tag) => all.filter((b) => new RegExp(`\\[${tag}\\]`, 'i').test(b)).length;
  return { observed: count('observed'), assumed: count('assumed'), refuted: count('refuted') };
}

/** The human's estimate for the whole task, in lines. @param {string} md */
export function estimate(md) {
  const match = (sections(md)['steps'] ?? []).join('\n').match(/estimate:\s*~?(\d+)/i);
  return match ? Number(match[1]) : null;
}

/** The current step's own budget in lines, if it names one. @param {string} md @param {number} fallback */
export function stepBudget(md, fallback) {
  const match = (currentStep(md) ?? '').match(/\(budget:\s*(\d+)\s*(?:lines)?\)/i);
  return match ? Number(match[1]) : fallback;
}

/** @param {string} md */
export function currentStep(md) {
  for (const b of bullets(sections(md)['steps'])) {
    const open = b.match(/^[-*]\s+\[ \]\s+(.*)$/);
    if (open) return open[1];
  }
  return null;
}
