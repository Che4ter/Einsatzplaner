import { describe, it, expect } from 'vitest';
import {
  renderEventCard, renderClosedCard, renderActivityEntry,
  fmtDayHeading, renderQAPopover,
} from '../render/index.js';

const TEAM = [
  { id: 'a', name: 'Anna',  color: '#0d9488', active: true },
  { id: 'b', name: 'Bert',  color: '#2563eb', active: true },
  { id: 'c', name: 'Cara',  color: '#9333ea', active: false },
];

describe('renderEventCard', () => {
  it('tone is "ok" when fully staffed', () => {
    const ev = { id: 'e1', staffRequired: 2, assignedStaff: ['a', 'b'], location: 'Halle' };
    const html = renderEventCard(ev, TEAM, 3);
    expect(html).toMatch(/class="ev-card ok"/);
    expect(html).toMatch(/2\/2/);
    expect(html).toMatch(/Halle/);
  });

  it('tone is "warn" when one short', () => {
    const ev = { id: 'e2', staffRequired: 2, assignedStaff: ['a'] };
    const html = renderEventCard(ev, TEAM, 3);
    expect(html).toMatch(/class="ev-card warn"/);
    expect(html).toMatch(/\+ frei/);
  });

  it('tone is "danger" when more than one short', () => {
    const ev = { id: 'e3', staffRequired: 3, assignedStaff: [] };
    const html = renderEventCard(ev, TEAM, 3);
    expect(html).toMatch(/class="ev-card danger"/);
  });

  it('escapes location to prevent HTML injection', () => {
    const ev = { id: 'e4', staffRequired: 1, assignedStaff: [], location: '<script>x</script>' };
    const html = renderEventCard(ev, TEAM, 1);
    expect(html).not.toMatch(/<script>x<\/script>/);
    expect(html).toMatch(/&lt;script&gt;/);
  });

  it('ignores unknown assigned ids', () => {
    const ev = { id: 'e5', staffRequired: 1, assignedStaff: ['ghost'] };
    const html = renderEventCard(ev, TEAM, 1);
    expect(html).toMatch(/1\/1/);
  });
});

describe('renderClosedCard', () => {
  it('falls back comment -> location -> default', () => {
    expect(renderClosedCard({ id: 'x', comment: 'Ferien' }, 1)).toMatch(/Ferien/);
    expect(renderClosedCard({ id: 'x', location: 'Halle' }, 1)).toMatch(/Halle/);
    expect(renderClosedCard({ id: 'x' }, 1)).toMatch(/Geschlossen/);
  });
});

describe('renderActivityEntry', () => {
  const teamById = Object.fromEntries(TEAM.map(m => [m.id, m]));

  it('renders an assign entry with person chip', () => {
    const e = { action: 'assign', person: 'a', at: '2026-03-04T14:30:00',
                target: { date: '2026-03-04', month: 3, location: 'Halle' } };
    const html = renderActivityEntry(e, teamById, '2026-03-04');
    expect(html).toMatch(/Anna/);
    expect(html).toMatch(/eingeteilt/);
    expect(html).toMatch(/14:30/);
  });

  it('renders an edit entry with from -> to', () => {
    const e = { action: 'edit', field: 'location', from: 'A', to: 'B', at: '2026-03-04T09:00:00' };
    const html = renderActivityEntry(e, {}, '2026-03-04');
    expect(html).toMatch(/Ort/);
    expect(html).toMatch(/act-from">A/);
    expect(html).toMatch(/act-to">B/);
  });

  it('falls back to edit icon for unknown action', () => {
    const e = { action: 'totally-unknown', at: '2026-03-04T09:00:00' };
    const html = renderActivityEntry(e, {}, '2026-03-04');
    expect(html).toMatch(/act-icon edit/);
  });
});

describe('fmtDayHeading', () => {
  it('labels Heute / Gestern / weekday / older', () => {
    expect(fmtDayHeading('2026-03-04', '2026-03-04')).toEqual(
      { kicker: 'Heute', body: 'Mittwoch, 4. März', isToday: true },
    );
    expect(fmtDayHeading('2026-03-03', '2026-03-04').kicker).toBe('Gestern');
    expect(fmtDayHeading('2026-03-02', '2026-03-04').kicker).toBe('Montag');
    const old = fmtDayHeading('2026-02-20', '2026-03-04');
    expect(old.kicker).toBeNull();
    expect(old.body).toMatch(/20\. Februar/);
  });
});

describe('renderQAPopover', () => {
  it('lists only active members, sorted, marks assigned', () => {
    const html = renderQAPopover(TEAM, ['b'], 'e1', 3);
    expect(html).not.toMatch(/Cara/);
    expect(html.indexOf('Anna')).toBeLessThan(html.indexOf('Bert'));
    expect(html).toMatch(/Bert[\s\S]*?zugeteilt/);
  });
});
