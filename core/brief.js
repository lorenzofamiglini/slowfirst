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
<!-- Small steps, each verified before the next starts:
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
  }

  return problems;
}

/** @param {string} md */
export function currentStep(md) {
  for (const b of bullets(sections(md)['steps'])) {
    const open = b.match(/^[-*]\s+\[ \]\s+(.*)$/);
    if (open) return open[1];
  }
  return null;
}
