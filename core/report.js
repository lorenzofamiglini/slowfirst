// @ts-check
// A small local dashboard built from your personal memory.
//
// It separates three things on purpose:
//   measured   — hours and counts straight from your own logs
//   caught     — moments where drift was stopped instead of followed
//   estimated  — one number with its assumption written next to it
// There is no "time saved" figure. Nobody can measure the hours a task would have
// burned if it had kept going, and a made-up number would be the first thing a
// sceptical colleague pulls apart.

const WEEKS = 8;
const ASSUMED_SHARE = 0.5; // share of stopped tasks assumed to have become waste

/** @typedef {import('./memory.js').Episode} Episode */

const hours = (/** @type {number} */ minutes) => Math.round((minutes / 60) * 10) / 10;
const median = (/** @type {number[]} */ xs) =>
  xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0;
const sum = (/** @type {number[]} */ xs) => xs.reduce((a, b) => a + b, 0);

/** Monday 00:00 of the week containing `date`. @param {Date} date */
function weekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

/**
 * @param {Episode[]} episodes
 * @param {Date} [now]
 */
export function buildReport(episodes, now = new Date()) {
  const signal = (/** @type {Episode} */ e, /** @type {string} */ key) => Number(e.signals?.[key] ?? 0);
  const of = (/** @type {string} */ label) => episodes.filter((e) => e.label === label);
  const minutesOf = (/** @type {Episode[]} */ list) => sum(list.map((e) => signal(e, 'minutes')));

  const weeks = [];
  for (let i = WEEKS - 1; i >= 0; i--) {
    const start = weekStart(new Date(now.getTime() - i * 7 * 86400000));
    const end = new Date(start.getTime() + 7 * 86400000);
    const inWeek = episodes.filter((e) => {
      const t = Date.parse(e.t);
      return t >= start.getTime() && t < end.getTime();
    });
    weeks.push({
      label: start.toISOString().slice(5, 10).split('-').reverse().join('/'),
      ok: hours(minutesOf(inWeek.filter((e) => e.label === 'ok'))),
      drift: hours(minutesOf(inWeek.filter((e) => e.label === 'drift'))),
      waste: hours(minutesOf(inWeek.filter((e) => e.label === 'waste'))),
    });
  }

  const stops = sum(episodes.map((e) => signal(e, 'budgetStops') + signal(e, 'backToSlow')));
  const wasteHours = hours(minutesOf(of('waste')));
  const medianWaste = hours(median(of('waste').map((e) => signal(e, 'minutes'))));

  return {
    generated: now.toISOString(),
    empty: episodes.length === 0,
    totals: {
      tasks: episodes.length,
      hours: hours(minutesOf(episodes)),
      ok: of('ok').length,
      drift: of('drift').length,
      waste: of('waste').length,
      wasteHours,
      driftHours: hours(minutesOf(of('drift'))),
    },
    weeks,
    cost: {
      medianSlow: median(episodes.map((e) => signal(e, 'slowMinutes'))),
      medianTask: median(episodes.map((e) => signal(e, 'minutes'))),
      overrides: sum(episodes.map((e) => signal(e, 'overrides'))),
      gateFailed: sum(episodes.map((e) => signal(e, 'gateFailed'))),
    },
    caught: {
      refuted: sum(episodes.map((e) => signal(e, 'beliefsRefuted'))),
      stops,
      undeclared: sum(episodes.map((e) => signal(e, 'undeclaredFiles'))),
      intentChanges: sum(episodes.map((e) => signal(e, 'intentChanges'))),
    },
    // The one estimate on the page. Shown only once there is enough of your own
    // history for the multiplier to mean anything.
    estimate:
      of('waste').length >= 3 && stops > 0
        ? { stops, medianWaste, share: ASSUMED_SHARE, avoided: Math.round(stops * ASSUMED_SHARE * medianWaste * 10) / 10 }
        : null,
    recent: episodes
      .slice(-12)
      .reverse()
      .map((e) => ({
        date: e.t.slice(0, 10),
        repo: e.repo,
        label: e.label,
        minutes: signal(e, 'minutes'),
        lines: signal(e, 'added') + signal(e, 'removed'),
        undeclared: signal(e, 'undeclaredFiles'),
      })),
  };
}

