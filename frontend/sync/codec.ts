// sync/codec.ts — pure Firestore document encoding/decoding.
// No Firebase imports, no I/O — safe to unit-test in Node.
//
// The transport layer (firestore.ts) replaces DELETE_MARKER with the real
// Firestore deleteField() sentinel. Never structuredClone codec output after
// calling encode* functions: cloning breaks DELETE_MARKER identity (=== check).

/** Sentinel placed by the encoder to signal a field should be deleted in Firestore. */
export const DELETE_MARKER = Object.freeze({ _type: 'delete_field' as const });

/** Returns true if a value is the DELETE_MARKER. Use this in transport, not ===, so the intent is explicit. */
export function isDeleteMarker(v: unknown): boolean {
  return v === DELETE_MARKER;
}

const OPTIONAL_EVENT_FIELDS = ['dateEnd', 'comment', 'timeSetup', 'timeTeardown'] as const;

/**
 * Encode an event for the UPDATE path: strips assignedStaff (managed atomically
 * by assign/unassign helpers) and marks empty optional fields for deletion so
 * stale values aren't left behind.
 */
export function encodeEventUpdate(month: number, ev: any): Record<string, unknown> {
  const { assignedStaff: _omit, ...rest } = ev;
  const payload: Record<string, unknown> = { ...rest, month };
  for (const field of OPTIONAL_EVENT_FIELDS) {
    if (payload[field] === '' || payload[field] == null) {
      payload[field] = DELETE_MARKER;
    }
  }
  return payload;
}

/**
 * Encode an event for the CREATE path (bootstrap only): writes the full document
 * including assignedStaff. Only safe to call when no other clients are connected.
 */
export function encodeEventFull(month: number, ev: any): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(ev)), month };
}

/**
 * Encode the meta document: converts the team array → id-keyed map so individual
 * member fields can be merged without overwriting the whole team.
 */
export function encodeMeta(metaData: any): Record<string, unknown> {
  const team = Array.isArray(metaData.team)
    ? Object.fromEntries(metaData.team.map((m: any) => [m.id, m]))
    : (metaData.team ?? {});
  return JSON.parse(JSON.stringify({ ...metaData, team }));
}

/**
 * Encode a single team member for a targeted meta-doc merge.
 * Returns a pure JSON-safe object.
 */
export function encodeMember(member: any): Record<string, unknown> {
  return JSON.parse(JSON.stringify(member));
}

/**
 * Decode the Firestore team field back to an array.
 * Firestore stores it as an id-keyed map; older data may already be an array.
 */
export function decodeTeam(raw: any): any[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}
