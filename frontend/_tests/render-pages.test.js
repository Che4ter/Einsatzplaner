// Tests for the page-level render functions in render/
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { renderMonthNav } from '../render/nav.js';
import { renderStatisticsPage } from '../render/stats.js';
import { renderSettingsPage } from '../render/settings.js';
import { renderVerlaufPage, ACTION_GROUP } from '../render/verlauf.js';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const TEAM = [
  { id: 'a', name: 'Anna', color: '#0d9488', active: true },
  { id: 'b', name: 'Bert', color: '#2563eb', active: true },
];

const BASE_PLAN = {
  year: 2026,
  settings: { teamName: 'Test', locations: ['Halle'], defaultTimes: [], prepTimeHours: 0 },
  team: TEAM,
  months: Object.fromEntries(Array.from({length:12},(_,i)=>[i+1,{events:[]}])),
};

// ── renderMonthNav ────────────────────────────────────────────────────────────

test('renderMonthNav returns placeholder when plan is null', () => {
  const html = renderMonthNav(null, {}, 3, 'month');
  assert.match(html, /Keine Datei/);
});

test('renderMonthNav marks the active month', () => {
  const html = renderMonthNav({ year: 2026 }, {}, 3, 'month');
  assert.match(html, /active/);
  // 12 month buttons
  assert.ok((html.match(/data-action="nav-month"/g) ?? []).length === 12);
});

test('renderMonthNav shows event count from summaries', () => {
  const summaries = { 3: { total: 5, issues: 0 } };
  const html = renderMonthNav({ year: 2026 }, summaries, 3, 'month');
  assert.match(html, /5/);
});

test('renderMonthNav marks has-issue when issues > 0', () => {
  const summaries = { 5: { total: 3, issues: 2 } };
  const html = renderMonthNav({ year: 2026 }, summaries, 5, 'month');
  assert.match(html, /has-issue/);
});

// ── renderStatisticsPage ──────────────────────────────────────────────────────

test('renderStatisticsPage renders without crashing', () => {
  const stats = { totalEvents: 10, coveragePct: 85, totalHours: 50, prepHours: 5, underCount: 2, totalNeed: 20, totalAssigned: 17, filledSlots: 17, vorOrtHours: 50 };
  const html = renderStatisticsPage(BASE_PLAN, stats, [], 0);
  assert.match(html, /Statistiken/);
  assert.match(html, /10/);
  assert.match(html, /85%/);
});

test('renderStatisticsPage highlights month filter chip as active', () => {
  const stats = { totalEvents: 3, coveragePct: 100, totalHours: 10, prepHours: 0, underCount: 0, totalNeed: 6, totalAssigned: 6, filledSlots: 6, vorOrtHours: 10 };
  const html = renderStatisticsPage(BASE_PLAN, stats, [], 5);
  // May (index 4) chip is on
  const onChips = html.match(/month-chip on/g) ?? [];
  assert.ok(onChips.length >= 1);
});

test('renderStatisticsPage renders person bars', () => {
  const stats = { totalEvents: 2, coveragePct: 100, totalHours: 8, prepHours: 0, underCount: 0, totalNeed: 4, totalAssigned: 4, filledSlots: 4, vorOrtHours: 8 };
  const personStats = [
    { id: 'a', name: 'Anna', color: '#0d9488', active: true, total: 2, wkd: 1, wke: 1, hrs: 4, prepHrs: 0 },
  ];
  const html = renderStatisticsPage(BASE_PLAN, stats, personStats, 0);
  assert.match(html, /Anna/);
  assert.match(html, /bar-seg/);
});

// ── renderSettingsPage ────────────────────────────────────────────────────────

test('renderSettingsPage renders team name and year', () => {
  const html = renderSettingsPage(BASE_PLAN, false, true, 3000);
  assert.match(html, /Test/);
  assert.match(html, /2026/);
  assert.match(html, /Einstellungen/);
});

test('renderSettingsPage shows autosave toggle when offline', () => {
  const html = renderSettingsPage(BASE_PLAN, false, true, 3000);
  assert.match(html, /Automatisch speichern/);
  assert.match(html, /checked/);
  assert.match(html, /3 Sekunden/);
});

test('renderSettingsPage hides autosave toggle when online', () => {
  const html = renderSettingsPage(BASE_PLAN, true, true, 3000);
  assert.doesNotMatch(html, /Automatisch speichern/);
});

test('renderSettingsPage lists team members', () => {
  const html = renderSettingsPage(BASE_PLAN, false, false, 3000);
  assert.match(html, /Anna/);
  assert.match(html, /Bert/);
});

// ── renderVerlaufPage ─────────────────────────────────────────────────────────

test('renderVerlaufPage renders empty state when log is empty', () => {
  const html = renderVerlaufPage(BASE_PLAN, [], 'all');
  assert.match(html, /Keine Aktivität/);
  assert.match(html, /Verlauf/);
});

test('renderVerlaufPage groups entries by day', () => {
  const log = [
    { id: '1', action: 'create', at: '2026-03-04T10:00:00', target: { date: '2026-03-04', month: 3, location: 'Halle', type: 'wednesday' } },
    { id: '2', action: 'assign', at: '2026-03-04T11:00:00', person: 'a', target: { date: '2026-03-04', month: 3, location: 'Halle' } },
    { id: '3', action: 'edit',   at: '2026-03-05T09:00:00', field: 'location', from: 'A', to: 'B' },
  ];
  const html = renderVerlaufPage(BASE_PLAN, log, 'all');
  assert.ok((html.match(/act-day-head/g) ?? []).length === 2, 'should have 2 day blocks');
});

test('renderVerlaufPage filters by group', () => {
  const log = [
    { id: '1', action: 'create',  at: '2026-03-04T10:00:00' },
    { id: '2', action: 'assign',  at: '2026-03-04T11:00:00', person: 'a' },
  ];
  const htmlZuteilung = renderVerlaufPage(BASE_PLAN, log, 'zuteilung');
  const htmlTermin    = renderVerlaufPage(BASE_PLAN, log, 'termin');
  // assign is in zuteilung, create is in termin — filters should differ
  assert.notEqual(htmlZuteilung, htmlTermin);
});

test('ACTION_GROUP maps all known actions', () => {
  const known = ['assign','unassign','swap','create','edit','delete','close','close-batch','reopen','note'];
  for (const action of known) {
    assert.ok(ACTION_GROUP[action], `ACTION_GROUP missing: ${action}`);
  }
});
