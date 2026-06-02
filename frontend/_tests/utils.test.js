// Unit tests for the pure helpers in utils.js.
// Run with:  node --test   (from the frontend/ directory)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, escNl, getMonth, formatDate, weekNumber, localIso,
  isoToDisplay, displayToIso, getWednesdays, paginateByHeight,
  MONATE, MONATE_SHORT, WEEKDAY_SHORT, WEEKDAY_LONG, TEAM_COLORS,
} from '../utils.js';

test('esc escapes HTML-significant characters', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('escNl escapes then converts newlines to <br>', () => {
  assert.equal(escNl('a\nb'), 'a<br>b');
  assert.equal(escNl('<x>\n<y>'), '&lt;x&gt;<br>&lt;y&gt;');
});

test('getMonth resolves numeric and string keys', () => {
  const plan = { months: { 3: { events: [] } } };
  assert.deepEqual(getMonth(plan, 3), { events: [] });
  assert.deepEqual(getMonth(plan, '3'), { events: [] });
  const planStr = { months: { '5': { events: [1] } } };
  assert.deepEqual(getMonth(planStr, 5), { events: [1] });
  assert.equal(getMonth(null, 1), undefined);
  assert.equal(getMonth({}, 1), undefined);
});

test('localIso formats a Date as YYYY-MM-DD in local time', () => {
  // Construct with local Y/M/D so the result is timezone-independent.
  assert.equal(localIso(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(localIso(new Date(2026, 11, 31)), '2026-12-31');
});

test('formatDate renders weekday + DD.MM. for an ISO date', () => {
  // 2026-01-05 is a Monday.
  assert.equal(formatDate('2026-01-05'), 'Mo 05.01.');
  assert.equal(formatDate(''), '');
  assert.equal(formatDate(null), '');
});

test('isoToDisplay converts ISO to Swiss display format', () => {
  assert.equal(isoToDisplay('2026-01-05'), '05.01.2026');
  assert.equal(isoToDisplay(''), '');
});

test('displayToIso converts Swiss display format to ISO', () => {
  assert.equal(displayToIso('05.01.2026'), '2026-01-05');
  assert.equal(displayToIso('5.1.2026'), '2026-01-05');
  assert.equal(displayToIso(''), '');
  assert.equal(displayToIso('05.01.26'), '');   // 2-digit year rejected
  assert.equal(displayToIso('05/01/2026'), ''); // wrong separator
});

test('isoToDisplay and displayToIso round-trip', () => {
  const iso = '2026-07-09';
  assert.equal(displayToIso(isoToDisplay(iso)), iso);
});

test('weekNumber computes ISO week numbers', () => {
  // 2026-01-01 is a Thursday -> ISO week 1.
  assert.equal(weekNumber('2026-01-01'), 1);
  // 2026-01-05 (Mon) is still ISO week 2.
  assert.equal(weekNumber('2026-01-05'), 2);
  // 2025-12-29 (Mon) belongs to ISO week 1 of 2026.
  assert.equal(weekNumber('2025-12-29'), 1);
});

test('weekNumber handles year-boundary weeks per ISO 8601', () => {
  // A Jan 1 that falls early in the week belongs to the LAST week of the
  // previous ISO year (week 52 or 53), never week 0. These lock the correct
  // ISO behaviour so the "KW 52–5" style range labels stay intentional.
  assert.equal(weekNumber('2021-01-01'), 53); // Fri -> ISO week 53 of 2020
  assert.equal(weekNumber('2022-01-01'), 52); // Sat -> ISO week 52 of 2021
  assert.equal(weekNumber('2023-01-01'), 52); // Sun -> ISO week 52 of 2022
  // A late-December date can belong to ISO week 1 of the next year.
  assert.equal(weekNumber('2024-12-30'), 1);  // Mon -> ISO week 1 of 2025
  // weekNumber is always >= 1 (never 0).
  for (const iso of ['2020-12-31', '2027-01-01', '2016-01-01']) {
    assert.ok(weekNumber(iso) >= 1, `${iso} should be >= 1`);
  }
});

test('getWednesdays returns every Wednesday of a month as ISO strings', () => {
  // January 2026: Wednesdays fall on 7, 14, 21, 28.
  assert.deepEqual(getWednesdays(2026, 1), [
    '2026-01-07', '2026-01-14', '2026-01-21', '2026-01-28',
  ]);
  // A month starting mid-week still finds all Wednesdays.
  // July 2026: Wednesdays on 1, 8, 15, 22, 29.
  assert.deepEqual(getWednesdays(2026, 7), [
    '2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22', '2026-07-29',
  ]);
});

test('locale constants have expected shape', () => {
  assert.equal(MONATE.length, 12);
  assert.equal(MONATE[0], 'Januar');
  assert.equal(MONATE_SHORT[0], 'Jan');
  assert.equal(WEEKDAY_SHORT.length, 7);
  assert.equal(WEEKDAY_SHORT[1], 'Mo');
  assert.equal(WEEKDAY_LONG[1], 'Montag');
  assert.ok(TEAM_COLORS.every(c => /^#[0-9a-f]{6}$/i.test(c)));
});

test('paginateByHeight keeps each page within the height budget', () => {
  // Page budget 100, reserved 10 -> 90 usable for items.
  const items = [{ estimatedMM: 40 }, { estimatedMM: 40 }, { estimatedMM: 40 }];
  const pages = paginateByHeight(items, 100, 10);
  // 10+40+40 = 90 fits; adding the third (130) overflows -> new page.
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0].map(i => i.estimatedMM), [40, 40]);
  assert.deepEqual(pages[1].map(i => i.estimatedMM), [40]);
});

test('paginateByHeight puts everything on one page when it fits', () => {
  const items = [{ estimatedMM: 10 }, { estimatedMM: 10 }];
  const pages = paginateByHeight(items, 100, 5);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 2);
});

test('paginateByHeight never splits a single oversized item and emits no empty pages', () => {
  // Each item alone exceeds the page budget; each lands on its own page.
  const items = [{ estimatedMM: 500 }, { estimatedMM: 500 }];
  const pages = paginateByHeight(items, 100, 10);
  assert.equal(pages.length, 2);
  assert.ok(pages.every(p => p.length === 1));
});

test('paginateByHeight returns no pages for an empty list', () => {
  assert.deepEqual(paginateByHeight([], 100, 10), []);
});

test('paginateByHeight supports a custom sizeOf accessor', () => {
  const items = [{ h: 60 }, { h: 60 }];
  const pages = paginateByHeight(items, 100, 0, (it) => it.h);
  assert.equal(pages.length, 2);
});
