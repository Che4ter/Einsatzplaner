// sync/writeTracker.ts — in-flight cloud write state.
// Tracks pending writes and sticky out-of-sync failures.
// The DOM pill update is decoupled via onWriteStateChange() so this module
// stays DOM-free and the callback can be registered after the DOM is ready.

import { showToast } from '../ui.js';

interface WriteState { pending: number; outOfSync: boolean; }

const _state: WriteState = { pending: 0, outOfSync: false };
let _onChange: (() => void) | null = null;

/** Register a callback that fires whenever write state changes (e.g. to update the save pill). */
export function onWriteStateChange(cb: () => void): void {
  _onChange = cb;
}

/** Returns a read-only snapshot of the current write state. */
export function getCloudWriteState(): Readonly<WriteState> {
  return _state;
}

// Called internally after every state mutation.
function notify() { _onChange?.(); }

/**
 * Wraps a Firestore write promise: counts it as in-flight; on failure sets the
 * sticky out-of-sync flag and raises a persistent warning.
 * Activity-log writes pass silent=true — a lost log line must not flip the flag
 * or nag the user, but it still counts toward pending for the "Synchronisiere…" state.
 */
export function trackCloudWrite(promise: Promise<unknown>, label: string, silent = false): void {
  _state.pending++;
  notify();
  promise.then(
    () => { _state.pending--; notify(); },
    (err) => {
      _state.pending--;
      if (!silent) {
        _state.outOfSync = true;
        showToast(
          `${label} konnte nicht in die Cloud gespeichert werden. ` +
          `Die Server-Daten sind jetzt veraltet — verbinde neu oder exportiere ` +
          `zur Sicherheit (Export → JSON).`,
          'error', 8000,
        );
      }
      notify();
    },
  ).catch(() => {}); // swallow — callers must not see unhandled rejections
}

/**
 * Reset write state on (dis)connect: clears pending count and sticky failure flag
 * so a fresh room doesn't inherit a stale "Sync-Fehler" badge.
 */
export function resetCloudWriteState(): void {
  _state.pending = 0;
  _state.outOfSync = false;
  notify();
}
