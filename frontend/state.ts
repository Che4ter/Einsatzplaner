// state.ts — single-source-of-truth app state + autosave helpers.
// This is a leaf module: it imports only from services.ts (for types).
// Orchestration (scheduling the actual save, handling conflicts) lives in app.js / controllers.

import type { YearPlan } from './services.js';

// ── AppState ──────────────────────────────────────────────────────────────────

export interface AppState {
  plan:         YearPlan | null;
  currentMonth: number | null;   // 1–12
  currentPage:  string;          // 'welcome' | 'month' | 'statistics' | …
  dirty:        boolean;
  statsMonth:   number;          // 0 = all months
  verlaufGroup: string;
  yearPerson:   string | null;
  monthPerson:  string | null;
  online:       boolean;
  cloudRoomCode: string;
}

export const state: AppState = {
  plan:          null,
  currentMonth:  null,
  currentPage:   'welcome',
  dirty:         false,
  statsMonth:    0,
  verlaufGroup:  'all',
  yearPerson:    null,
  monthPerson:   null,
  online:        false,
  cloudRoomCode: '',
};

// ── Autosave ──────────────────────────────────────────────────────────────────

export const AUTOSAVE_DELAY_MS = 3000;

// Whether a save conflict was detected; pauses autosave until resolved.
export let autosavePaused = false;
export function setAutosavePaused(v: boolean): void { autosavePaused = v; }

export function isAutosaveEnabled(): boolean {
  return localStorage.getItem('autosave') === 'true';
}

export function setAutosave(enabled: boolean): void {
  localStorage.setItem('autosave', enabled ? 'true' : 'false');
}

// Pure decider: true when autosave should fire.
export function shouldScheduleAutosave(): boolean {
  return isAutosaveEnabled() && state.plan !== null && !autosavePaused;
}

// Pure decider: what action to take when a file-changed-externally event arrives.
// Returns 'reload-silent' when there are no local changes, 'show-banner' otherwise.
export function externalChangeAction(): 'reload-silent' | 'show-banner' {
  return state.dirty ? 'show-banner' : 'reload-silent';
}
