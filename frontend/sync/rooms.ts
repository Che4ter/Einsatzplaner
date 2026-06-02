// sync/rooms.ts — pure localStorage helpers for recently-used cloud rooms.
// No DOM, no side effects — safe to unit-test in Node.
// Callers are responsible for triggering any UI refresh after mutating.

export interface RecentRoom {
  code: string;
  year: number;
  usedAt: string; // ISO timestamp
}

const STORAGE_KEY = 'recentCloudRooms';
const MAX_ROOMS = 10;

export function getRooms(): RecentRoom[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); }
  catch { return []; }
}

export function saveRooms(rooms: RecentRoom[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms)); }
  catch { /* quota / private mode */ }
}

/** Returns a new array with the (code, year) pair prepended, deduped, and capped at MAX_ROOMS. */
export function addRoom(rooms: RecentRoom[], code: string, year: number): RecentRoom[] {
  const filtered = rooms.filter(r => !(r.code === code && r.year === year));
  filtered.unshift({ code, year, usedAt: new Date().toISOString() });
  return filtered.slice(0, MAX_ROOMS);
}

/** Returns a new array with all entries for the given room code removed. */
export function removeRoom(rooms: RecentRoom[], code: string): RecentRoom[] {
  return rooms.filter(r => r.code !== code);
}
