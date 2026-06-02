// sync/firestore.ts — Firebase connection lifecycle + Firestore transport.
// Connection and transport are kept in one module because they share mutable
// state: db, currentRoomCode, currentYear, currentUnsubscribes.
// Splitting them would give each module a separate copy, silently dropping writes.

import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  onSnapshot,
  collection,
  doc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  getDocFromCache,
  getDocFromServer,
  deleteField,
} from 'firebase/firestore';
import { SyncFullPlan, SyncMetaUpdate, SyncEventUpdate, ConnectCloud } from '../services.js';
import {
  DELETE_MARKER, isDeleteMarker,
  encodeEventUpdate, encodeEventFull,
  encodeMeta, encodeMember, decodeTeam,
} from './codec.js';

// ── Module-level shared state ─────────────────────────────────────────────────

let db: any = null;
let currentUnsubscribes: Array<() => void> = [];
let currentRoomCode: string | null = null;
let currentYear: number | null = null;
let lastProbedRoomCode: string | null = null;

export function getLastProbedRoomCode(): string | null { return lastProbedRoomCode; }

// ── Init ──────────────────────────────────────────────────────────────────────

export function initFirebase(projectId: string, apiKey: string): void {
  if (db) return;
  if (!projectId || !apiKey) { console.warn('Firebase credentials missing'); return; }
  const app = initializeApp({ projectId, apiKey });
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export function disconnectFromCloud(): void {
  currentUnsubscribes.forEach(u => u());
  currentUnsubscribes = [];
  currentRoomCode = null;
  currentYear = null;
  lastProbedRoomCode = null;
}

// ── Probes ────────────────────────────────────────────────────────────────────

export async function getAvailableYears(roomCode: string): Promise<number[]> {
  if (!db) return [];
  const roomRef = doc(db, `rooms/${roomCode}`);
  try {
    const cached = await getDocFromCache(roomRef);
    if (cached.exists() && cached.data().years) return cached.data().years;
  } catch { /* not in cache yet */ }
  const snap = await getDoc(roomRef);
  if (snap.exists() && snap.data().years) return snap.data().years;
  return [];
}

export async function checkRoomExists(roomCode: string): Promise<boolean | null> {
  if (!db) return null;
  try {
    const snap = await getDocFromServer(doc(db, `rooms/${roomCode}`));
    return snap.exists();
  } catch {
    return null;
  }
}

export function setRoomContext(roomCode: string, year: number): void {
  lastProbedRoomCode = roomCode;
  currentRoomCode = roomCode;
  currentYear = year;
}

// ── Connect ───────────────────────────────────────────────────────────────────

export async function connectToCloud(roomCode: string, year: number): Promise<any> {
  disconnectFromCloud();
  if (!db) return null;

  lastProbedRoomCode = roomCode;
  currentRoomCode = roomCode;
  currentYear = year;

  if (year <= 0) return null; // probe only — no year committed yet

  const metaRef   = doc(db, `rooms/${roomCode}/plans/${year}/meta/data`);
  const eventsRef = collection(db, `rooms/${roomCode}/plans/${year}/events`);

  let metaLoaded   = false;
  let eventsLoaded = false;

  return new Promise((resolve, reject) => {
    const initialPlan: any = {
      version: 1, year, settings: {}, team: [],
      months: Object.fromEntries(Array.from({length: 12}, (_, i) => [i + 1, { events: [] }])),
      activityLog: [],
    };

    let activityLoaded = false;
    getDocs(collection(db, `rooms/${roomCode}/plans/${year}/activity`))
      .then(snap => {
        const entries: any[] = [];
        snap.forEach((d: any) => entries.push(d.data()));
        entries.sort((a, b) => String(a.at).localeCompare(String(b.at)));
        initialPlan.activityLog = entries;
      })
      .catch(() => {})
      .finally(() => { activityLoaded = true; checkInitialLoad(); });

    let metaMissingChecked = false;
    let settled = false;

    function rejectOnce(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      currentUnsubscribes.forEach(u => u());
      currentUnsubscribes = [];
      reject(err);
    }

    const connectTimer = setTimeout(
      () => rejectOnce(new Error('Verbindungs-Timeout')),
      15000,
    );

    const unsubMeta = onSnapshot(metaRef, { includeMetadataChanges: false }, (docSnap: any) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const team = decodeTeam(data.team);
        if (!metaLoaded) {
          initialPlan.settings = data.settings ?? {};
          initialPlan.team = team;
          metaLoaded = true;
          checkInitialLoad();
        } else if (!docSnap.metadata.hasPendingWrites) {
          SyncMetaUpdate(data.settings ?? {}, team);
        }
      } else {
        if (!metaLoaded && !metaMissingChecked) {
          metaMissingChecked = true;
          getDocFromServer(doc(db, `rooms/${roomCode}`)).then(roomSnap => {
            if (!roomSnap.exists()) {
              rejectOnce(new Error('Raum nicht gefunden'));
            } else {
              metaLoaded = true;
              checkInitialLoad();
            }
          }).catch(() => { metaLoaded = true; checkInitialLoad(); });
        }
      }
    }, (err: Error) => rejectOnce(err));
    currentUnsubscribes.push(unsubMeta);

    const unsubEvents = onSnapshot(eventsRef, { includeMetadataChanges: false }, (snapshot: any) => {
      if (!eventsLoaded) {
        snapshot.forEach((docSnap: any) => {
          const ev = docSnap.data();
          ev.assignedStaff = ev.assignedStaff ?? [];
          if (ev.month >= 1 && ev.month <= 12) {
            initialPlan.months[ev.month].events.push(ev);
          } else {
            console.warn('connectToCloud: event has out-of-range month, skipped', ev.id, ev.month);
          }
        });
        eventsLoaded = true;
        checkInitialLoad();
      } else {
        snapshot.docChanges().forEach((change: any) => {
          if (change.doc.metadata.hasPendingWrites) return;
          const ev = change.doc.data();
          ev.assignedStaff = ev.assignedStaff ?? [];
          if (change.type === 'added' || change.type === 'modified') {
            SyncEventUpdate(ev.month, ev, false);
          } else if (change.type === 'removed') {
            SyncEventUpdate(ev.month, ev, true);
          }
        });
      }
    }, (err: Error) => rejectOnce(err));
    currentUnsubscribes.push(unsubEvents);

    async function checkInitialLoad() {
      if (metaLoaded && eventsLoaded && activityLoaded) {
        clearTimeout(connectTimer);
        settled = true;
        const resolved = await SyncFullPlan(initialPlan);
        await ConnectCloud(roomCode, year);
        resolve(resolved);
      }
    }
  });
}

