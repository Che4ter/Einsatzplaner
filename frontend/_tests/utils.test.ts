import { describe, it, expect } from 'vitest';
import {
  esc, escNl, getMonth, formatDate, weekNumber, localIso,
  isoToDisplay, displayToIso, getWednesdays, paginateByHeight,
  MONATE, MONATE_SHORT, WEEKDAY_SHORT, WEEKDAY_LONG, TEAM_COLORS,
} from '../utils.js';

describe('esc', () => {
  it('escapes HTML-significant characters', () => {
    expect(esc('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
    expect(esc(0)).toBe('0');
  });
});

describe('escNl', () => {
  it('escapes then converts newlines to <br>', () => {
    expect(escNl('a\nb')).toBe('a<br>b');
    expect(escNl('<x>\n<y>')).toBe('&lt;x&gt;<br>&lt;y&gt;');
  });
});

describe('getMonth', () => {
  it('resolves numeric and string keys', () => {
    const plan = { months: { 3: { events: [] } } };
    expect(getMonth(plan, 3)).toEqual({ events: [] });
    expect(getMonth(plan, '3')).toEqual({ events: [] });
    const planStr = { months: { '5': { events: [1] } } };
    expect(getMonth(planStr, 5)).toEqual({ events: [1] });
    expect(getMonth(null, 1)).toBeUndefined();
    expect(getMonth({}, 1)).toBeUndefined();
  });
});

describe('localIso', () => {
  it('formats a Date as YYYY-MM-DD in local time', () => {
    expect(localIso(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localIso(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('formatDate', () => {
  it('renders weekday + DD.MM. for an ISO date', () => {
    // 2026-01-05 is a Monday.
    expect(formatDate('2026-01-05')).toBe('Mo 05.01.');
    expect(formatDate('')).toBe('');
    expect(formatDate(null)).toBe('');
  });
});

describe('isoToDisplay / displayToIso', () => {
  it('converts ISO to Swiss display format', () => {
    expect(isoToDisplay('2026-01-05')).toBe('05.01.2026');
    expect(isoToDisplay('')).toBe('');
  });

  it('converts Swiss display format to ISO', () => {
    expect(displayToIso('05.01.2026')).toBe('2026-01-05');
    expect(displayToIso('5.1.2026')).toBe('2026-01-05');
    expect(displayToIso('')).toBe('');
    expect(displayToIso('05.01.26')).toBe('');   // 2-digit year rejected
    expect(displayToIso('05/01/2026')).toBe(''); // wrong separator
  });

  it('round-trips', () => {
    const iso = '2026-07-09';
    expect(displayToIso(isoToDisplay(iso))).toBe(iso);
  });
});

describe('weekNumber', () => {
  it('computes ISO week numbers', () => {
    expect(weekNumber('2026-01-01')).toBe(1);
    expect(weekNumber('2026-01-05')).toBe(2);
    expect(weekNumber('2025-12-29')).toBe(1);
  });

  it('handles year-boundary weeks per ISO 8601', () => {
    expect(weekNumber('2021-01-01')).toBe(53);
    expect(weekNumber('2022-01-01')).toBe(52);
    expect(weekNumber('2023-01-01')).toBe(52);
    expect(weekNumber('2024-12-30')).toBe(1);
    for (const iso of ['2020-12-31', '2027-01-01', '2016-01-01']) {
      expect(weekNumber(iso)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('getWednesdays', () => {
  it('returns every Wednesday of a month as ISO strings', () => {
    expect(getWednesdays(2026, 1)).toEqual([
      '2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28',
    ]);
    expect(getWednesdays(2026, 7)).toEqual([
      '2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29',
    ]);
  });
});

describe('locale constants', () => {
  it('have expected shape', () => {
    expect(MONATE).toHaveLength(12);
    expect(MONATE[0]).toBe('Januar');
    expect(MONATE_SHORT[0]).toBe('Jan');
    expect(WEEKDAY_SHORT).toHaveLength(7);
    expect(WEEKDAY_SHORT[1]).toBe('Mo');
    expect(WEEKDAY_LONG[1]).toBe('Montag');
    expect(TEAM_COLORS.every(c => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
  });
});

describe('paginateByHeight', () => {
  it('keeps each page within the height budget', () => {
    const items = [{ estimatedMM: 40 }, { estimatedMM: 40 }, { estimatedMM: 40 }];
    const pages = paginateByHeight(items, 100, 10);
    expect(pages).toHaveLength(2);
    expect(pages[0].map((i: any) => i.estimatedMM)).toEqual([40, 40]);
    expect(pages[1].map((i: any) => i.estimatedMM)).toEqual([40]);
  });

  it('puts everything on one page when it fits', () => {
    const items = [{ estimatedMM: 10 }, { estimatedMM: 10 }];
    const pages = paginateByHeight(items, 100, 5);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
  });

  it('never splits a single oversized item and emits no empty pages', () => {
    const items = [{ estimatedMM: 500 }, { estimatedMM: 500 }];
    const pages = paginateByHeight(items, 100, 10);
    expect(pages).toHaveLength(2);
    expect(pages.every((p: any[]) => p.length === 1)).toBe(true);
  });

  it('returns no pages for an empty list', () => {
    expect(paginateByHeight([], 100, 10)).toEqual([]);
  });

  it('supports a custom sizeOf accessor', () => {
    const items = [{ h: 60 }, { h: 60 }];
    const pages = paginateByHeight(items, 100, 0, (it: any) => it.h);
    expect(pages).toHaveLength(2);
  });
});
