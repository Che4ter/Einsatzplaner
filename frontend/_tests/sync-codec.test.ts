import { describe, it, expect } from 'vitest';
import {
  DELETE_MARKER, isDeleteMarker,
  encodeEventUpdate, encodeEventFull,
  encodeMeta, encodeMember, decodeTeam,
} from '../sync/codec.js';

describe('isDeleteMarker', () => {
  it('identifies the sentinel by reference', () => {
    expect(isDeleteMarker(DELETE_MARKER)).toBe(true);
    expect(isDeleteMarker({ _type: 'delete_field' })).toBe(false); // clone — different ref
    expect(isDeleteMarker(null)).toBe(false);
    expect(isDeleteMarker('')).toBe(false);
    expect(isDeleteMarker(0)).toBe(false);
  });
});

describe('encodeEventUpdate', () => {
  it('strips assignedStaff', () => {
    const ev = { id: 'e1', date: '2026-03-04', assignedStaff: ['a', 'b'], staffRequired: 2, isClosed: false };
    const out = encodeEventUpdate(3, ev);
    expect('assignedStaff' in out).toBe(false);
    expect(out.id).toBe('e1');
    expect(out.month).toBe(3);
  });

  it('marks empty optional fields with DELETE_MARKER', () => {
    const ev = { id: 'e1', dateEnd: '', comment: null, timeSetup: '', timeTeardown: undefined, date: '2026-03-04', isClosed: false };
    const out = encodeEventUpdate(3, ev);
    expect(isDeleteMarker(out.dateEnd)).toBe(true);
    expect(isDeleteMarker(out.comment)).toBe(true);
    expect(isDeleteMarker(out.timeSetup)).toBe(true);
    expect(isDeleteMarker(out.timeTeardown)).toBe(true);
  });

  it('preserves populated optional fields', () => {
    const ev = { id: 'e1', dateEnd: '2026-03-06', comment: 'Hallo', timeSetup: '14:00', timeTeardown: '19:00', isClosed: false };
    const out = encodeEventUpdate(3, ev);
    expect(out.dateEnd).toBe('2026-03-06');
    expect(out.comment).toBe('Hallo');
    expect(out.timeSetup).toBe('14:00');
    expect(out.timeTeardown).toBe('19:00');
  });

  it('does not mutate the input event', () => {
    const ev = { id: 'e1', dateEnd: '', assignedStaff: ['a'], isClosed: false };
    const original = { ...ev };
    encodeEventUpdate(3, ev);
    expect(ev).toEqual(original);
  });
});

describe('encodeEventFull', () => {
  it('preserves assignedStaff', () => {
    const ev = { id: 'e1', date: '2026-03-04', assignedStaff: ['a', 'b'], staffRequired: 2, isClosed: false };
    const out = encodeEventFull(3, ev);
    expect(out.assignedStaff).toEqual(['a', 'b']);
    expect(out.month).toBe(3);
  });

  it('returns a plain JSON-safe object (no class instances)', () => {
    const ev = { id: 'e1', assignedStaff: [], isClosed: false };
    const out = encodeEventFull(1, ev);
    expect(typeof out).toBe('object');
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

describe('encodeMeta', () => {
  it('converts team array to id-keyed map', () => {
    const meta = {
      settings: { teamName: 'Test' },
      team: [
        { id: 'a', name: 'Anna', color: '#fff', active: true },
        { id: 'b', name: 'Bert', color: '#000', active: true },
      ],
    };
    const out = encodeMeta(meta);
    expect(Array.isArray(out.team)).toBe(false);
    expect('a' in (out.team as object) && 'b' in (out.team as object)).toBe(true);
    expect((out.team as any).a.name).toBe('Anna');
  });

  it('preserves an already-map team unchanged', () => {
    const meta = { settings: {}, team: { x: { id: 'x', name: 'Xena', color: '#c00', active: true } } };
    const out = encodeMeta(meta);
    expect('x' in (out.team as object)).toBe(true);
  });
});

describe('encodeMember', () => {
  it('returns a JSON-safe clone', () => {
    const m = { id: 'a', name: 'Anna', color: '#0d9488', active: true };
    const out = encodeMember(m);
    expect(out).toEqual(m);
    expect(out).not.toBe(m);
  });
});

describe('decodeTeam', () => {
  it('passes through an array unchanged', () => {
    const arr = [{ id: 'a' }, { id: 'b' }];
    expect(decodeTeam(arr)).toEqual(arr);
  });

  it('converts a Firestore id-keyed map to array', () => {
    const map = { a: { id: 'a', name: 'Anna' }, b: { id: 'b', name: 'Bert' } };
    const out = decodeTeam(map);
    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBe(2);
    expect(out.some((m: any) => m.name === 'Anna')).toBe(true);
  });

  it('returns empty array for null/undefined/empty', () => {
    expect(decodeTeam(null)).toEqual([]);
    expect(decodeTeam(undefined)).toEqual([]);
    expect(decodeTeam({})).toEqual([]);
  });
});
