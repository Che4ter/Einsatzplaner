import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  DELETE_MARKER, isDeleteMarker,
  encodeEventUpdate, encodeEventFull,
  encodeMeta, encodeMember, decodeTeam,
} from '../sync/codec.js';

// ── DELETE_MARKER ─────────────────────────────────────────────────────────────

test('isDeleteMarker identifies the sentinel by reference', () => {
  assert.ok(isDeleteMarker(DELETE_MARKER));
  assert.ok(!isDeleteMarker({ _type: 'delete_field' })); // clone — different ref
  assert.ok(!isDeleteMarker(null));
  assert.ok(!isDeleteMarker(''));
  assert.ok(!isDeleteMarker(0));
});

// ── encodeEventUpdate ─────────────────────────────────────────────────────────

test('encodeEventUpdate strips assignedStaff', () => {
  const ev = { id: 'e1', date: '2026-03-04', assignedStaff: ['a', 'b'], staffRequired: 2, isClosed: false };
  const out = encodeEventUpdate(3, ev);
  assert.ok(!('assignedStaff' in out), 'assignedStaff must be absent');
  assert.equal(out.id, 'e1');
  assert.equal(out.month, 3);
});

test('encodeEventUpdate marks empty optional fields with DELETE_MARKER', () => {
  const ev = { id: 'e1', dateEnd: '', comment: null, timeSetup: '', timeTeardown: undefined, date: '2026-03-04', isClosed: false };
  const out = encodeEventUpdate(3, ev);
  assert.ok(isDeleteMarker(out.dateEnd),     'empty dateEnd → DELETE_MARKER');
  assert.ok(isDeleteMarker(out.comment),     'null comment → DELETE_MARKER');
  assert.ok(isDeleteMarker(out.timeSetup),   'empty timeSetup → DELETE_MARKER');
  assert.ok(isDeleteMarker(out.timeTeardown),'undefined timeTeardown → DELETE_MARKER');
});

test('encodeEventUpdate preserves populated optional fields', () => {
  const ev = { id: 'e1', dateEnd: '2026-03-06', comment: 'Hallo', timeSetup: '14:00', timeTeardown: '19:00', isClosed: false };
  const out = encodeEventUpdate(3, ev);
  assert.equal(out.dateEnd,     '2026-03-06');
  assert.equal(out.comment,     'Hallo');
  assert.equal(out.timeSetup,   '14:00');
  assert.equal(out.timeTeardown,'19:00');
});

test('encodeEventUpdate does not mutate the input event', () => {
  const ev = { id: 'e1', dateEnd: '', assignedStaff: ['a'], isClosed: false };
  const original = { ...ev };
  encodeEventUpdate(3, ev);
  assert.deepEqual(ev, original);
});

// ── encodeEventFull ───────────────────────────────────────────────────────────

test('encodeEventFull preserves assignedStaff', () => {
  const ev = { id: 'e1', date: '2026-03-04', assignedStaff: ['a', 'b'], staffRequired: 2, isClosed: false };
  const out = encodeEventFull(3, ev);
  assert.deepEqual(out.assignedStaff, ['a', 'b']);
  assert.equal(out.month, 3);
});

test('encodeEventFull returns a plain JSON-safe object (no class instances)', () => {
  const ev = { id: 'e1', assignedStaff: [], isClosed: false };
  const out = encodeEventFull(1, ev);
  assert.equal(typeof out, 'object');
  // Round-trip through JSON must be lossless
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

// ── encodeMeta ────────────────────────────────────────────────────────────────

test('encodeMeta converts team array to id-keyed map', () => {
  const meta = {
    settings: { teamName: 'Test' },
    team: [
      { id: 'a', name: 'Anna', color: '#fff', active: true },
      { id: 'b', name: 'Bert', color: '#000', active: true },
    ],
  };
  const out = encodeMeta(meta);
  assert.ok(!Array.isArray(out.team), 'team must be a map, not an array');
  assert.ok('a' in out.team && 'b' in out.team);
  assert.equal(out.team.a.name, 'Anna');
});

test('encodeMeta preserves an already-map team unchanged', () => {
  const meta = { settings: {}, team: { x: { id: 'x', name: 'Xena', color: '#c00', active: true } } };
  const out = encodeMeta(meta);
  assert.ok('x' in out.team);
});

// ── encodeMember ──────────────────────────────────────────────────────────────

test('encodeMember returns a JSON-safe clone', () => {
  const m = { id: 'a', name: 'Anna', color: '#0d9488', active: true };
  const out = encodeMember(m);
  assert.deepEqual(out, m);
  assert.notEqual(out, m); // different reference
});

// ── decodeTeam ────────────────────────────────────────────────────────────────

test('decodeTeam passes through an array unchanged', () => {
  const arr = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(decodeTeam(arr), arr);
});

test('decodeTeam converts a Firestore id-keyed map to array', () => {
  const map = { a: { id: 'a', name: 'Anna' }, b: { id: 'b', name: 'Bert' } };
  const out = decodeTeam(map);
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 2);
  assert.ok(out.some((m) => m.name === 'Anna'));
});

test('decodeTeam returns empty array for null/undefined/empty', () => {
  assert.deepEqual(decodeTeam(null), []);
  assert.deepEqual(decodeTeam(undefined), []);
  assert.deepEqual(decodeTeam({}), []);
});
