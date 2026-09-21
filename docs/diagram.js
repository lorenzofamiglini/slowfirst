// Generates the README diagram in a light and a dark variant: node docs/diagram.js
// GitHub shows images in isolation, so each variant carries its own colours.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const themes = {
  light: {
    ink: '#0b0b0b', ink2: '#52514e', line: '#c3c2b7', box: '#ffffff',
    slow: '#2a78d6', fast: '#0ca30c', back: '#d03b3b',
  },
  dark: {
    ink: '#f0f0ee', ink2: '#c3c2b7', line: '#4a4a46', box: '#161b22',
    slow: '#3987e5', fast: '#0ca30c', back: '#e66767',
  },
};

const SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

function drawing(c) {
  const text = (x, y, s, { size = 13, weight = 400, fill = c.ink, anchor = 'middle', font = SANS } = {}) =>
    `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${s}</text>`;
  const box = (x, title, sub, subFont = SANS) => `
    <rect x="${x}" y="140" width="104" height="66" rx="8" fill="${c.box}" stroke="${c.line}"/>
    ${text(x + 52, 169, title, { weight: 600 })}
    ${text(x + 52, 188, sub, { size: 11, fill: c.ink2, font: subFont })}`;
  const hop = (x1, x2) => `<line x1="${x1}" y1="173" x2="${x2 - 2}" y2="173" stroke="${c.ink2}" stroke-width="1.5" marker-end="url(#ink)"/>`;

  return `<defs>
    <marker id="ink" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${c.ink2}"/></marker>
    <marker id="back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="${c.back}"/></marker>
  </defs>

  <!-- override: the one sanctioned way round the gate -->
  <path d="M260 90 V44 H760 V88" fill="none" stroke="${c.ink2}" stroke-width="1.5" stroke-dasharray="5 5" marker-end="url(#ink)"/>
  ${text(510, 34, 'sf override', { size: 12, font: MONO, anchor: 'end', fill: c.ink })}
  ${text(518, 34, 'skips the gate, and is logged', { size: 12, fill: c.ink2, anchor: 'start' })}

  <!-- SLOW -->
  <rect x="20" y="90" width="480" height="140" rx="14" fill="${c.slow}" fill-opacity="0.07" stroke="${c.slow}" stroke-width="1.5"/>
  <rect x="38" y="109" width="12" height="9" rx="2" fill="${c.slow}"/>
  <path d="M40.5 109 v-3 a3.5 3.5 0 0 1 7 0 v3" fill="none" stroke="${c.slow}" stroke-width="1.8"/>
  ${text(58, 118, 'SLOW', { size: 15, weight: 700, anchor: 'start', fill: c.slow })}
  ${text(114, 118, 'code edits locked', { size: 13, anchor: 'start', fill: c.ink2 })}
  ${box(36, 'Intent', 'in your words')}
  ${hop(140, 156)}
  ${box(156, 'Beliefs', 'checked first')}
  ${hop(260, 276)}
  ${box(276, 'Teach-back', 'you explain it')}
  ${hop(380, 396)}
  ${box(396, 'Steps', '+ an estimate')}

  <!-- gate -->
  <line x1="500" y1="173" x2="556" y2="173" stroke="${c.ink2}" stroke-width="1.5" marker-end="url(#ink)"/>
  <rect x="524" y="96" width="8" height="128" rx="4" fill="${c.ink}"/>
  ${text(528, 248, 'sf fast', { size: 12, font: MONO })}
  ${text(528, 264, 'checks the brief', { size: 11, fill: c.ink2 })}

  <!-- FAST -->
  <rect x="560" y="90" width="380" height="140" rx="14" fill="${c.fast}" fill-opacity="0.07" stroke="${c.fast}" stroke-width="1.5"/>
  ${text(578, 118, 'FAST', { size: 15, weight: 700, anchor: 'start', fill: c.fast })}
  ${text(630, 118, 'one step at a time', { size: 13, anchor: 'start', fill: c.ink2 })}
  ${box(576, 'step 1', 'verified ✓')}
  ${hop(680, 696)}
  ${box(696, 'step 2', 'verified ✓')}
  ${hop(800, 816)}
  ${box(816, 'step n', 'sf done', MONO)}

  <!-- the way back -->
  <path d="M750 230 V292 H260 V234" fill="none" stroke="${c.back}" stroke-width="2" stroke-dasharray="7 5" marker-end="url(#back)"/>
  ${text(505, 318, 'past 2× your estimate, or a surprise: back to SLOW', { size: 12, fill: c.ink2 })}`;
}

const LABEL = 'Code edits stay locked in SLOW until the brief passes the gate; FAST then runs in verified steps, and overrunning the estimate or hitting a surprise sends you back to SLOW. An override can skip the gate, and is logged.';

const readme = (c) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 336" role="img" aria-label="${LABEL}">${drawing(c)}</svg>\n`;

// A square card for social posts: headline, the same drawing, the address.
const card = (c) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1200" role="img" aria-label="${LABEL}">
  <rect width="1200" height="1200" fill="#ffffff"/>
  <text x="80" y="150" font-family="${MONO}" font-size="30" fill="${c.slow}">slowfirst</text>
  <text font-family="${SANS}" font-size="64" font-weight="700" fill="${c.ink}">
    <tspan x="80" y="250">Pair programming with an AI</tspan>
    <tspan x="80" y="330">that won't let you skip</tspan>
    <tspan x="80" y="410">the understanding.</tspan>
  </text>
  <svg x="40" y="500" width="1120" height="392" viewBox="0 0 960 336">${drawing(c)}</svg>
  <text x="80" y="1000" font-family="${SANS}" font-size="28" fill="${c.ink2}">Open source. Claude Code today; Codex and Gemini adapters want testers.</text>
  <text x="80" y="1090" font-family="${MONO}" font-size="30" fill="${c.ink}">github.com/lorenzofamiglini/slowfirst</text>
</svg>
`;

const dir = path.dirname(fileURLToPath(import.meta.url));
for (const [name, colours] of Object.entries(themes)) {
  fs.writeFileSync(path.join(dir, `slowfirst-${name}.svg`), readme(colours));
}
fs.writeFileSync(path.join(dir, 'slowfirst-card.svg'), card(themes.light));
console.log('wrote docs/slowfirst-light.svg, docs/slowfirst-dark.svg and docs/slowfirst-card.svg');
