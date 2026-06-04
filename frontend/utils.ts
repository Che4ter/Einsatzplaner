// utils.ts — pure, dependency-free helpers (no DOM, no Wails, no state).

import type { YearPlan } from './services.js';

// ── Locale constants ─────────────────────────────────────────────────────────

export const MONATE: readonly string[] = ['Januar','Februar','März','April','Mai','Juni',
                                          'Juli','August','September','Oktober','November','Dezember'];
export const MONATE_SHORT: readonly string[] = MONATE.map(m => m.slice(0, 3));
export const WEEKDAY_SHORT: readonly string[] = ['So','Mo','Di','Mi','Do','Fr','Sa'];
export const WEEKDAY_LONG:  readonly string[] = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

export const TEAM_COLORS: readonly string[] = [
  '#0d9488','#2563eb','#9333ea','#db2777','#ea580c',
  '#65a30d','#0891b2','#7c3aed','#c2410c','#15803d',
];

// ── String helpers ────────────────────────────────────────────────────────────

export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function escNl(s: unknown): string {
  return esc(s).replace(/\n/g,'<br>');
}

// ── Plan helpers ──────────────────────────────────────────────────────────────

export function getMonth(plan: YearPlan | null | undefined, m: number | string) {
  return plan?.months?.[m as number] ?? plan?.months?.[String(m) as any];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

export function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return WEEKDAY_SHORT[d.getDay()] + ' ' + String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.';
}

export function weekNumber(iso: string): number {
  const d = new Date(iso + 'T00:00:00');
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + (4 - (d.getDay() || 7)));
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
  return Math.ceil((thursday.getTime() - startOfWeek1.getTime()) / 604800000);
}

export function localIso(d: Date): string {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

export function isoToDisplay(iso: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function displayToIso(str: string): string {
  if (!str) return '';
  const parts = str.split('.');
  if (parts.length !== 3 || parts[2].length !== 4) return '';
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

export function getWednesdays(year: number, month: number): string[] {
  const days: string[] = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    days.push(localIso(d));
    d.setDate(d.getDate() + 7);
  }
  return days;
}

// ── Pagination ────────────────────────────────────────────────────────────────

export function paginateByHeight<T>(
  items: T[],
  pageHeight: number,
  reservedHeight: number,
  sizeOf: (item: T) => number = (it: any) => it.estimatedMM,
): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
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
