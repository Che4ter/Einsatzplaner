import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock ui.js before importing writeTracker so showToast is captured.
vi.mock('../ui.js', () => ({ showToast: vi.fn() }));

import {
  trackCloudWrite,
  getCloudWriteState,
  resetCloudWriteState,
  onWriteStateChange,
} from '../sync/writeTracker.js';

beforeEach(() => {
  resetCloudWriteState();
  vi.clearAllMocks();
});

describe('getCloudWriteState initial state', () => {
  it('starts with pending=0 and outOfSync=false', () => {
    const s = getCloudWriteState();
    expect(s.pending).toBe(0);
    expect(s.outOfSync).toBe(false);
  });
});

describe('trackCloudWrite — pending counter', () => {
  it('increments pending immediately', () => {
    trackCloudWrite(new Promise(() => {}), 'Test');
    expect(getCloudWriteState().pending).toBe(1);
  });

  it('decrements pending on resolve', async () => {
    const p = Promise.resolve();
    trackCloudWrite(p, 'Test');
    await p;
    // Give the .then() handler a tick to run.
    await Promise.resolve();
    expect(getCloudWriteState().pending).toBe(0);
  });

  it('decrements pending on rejection', async () => {
    const p = Promise.reject(new Error('boom'));
    trackCloudWrite(p, 'Test');
    await p.catch(() => {});
    await Promise.resolve();
    expect(getCloudWriteState().pending).toBe(0);
  });

  it('tracks multiple concurrent writes independently', () => {
    trackCloudWrite(new Promise(() => {}), 'A');
    trackCloudWrite(new Promise(() => {}), 'B');
    trackCloudWrite(new Promise(() => {}), 'C');
    expect(getCloudWriteState().pending).toBe(3);
  });
});

describe('trackCloudWrite — outOfSync flag', () => {
  it('sets outOfSync on non-silent rejection', async () => {
    const p = Promise.reject(new Error('network error'));
    trackCloudWrite(p, 'Event', false);
    await p.catch(() => {});
    await Promise.resolve();
    expect(getCloudWriteState().outOfSync).toBe(true);
  });

  it('does NOT set outOfSync on silent rejection', async () => {
    const p = Promise.reject(new Error('log write failed'));
    trackCloudWrite(p, 'Verlauf', true);
    await p.catch(() => {});
    await Promise.resolve();
    expect(getCloudWriteState().outOfSync).toBe(false);
  });

  it('outOfSync stays true even when a subsequent write resolves', async () => {
    // First write fails.
    const bad = Promise.reject(new Error('fail'));
    trackCloudWrite(bad, 'Fail');
    await bad.catch(() => {});
    await Promise.resolve();
    expect(getCloudWriteState().outOfSync).toBe(true);

    // Second write succeeds.
    const good = Promise.resolve();
    trackCloudWrite(good, 'OK');
    await good;
    await Promise.resolve();

    // Flag must remain true — the first write's data is still missing.
    expect(getCloudWriteState().outOfSync).toBe(true);
  });

  it('does not set outOfSync when write resolves', async () => {
    const p = Promise.resolve();
    trackCloudWrite(p, 'Fine');
    await p;
    await Promise.resolve();
    expect(getCloudWriteState().outOfSync).toBe(false);
  });
});

describe('resetCloudWriteState', () => {
  it('clears pending', async () => {
    trackCloudWrite(new Promise(() => {}), 'A');
    expect(getCloudWriteState().pending).toBe(1);
    resetCloudWriteState();
    expect(getCloudWriteState().pending).toBe(0);
  });

  it('clears outOfSync', async () => {
    const p = Promise.reject(new Error('x'));
    trackCloudWrite(p, 'X');
    await p.catch(() => {});
    await Promise.resolve();
    expect(getCloudWriteState().outOfSync).toBe(true);
    resetCloudWriteState();
    expect(getCloudWriteState().outOfSync).toBe(false);
  });
});

describe('onWriteStateChange callback', () => {
  it('fires when pending changes', () => {
    const calls: number[] = [];
    onWriteStateChange(() => calls.push(getCloudWriteState().pending));
    trackCloudWrite(new Promise(() => {}), 'CB');
    expect(calls).toContain(1);
    // Restore to avoid polluting other tests.
    onWriteStateChange(() => {});
  });
});