const LABELS = {
  ok: { name: 'went as expected', icon: '●', light: '#0ca30c' },
  drift: { name: 'drifted', icon: '▲', light: '#fab219' },
  waste: { name: 'wasted time', icon: '■', light: '#d03b3b' },
};

const escape = (/** @type {string} */ s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** @param {ReturnType<typeof buildReport>} d */
function weeklyChart(d) {
  const peak = Math.max(1, ...d.weeks.map((w) => w.ok + w.drift + w.waste));
  const [w, h, pad] = [640, 200, 28];
  const band = (w - pad) / d.weeks.length;
  const bars = d.weeks
    .map((week, i) => {
      const x = pad + i * band + band * 0.2;
      const width = band * 0.6;
      let y = h - 20;
      const segments = /** @type {const} */ (['waste', 'drift', 'ok']).map((key) => {
        const value = week[key];
        if (!value) return '';
        const height = Math.max(2, ((h - 40) * value) / peak) - 2; // 2px surface gap
        y -= height + 2;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" rx="3" fill="var(--${key})"><title>week of ${week.label}: ${value}h ${LABELS[key].name}</title></rect>`;
      });
      return `${segments.join('')}<text class="tick" x="${(x + width / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle">${week.label}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Hours per week by outcome">
    <line class="axis" x1="${pad}" y1="${h - 20}" x2="${w}" y2="${h - 20}" />
    <text class="tick" x="0" y="16">${peak}h</text>
    <text class="tick" x="0" y="${h - 24}">0</text>
    ${bars}
  </svg>`;
}

/** @param {ReturnType<typeof buildReport>} d */
export function renderReport(d) {
  const tile = (/** @type {string} */ value, /** @type {string} */ label, /** @type {string} */ note = '') =>
    `<div class="tile"><div class="value">${escape(value)}</div><div class="label">${escape(label)}</div>${note ? `<div class="note">${escape(note)}</div>` : ''}</div>`;

  const body = d.empty
    ? `<p class="empty">No finished tasks yet. Close one with <code>sf done ok|drift|waste</code> and this page fills in.</p>`
    : `
    <section class="tiles">
      ${tile(`${d.totals.hours}h`, 'tracked across tasks', `${d.totals.tasks} closed`)}
      ${tile(`${Math.round((d.totals.wasteHours + d.totals.driftHours) * 10) / 10}h`, 'in tasks you called drift or waste', 'the number to drive down')}
      ${tile(`${d.cost.medianSlow} min`, 'median time in SLOW per task', 'what the gate costs you')}
      ${tile(String(d.caught.refuted + d.caught.stops), 'beliefs refuted and work stopped', 'drift caught, not followed')}
    </section>

    <section class="card">
      <h2>Hours per week, by how the task ended</h2>
      <div class="legend">${Object.entries(LABELS)
        .map(([key, l]) => `<span class="key"><span class="swatch" style="color:var(--${key})">${l.icon}</span>${l.name}</span>`)
        .join('')}</div>
      ${weeklyChart(d)}
      <p class="foot">Measured from your own logs. Labels are the word you typed at <code>sf done</code>.</p>
    </section>

    <section class="two">
      <div class="card">
        <h2>What the gates cost</h2>
        <dl>
          <dt>Median time in SLOW</dt><dd>${d.cost.medianSlow} min per task</dd>
          <dt>Median task length</dt><dd>${d.cost.medianTask} min</dd>
          <dt>Gate attempts that failed</dt><dd>${d.cost.gateFailed}</dd>
          <dt>Overrides</dt><dd>${d.cost.overrides}</dd>
        </dl>
        <p class="foot">Overrides on one gate, again and again, mean the gate is wrong. Fix the gate.</p>
      </div>
      <div class="card">
        <h2>What they caught</h2>
        <dl>
          <dt>Beliefs checked and found false</dt><dd>${d.caught.refuted}</dd>
          <dt>Times work was stopped or sent back</dt><dd>${d.caught.stops}</dd>
          <dt>Files touched that no step named</dt><dd>${d.caught.undeclared}</dd>
          <dt>Intent changed mid-task</dt><dd>${d.caught.intentChanges}</dd>
        </dl>
        <p class="foot">Each of these is a moment the work could have carried on in the wrong direction.</p>
      </div>
    </section>

    <section class="card estimate">
      <h2>Rework avoided <span class="tag">estimate, not a measurement</span></h2>
      ${
        d.estimate
          ? `<p><strong>${d.estimate.avoided}h</strong>, on this assumption: work was stopped or sent back ${d.estimate.stops} times ×
             ${d.estimate.share * 100}% of those assumed to have ended as waste × ${d.estimate.medianWaste}h, your own median wasted task.</p>
             <p class="foot">Change the share and the number changes. It is a scale, not a fact: nobody can measure the hours a task would have burned had it continued.</p>`
          : `<p class="foot">Not enough history yet. This needs at least three tasks labelled <code>waste</code>, so the multiplier comes from your work rather than from thin air.</p>`
      }
    </section>

    <section class="card">
      <h2>Recent tasks</h2>
      <div class="scroll"><table>
        <thead><tr><th>date</th><th>repo</th><th>outcome</th><th>minutes</th><th>lines</th><th>off-plan files</th></tr></thead>
        <tbody>${d.recent
          .map(
            (r) =>
              `<tr><td>${escape(r.date)}</td><td>${escape(r.repo)}</td><td><span class="swatch" style="color:var(--${r.label})">${LABELS[r.label]?.icon ?? ''}</span> ${escape(LABELS[r.label]?.name ?? r.label)}</td><td class="num">${r.minutes}</td><td class="num">${r.lines}</td><td class="num">${r.undeclared}</td></tr>`,
          )
          .join('')}</tbody>
      </table></div>
    </section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>slowfirst</title>
<style>
  :root {
    color-scheme: light;
    --plane: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --line: #e1e0d9; --axis: #c3c2b7; --border: rgba(11,11,11,0.10);
    --ok: #0ca30c; --drift: #fab219; --waste: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --plane: #0d0d0d; --surface: #1a1a19; --ink: #fff; --ink-2: #c3c2b7; --muted: #898781;
      --line: #2c2c2a; --axis: #383835; --border: rgba(255,255,255,0.10);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px 64px; background: var(--plane); color: var(--ink);
         font: 15px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 860px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
  .sub { color: var(--ink-2); margin: 0 0 24px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .tile .value { font-size: 26px; font-weight: 600; }
  .tile .label { color: var(--ink-2); font-size: 13px; margin-top: 2px; }
  .tile .note { color: var(--muted); font-size: 12px; margin-top: 6px; }
  .two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
  .two .card { margin-bottom: 0; }
  svg { width: 100%; height: auto; display: block; }
  .tick { fill: var(--muted); font-size: 10px; }
  .axis { stroke: var(--axis); stroke-width: 1; }
  .legend { display: flex; gap: 16px; flex-wrap: wrap; color: var(--ink-2); font-size: 13px; margin-bottom: 8px; }
  .swatch { font-size: 12px; }
  .key { display: inline-flex; gap: 6px; align-items: center; }
  dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 0; }
  dt { color: var(--ink-2); } dd { margin: 0; font-variant-numeric: tabular-nums; }
  .scroll { overflow-x: auto; }
  table { width: 100%; min-width: 480px; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--line); padding: 6px 8px 6px 0; }
  td { padding: 6px 8px 6px 0; border-bottom: 1px solid var(--line); }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .foot { color: var(--muted); font-size: 12px; margin: 12px 0 0; }
  .tag { font-size: 11px; font-weight: 500; color: var(--ink-2); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; margin-left: 6px; }
  .estimate strong { font-size: 20px; }
  .empty { color: var(--ink-2); }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; }
</style></head>
<body><main>
  <h1>slowfirst</h1>
  <p class="sub">Your own tasks, as you labelled them. Everything here is local: nothing was sent anywhere.</p>
  ${body}
  <p class="foot">Generated ${escape(d.generated.slice(0, 16).replace('T', ' '))} from your personal memory.</p>
</main></body></html>`;
}
