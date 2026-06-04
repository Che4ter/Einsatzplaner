import { describe, it, expect } from 'vitest';
import { renderMonthNav } from '../render/nav.js';
import { renderStatisticsPage } from '../render/stats.js';
import { renderSettingsPage } from '../render/settings.js';
import { renderVerlaufPage, ACTION_GROUP } from '../render/verlauf.js';

const TEAM = [
  { id: 'a', name: 'Anna', color: '#0d9488', active: true },
  { id: 'b', name: 'Bert', color: '#2563eb', active: true },
];

const BASE_PLAN = {
  year: 2026,
  settings: { teamName: 'Test', locations: ['Halle'], defaultTimes: [], prepTimeHours: 0 },
  team: TEAM,
  months: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, { events: [] }])),
};

describe('renderMonthNav', () => {
  it('returns placeholder when plan is null', () => {
    expect(renderMonthNav(null, {}, 3, 'month')).toMatch(/Keine Datei/);
  });

  it('marks the active month', () => {
    const html = renderMonthNav({ year: 2026 }, {}, 3, 'month');
    expect(html).toMatch(/active/);
    expect((html.match(/data-action="nav-month"/g) ?? []).length).toBe(12);
  });

  it('shows event count from summaries', () => {
    const html = renderMonthNav({ year: 2026 }, { 3: { total: 5, issues: 0 } }, 3, 'month');
    expect(html).toMatch(/5/);
  });

  it('marks has-issue when issues > 0', () => {
    const html = renderMonthNav({ year: 2026 }, { 5: { total: 3, issues: 2 } }, 5, 'month');
    expect(html).toMatch(/has-issue/);
  });
});

describe('renderStatisticsPage', () => {
  const stats = { totalEvents: 10, coveragePct: 85, totalHours: 50, prepHours: 5, underCount: 2, totalNeed: 20, totalAssigned: 17, filledSlots: 17, vorOrtHours: 50 };

  it('renders without crashing', () => {
    const html = renderStatisticsPage(BASE_PLAN, stats, [], 0);
    expect(html).toMatch(/Statistiken/);
    expect(html).toMatch(/10/);
    expect(html).toMatch(/85%/);
  });

  it('highlights month filter chip as active', () => {
    const s = { totalEvents: 3, coveragePct: 100, totalHours: 10, prepHours: 0, underCount: 0, totalNeed: 6, totalAssigned: 6, filledSlots: 6, vorOrtHours: 10 };
    const html = renderStatisticsPage(BASE_PLAN, s, [], 5);
    expect((html.match(/month-chip on/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('renders person bars', () => {
    const s = { totalEvents: 2, coveragePct: 100, totalHours: 8, prepHours: 0, underCount: 0, totalNeed: 4, totalAssigned: 4, filledSlots: 4, vorOrtHours: 8 };
    const personStats = [
      { id: 'a', name: 'Anna', color: '#0d9488', active: true, total: 2, wkd: 1, wke: 1, hrs: 4, prepHrs: 0 },
    ];
    const html = renderStatisticsPage(BASE_PLAN, s, personStats, 0);
    expect(html).toMatch(/Anna/);
    expect(html).toMatch(/bar-seg/);
  });
});

describe('renderSettingsPage', () => {
  it('renders team name and year', () => {
    const html = renderSettingsPage(BASE_PLAN, false, true, 3000);
    expect(html).toMatch(/Test/);
    expect(html).toMatch(/2026/);
    expect(html).toMatch(/Einstellungen/);
  });

  it('shows autosave toggle when offline', () => {
    const html = renderSettingsPage(BASE_PLAN, false, true, 3000);
    expect(html).toMatch(/Automatisch speichern/);
    expect(html).toMatch(/checked/);
    expect(html).toMatch(/3 Sekunden/);
  });

  it('hides autosave toggle when online', () => {
    expect(renderSettingsPage(BASE_PLAN, true, true, 3000)).not.toMatch(/Automatisch speichern/);
  });

  it('lists team members', () => {
    const html = renderSettingsPage(BASE_PLAN, false, false, 3000);
    expect(html).toMatch(/Anna/);
    expect(html).toMatch(/Bert/);
  });
});

describe('renderVerlaufPage', () => {
  it('renders empty state when log is empty', () => {
    const html = renderVerlaufPage(BASE_PLAN, [], 'all');
    expect(html).toMatch(/Keine Aktivität/);
    expect(html).toMatch(/Verlauf/);
  });

  it('groups entries by day', () => {
    const log = [
      { id: '1', action: 'create', at: '2026-03-04T10:00:00', target: { date: '2026-03-04', month: 3, location: 'Halle', type: 'wednesday' } },
      { id: '2', action: 'assign', at: '2026-03-04T11:00:00', person: 'a', target: { date: '2026-03-04', month: 3, location: 'Halle' } },
      { id: '3', action: 'edit',   at: '2026-03-05T09:00:00', field: 'location', from: 'A', to: 'B' },
    ];
    const html = renderVerlaufPage(BASE_PLAN, log, 'all');
    expect((html.match(/act-day-head/g) ?? []).length).toBe(2);
  });

  it('filters by group', () => {
    const log = [
      { id: '1', action: 'create',  at: '2026-03-04T10:00:00' },
      { id: '2', action: 'assign',  at: '2026-03-04T11:00:00', person: 'a' },
    ];
    const htmlZuteilung = renderVerlaufPage(BASE_PLAN, log, 'zuteilung');
    const htmlTermin    = renderVerlaufPage(BASE_PLAN, log, 'termin');
    expect(htmlZuteilung).not.toBe(htmlTermin);
  });
});

describe('ACTION_GROUP', () => {
  it('maps all known actions', () => {
    const known = ['assign','unassign','swap','create','edit','delete','close','close-batch','reopen','note'];
    for (const action of known) {
      expect(ACTION_GROUP[action]).toBeTruthy();
    }
  });
});
