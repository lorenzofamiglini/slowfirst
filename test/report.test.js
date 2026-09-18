import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, renderReport } from '../core/report.js';
import './helpers.js'; // keeps the personal memory in a temp directory

const NOW = new Date('2026-09-18T12:00:00Z');

/** @param {string} label @param {number} daysAgo @param {Record<string, number>} signals */
const episode = (label, daysAgo, signals = {}) => ({
  t: new Date(NOW.getTime() - daysAgo * 86400000).toISOString(),
  repo: 'demo',
  label,
  signals: { minutes: 60, added: 40, removed: 10, undeclaredFiles: 0, slowMinutes: 20, ...signals },
});

test('an empty memory produces a page that says so, not a page of zeros', () => {
  const data = buildReport([], NOW);
  assert.equal(data.empty, true);
  assert.match(renderReport(data), /No finished tasks yet/);
});

test('hours are grouped into weeks by outcome', () => {
  const data = buildReport([episode('ok', 1), episode('waste', 2, { minutes: 120 }), episode('ok', 30)], NOW);
  const thisWeek = data.weeks.at(-1);
  assert.equal(thisWeek.ok, 1);
  assert.equal(thisWeek.waste, 2);
  assert.equal(data.totals.tasks, 3);
  assert.equal(data.totals.wasteHours, 2);
});

test('the estimate stays hidden until there is enough of your own history', () => {
  const thin = buildReport([episode('waste', 1, { budgetStops: 1 })], NOW);
  assert.equal(thin.estimate, null);
  assert.match(renderReport(thin), /Not enough history yet/);

  const enough = buildReport(
    [
      episode('waste', 1, { minutes: 180 }),
      episode('waste', 2, { minutes: 180 }),
      episode('waste', 3, { minutes: 180 }),
      episode('ok', 4, { budgetStops: 1, backToSlow: 1 }),
    ],
    NOW,
  );
  // 2 stops x 50% x 3h median wasted task
  assert.equal(enough.estimate.avoided, 3);
  assert.match(renderReport(enough), /estimate, not a measurement/);
});

test('what the gates cost and what they caught are counted separately', () => {
  const data = buildReport(
    [
      episode('ok', 1, { overrides: 1, gateFailed: 2, beliefsRefuted: 1, undeclaredFiles: 3 }),
      episode('drift', 2, { backToSlow: 1, intentChanges: 1 }),
    ],
    NOW,
  );
  assert.deepEqual(data.cost, { medianSlow: 20, medianTask: 60, overrides: 1, gateFailed: 2 });
  assert.deepEqual(data.caught, { refuted: 1, stops: 1, undeclared: 3, intentChanges: 1 });
});

test('the page renders as one self-contained file with no network calls', () => {
  const html = renderReport(buildReport([episode('ok', 1), episode('drift', 3)], NOW));
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script|https?:\/\//, 'no scripts, no external requests');
  assert.match(html, /prefers-color-scheme: dark/);
});
