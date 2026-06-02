// Unit tests for the pure presentational components in render.js.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  renderEventCard, renderClosedCard, renderActivityEntry,
  fmtDayHeading, renderQAPopover,
} from '../render/index.js';

const TEAM = [
  { id: 'a', name: 'Anna',  color: '#0d9488', active: true },
  { id: 'b', name: 'Bert',  color: '#2563eb', active: true },
  { id: 'c', name: 'Cara',  color: '#9333ea', active: false },
];

test('renderEventCard tone is "ok" when fully staffed', () => {
  const ev = { id: 'e1', staffRequired: 2, assignedStaff: ['a', 'b'], location: 'Halle' };
  const html = renderEventCard(ev, TEAM, 3);
  assert.match(html, /class="ev-card ok"/);
  assert.match(html, /2\/2/);
  assert.match(html, /Halle/);
});

test('renderEventCard tone is "warn" when one short', () => {
  const ev = { id: 'e2', staffRequired: 2, assignedStaff: ['a'] };
  const html = renderEventCard(ev, TEAM, 3);
  assert.match(html, /class="ev-card warn"/);
  // one empty "+ frei" slot is rendered
  assert.match(html, /\+ frei/);
});

test('renderEventCard tone is "danger" when more than one short', () => {
  const ev = { id: 'e3', staffRequired: 3, assignedStaff: [] };
  const html = renderEventCard(ev, TEAM, 3);
  assert.match(html, /class="ev-card danger"/);
});

test('renderEventCard escapes location to prevent HTML injection', () => {
  const ev = { id: 'e4', staffRequired: 1, assignedStaff: [], location: '<script>x</script>' };
  const html = renderEventCard(ev, TEAM, 1);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('renderEventCard ignores unknown assigned ids', () => {
  const ev = { id: 'e5', staffRequired: 1, assignedStaff: ['ghost'] };
  const html = renderEventCard(ev, TEAM, 1);
  // unknown id produces no chip, but counts toward assigned length
  assert.match(html, /1\/1/);
});

test('renderClosedCard falls back comment -> location -> default', () => {
  assert.match(renderClosedCard({ id: 'x', comment: 'Ferien' }, 1), /Ferien/);
  assert.match(renderClosedCard({ id: 'x', location: 'Halle' }, 1), /Halle/);
  assert.match(renderClosedCard({ id: 'x' }, 1), /Geschlossen/);
});

test('renderActivityEntry renders an assign entry with person chip', () => {
  const teamById = Object.fromEntries(TEAM.map(m => [m.id, m]));
  const e = { action: 'assign', person: 'a', at: '2026-03-04T14:30:00',
              target: { date: '2026-03-04', month: 3, location: 'Halle' } };
  const html = renderActivityEntry(e, teamById, '2026-03-04');
  assert.match(html, /Anna/);
  assert.match(html, /eingeteilt/);
  assert.match(html, /14:30/);
});

test('renderActivityEntry renders an edit entry with from -> to', () => {
  const e = { action: 'edit', field: 'location', from: 'A', to: 'B', at: '2026-03-04T09:00:00' };
  const html = renderActivityEntry(e, {}, '2026-03-04');
  assert.match(html, /Ort/);
  assert.match(html, /act-from">A/);
  assert.match(html, /act-to">B/);
});

test('renderActivityEntry falls back to edit icon for unknown action', () => {
  const e = { action: 'totally-unknown', at: '2026-03-04T09:00:00' };
  const html = renderActivityEntry(e, {}, '2026-03-04');
  assert.match(html, /act-icon edit/);
});

test('fmtDayHeading labels Heute / Gestern / weekday / older', () => {
  assert.deepEqual(fmtDayHeading('2026-03-04', '2026-03-04'),
    { kicker: 'Heute', body: 'Mittwoch, 4. März', isToday: true });
  assert.equal(fmtDayHeading('2026-03-03', '2026-03-04').kicker, 'Gestern');
  // within the week (2 days ago) -> weekday name as kicker
  assert.equal(fmtDayHeading('2026-03-02', '2026-03-04').kicker, 'Montag');
  // older than a week -> no kicker, full date in body
  const old = fmtDayHeading('2026-02-20', '2026-03-04');
  assert.equal(old.kicker, null);
  assert.match(old.body, /20\. Februar/);
});

test('renderQAPopover lists only active members, sorted, marks assigned', () => {
  const html = renderQAPopover(TEAM, ['b'], 'e1', 3);
  // Cara is inactive -> excluded
  assert.doesNotMatch(html, /Cara/);
  // Anna before Bert (alphabetical)
  assert.ok(html.indexOf('Anna') < html.indexOf('Bert'));
  // Bert is assigned -> marked
  assert.match(html, /Bert[\s\S]*?zugeteilt/);
});
