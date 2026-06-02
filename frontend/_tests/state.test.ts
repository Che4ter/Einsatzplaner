import { describe, it, expect, beforeEach, vi } from 'vitest';

// state.ts uses localStorage — provide a minimal stub.
const storage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem:    (k: string) => storage[k] ?? null,
  setItem:    (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
});

import {
  state, autosavePaused, setAutosavePaused,
  isAutosaveEnabled, setAutosave, shouldScheduleAutosave,
  externalChangeAction,
} from '../state.js';

beforeEach(() => {
  // Reset module-level mutable state between tests.
  Object.assign(state, {
    plan: null, currentMonth: null, currentPage: 'welcome',
    dirty: false, statsMonth: 0, verlaufGroup: 'all',
    yearPerson: null, monthPerson: null, online: false, cloudRoomCode: '',
  });
  setAutosavePaused(false);
  delete storage['autosave'];
});

describe('isAutosaveEnabled / setAutosave', () => {
  it('returns false when no localStorage entry exists', () => {
    expect(isAutosaveEnabled()).toBe(false);
  });

  it('returns true after setAutosave(true)', () => {
    setAutosave(true);
    expect(isAutosaveEnabled()).toBe(true);
  });

  it('returns false after setAutosave(false)', () => {
    setAutosave(true);
    setAutosave(false);
    expect(isAutosaveEnabled()).toBe(false);
  });
});

describe('shouldScheduleAutosave', () => {
  it('returns false when autosave is disabled', () => {
    setAutosave(false);
    (state as any).plan = {};
    expect(shouldScheduleAutosave()).toBe(false);
  });

  it('returns false when plan is null', () => {
    setAutosave(true);
    state.plan = null;
    expect(shouldScheduleAutosave()).toBe(false);
  });

  it('returns false when paused', () => {
    setAutosave(true);
    (state as any).plan = {};
    setAutosavePaused(true);
    expect(shouldScheduleAutosave()).toBe(false);
  });

  it('returns true when enabled, plan loaded, not paused', () => {
    setAutosave(true);
    (state as any).plan = {};
    setAutosavePaused(false);
    expect(shouldScheduleAutosave()).toBe(true);
  });
});

describe('externalChangeAction', () => {
  it('returns reload-silent when not dirty', () => {
    state.dirty = false;
    expect(externalChangeAction()).toBe('reload-silent');
  });

  it('returns show-banner when dirty', () => {
    state.dirty = true;
    expect(externalChangeAction()).toBe('show-banner');
  });
});

describe('setAutosavePaused', () => {
  it('toggles autosavePaused', () => {
    setAutosavePaused(true);
    expect(autosavePaused).toBe(true);
    setAutosavePaused(false);
    expect(autosavePaused).toBe(false);
  });
});
