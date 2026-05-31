// ═══════════════════════════════════════════════════════════════════════════
// utils.js — pure, dependency-free helpers (no DOM, no Wails, no state).
// Extracted from app.js so they can be unit-tested in Node and reused as the
// codebase is gradually split into modules.
// ═══════════════════════════════════════════════════════════════════════════

// ── Locale constants ─────────────────────────────────────────────────────────

export const MONATE = ['Januar','Februar','März','April','Mai','Juni',
                       'Juli','August','September','Oktober','November','Dezember'];
export const MONATE_SHORT = MONATE.map(m => m.slice(0, 3));
export const WEEKDAY_SHORT = ['So','Mo','Di','Mi','Do','Fr','Sa'];
export const WEEKDAY_LONG  = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

export const TEAM_COLORS = [
  '#0d9488','#2563eb','#9333ea','#db2777','#ea580c',
  '#65a30d','#0891b2','#7c3aed','#c2410c','#15803d',
];

// ── String helpers ───────────────────────────────────────────────────────────

export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function escNl(s) {
  return esc(s).replace(/\n/g,'<br>');
}

// ── Plan helpers ─────────────────────────────────────────────────────────────

/** Resolve a month entry regardless of whether the key is a number or string. */
export function getMonth(plan, m) {
  return plan?.months?.[m] ?? plan?.months?.[String(m)];
}

// ── Date helpers ─────────────────────────────────────────────────────────────

export function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return WEEKDAY_SHORT[d.getDay()] + ' ' + String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.';
}

export function weekNumber(iso) {
  const d = new Date(iso + 'T00:00:00');
  // Shift to the Thursday of the same ISO week (Mon=1…Sun=7; Thu=4).
  // The ISO year of the week is determined by where Thursday falls.
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + (4 - (d.getDay() || 7)));
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
  return Math.ceil((thursday - startOfWeek1) / 604800000);
}

export function localIso(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

// Date display helpers: Swiss format DD.MM.YYYY <-> ISO YYYY-MM-DD
export function isoToDisplay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function displayToIso(str) {
  if (!str) return '';
  const parts = str.split('.');
  if (parts.length !== 3 || parts[2].length !== 4) return '';
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

export function getWednesdays(year, month) {
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    days.push(localIso(d));
    d.setDate(d.getDate() + 7);
  }
  return days;
}

// ── Pagination ───────────────────────────────────────────────────────────────

/**
 * Greedily groups `items` into pages so each page's total height stays within
 * `pageHeight`. `reservedHeight` is space consumed on every page by fixed
 * chrome (title, footer). An item is never split: if it doesn't fit on the
 * current (non-empty) page it starts a new one, even if it overflows alone.
 * `sizeOf` extracts an item's height; defaults to `item.estimatedMM`.
 * Returns an array of pages, each an array of items (no empty pages).
 */
export function paginateByHeight(items, pageHeight, reservedHeight, sizeOf = (it) => it.estimatedMM) {
  const pages = [];
  let current = [];
  let used = reservedHeight;
  for (const item of items) {
    const h = sizeOf(item);
    if (current.length > 0 && used + h > pageHeight) {
      pages.push(current);
      current = [item];
      used = reservedHeight + h;
    } else {
      current.push(item);
      used += h;
    }
  }
  if (current.length > 0) pages.push(current);
  return pages;
}