// ── Transport helpers ─────────────────────────────────────────────────────────
// Fire-and-forget: Firestore SDK commits to local cache synchronously;
// server sync is background. Callers that need ordering may await.

function applyDeleteMarkers(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = isDeleteMarker(v) ? deleteField() : v;
  }
  return out;
}

function eventRef(eventId: string) {
  return doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/events/${eventId}`);
}
function metaRef() {
  return doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/meta/data`);
}
function hasContext(fnName: string): boolean {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn(`${fnName}: missing room context — write dropped`, { currentRoomCode, currentYear });
    return false;
  }
  return true;
}

export function dbSaveEvent(month: number, ev: any): Promise<void> {
  if (!hasContext('dbSaveEvent')) return Promise.resolve();
  const payload = applyDeleteMarkers(encodeEventUpdate(month, ev));
  return setDoc(eventRef(ev.id), payload, { merge: true });
}

export function dbSaveEventFull(month: number, ev: any): Promise<void> {
  if (!hasContext('dbSaveEventFull')) return Promise.resolve();
  return setDoc(eventRef(ev.id), encodeEventFull(month, ev));
}

export function dbDeleteEvent(eventId: string): Promise<void> {
  if (!hasContext('dbDeleteEvent')) return Promise.resolve();
  return deleteDoc(eventRef(eventId));
}

export function dbSaveMeta(metaData: any): Promise<void> {
  if (!hasContext('dbSaveMeta')) return Promise.resolve();
  return setDoc(metaRef(), encodeMeta(metaData), { merge: true });
}

export function dbSaveMember(member: any): Promise<void> {
  if (!hasContext('dbSaveMember')) return Promise.resolve();
  return setDoc(
    metaRef(),
    { team: { [member.id]: encodeMember(member) } },
    { merge: true },
  );
}

export function dbDeleteMember(memberId: string): Promise<void> {
  if (!hasContext('dbDeleteMember')) return Promise.resolve();
  return setDoc(metaRef(), { team: { [memberId]: deleteField() } }, { merge: true });
}

export function dbSaveSettings(settings: any): Promise<void> {
  if (!hasContext('dbSaveSettings')) return Promise.resolve();
  return setDoc(metaRef(), { settings: JSON.parse(JSON.stringify(settings)) }, { merge: true });
}

export function dbAppendActivity(entry: any): Promise<void> {
  if (!db || !currentRoomCode || !currentYear) return Promise.resolve();
  const actRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/activity/${entry.id}`);
  return setDoc(actRef, JSON.parse(JSON.stringify(entry)));
}

export function dbAddYearToRoom(roomCode: string, year: number): Promise<void> {
  if (!db) return Promise.resolve();
  return setDoc(doc(db, `rooms/${roomCode}`), { years: arrayUnion(year) }, { merge: true });
}

export function dbAssignStaff(eventId: string, userId: string): Promise<void> {
  if (!hasContext('dbAssignStaff')) return Promise.resolve();
  return updateDoc(eventRef(eventId), { assignedStaff: arrayUnion(userId) });
}

export function dbUnassignStaff(eventId: string, userId: string): Promise<void> {
  if (!hasContext('dbUnassignStaff')) return Promise.resolve();
  return updateDoc(eventRef(eventId), { assignedStaff: arrayRemove(userId) });
}
