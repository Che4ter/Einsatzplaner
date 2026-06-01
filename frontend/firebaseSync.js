import { initializeApp } from "firebase/app";
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
  getDocFromCache,
  getDocFromServer,
  deleteField,
} from "firebase/firestore";
import {
  SyncFullPlan,
  SyncMetaUpdate,
  SyncEventUpdate,
  ConnectCloud,
} from "./bindings/einsatzplaner/einsatzplan/service/plannerservice.js";

let db = null;
let currentUnsubscribes = [];
let currentRoomCode = null;
let currentYear = null;
// Holds the room code from the most recent probe/connect call so callers can
// retrieve it without needing Go's ConnectCloud to have been committed yet.
let lastProbedRoomCode = null;

export function getLastProbedRoomCode() { return lastProbedRoomCode; }

// Initialize Firebase with credentials passed from Go
export function initFirebase(projectId, apiKey) {
  if (db) return; // Already init
  if (!projectId || !apiKey) {
    console.warn("Firebase credentials missing");
    return;
  }

  const app = initializeApp({ projectId, apiKey });
  // Persistent cache: writes are committed to IndexedDB immediately and
  // synced to the server in the background. This is what makes writes feel
  // instant — the promise resolves once the local cache is updated, not
  // after a network round-trip.
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
  });
}

// Ensure all existing subscriptions are closed when leaving a room 
export function disconnectFromCloud() {
  currentUnsubscribes.forEach(unsub => unsub());
  currentUnsubscribes = [];
  currentRoomCode = null;
  currentYear = null;
  lastProbedRoomCode = null;
}

// Read years list — try local cache first to avoid a blocking network read.
export async function getAvailableYears(roomCode) {
  if (!db) return [];
  const roomRef = doc(db, `rooms/${roomCode}`);
  try {
    const cached = await getDocFromCache(roomRef);
    if (cached.exists() && cached.data().years) return cached.data().years;
  } catch { /* not in cache yet — fall through to network */ }
  const snap = await getDoc(roomRef);
  if (snap.exists() && snap.data().years) return snap.data().years;
  return [];
}

// Check whether a room code exists in Firestore.
// Always reads from the server — the local cache may have a stale "exists" entry
// for rooms that were deleted, which would cause false positives.
// Returns null when db is not initialised or a network error occurs.
export async function checkRoomExists(roomCode) {
  if (!db) return null;
  try {
    const snap = await getDocFromServer(doc(db, `rooms/${roomCode}`));
    return snap.exists();
  } catch {
    return null; // offline or network error — leave row as-is
  }
}

// Set module-level room context without subscribing to Firestore.
// Call this before dbSaveEvent/dbSaveMeta when bootstrapping a brand-new plan so
// that Firestore writes complete before connectToCloud starts the onSnapshot listeners.
export function setRoomContext(roomCode, year) {
  lastProbedRoomCode = roomCode;
  currentRoomCode = roomCode;
  currentYear = year;
}

function teamFromFirestore(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  return Object.values(raw);
}

// Connect to a specific year and dispatch updates back to Go
export async function connectToCloud(roomCode, year) {
  disconnectFromCloud();
  if (!db) return null;

  lastProbedRoomCode = roomCode;
  currentRoomCode = roomCode;
  currentYear = year;
  
  if (year > 0) {
    const metaRef = doc(db, `rooms/${roomCode}/plans/${year}/meta/data`);
    const eventsRef = collection(db, `rooms/${roomCode}/plans/${year}/events`);
    
    // Track if we got initial loads
    let metaLoaded = false;
    let eventsLoaded = false;
    
    return new Promise((resolve, reject) => {
      // Rebuild plan in JS to pass to Go.
      const initialPlan = {
        version: 1,
        year: year,
        settings: {},
        team: [],
        months: {}
      };
      for(let i=1; i<=12; i++) initialPlan.months[i] = { events: [] };

      // Track whether the meta doc existed on the first snapshot. A missing meta
      // doc could mean a brand-new plan (bootstrap) or a deleted room. We tell
      // them apart by checking whether the room root doc exists; that check happens
      // only when meta is missing so we don't add a read on normal connects.
      let metaMissingChecked = false;
      let settled = false;

      // Reject once and clean up all listeners so the promise doesn't hang.
      function rejectOnce(err) {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        currentUnsubscribes.forEach(u => u());
        currentUnsubscribes = [];
        reject(err);
      }

      // 15 s connect timeout — guards against silent listener failures where
      // neither the next nor the error callback fires (e.g. SDK hangs).
      const connectTimer = setTimeout(() => rejectOnce(new Error('Verbindungs-Timeout')), 15000);

      const unsubMeta = onSnapshot(metaRef, { includeMetadataChanges: false }, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const team = teamFromFirestore(data.team);
          if (!metaLoaded) {
            initialPlan.settings = data.settings || {};
            initialPlan.team = team;
            metaLoaded = true;
            checkInitialLoad();
          } else if (!docSnap.metadata.hasPendingWrites) {
            // Only sync when this is a confirmed server update from another client.
            SyncMetaUpdate(data.settings || {}, team);
          }
        } else {
          if (!metaLoaded && !metaMissingChecked) {
            metaMissingChecked = true;
            // Meta doc missing — verify the room itself still exists before proceeding.
            // A deleted room has no room doc; a new plan simply has no meta yet.
            getDocFromServer(doc(db, `rooms/${roomCode}`)).then(roomSnap => {
              if (!roomSnap.exists()) {
                rejectOnce(new Error('Raum nicht gefunden'));
              } else {
                // Room exists but has no plan for this year yet — valid for bootstrap.
                metaLoaded = true;
                checkInitialLoad();
              }
            }).catch(() => {
              // Can't reach server — proceed optimistically (offline case).
              metaLoaded = true;
              checkInitialLoad();
            });
          }
        }
      }, (err) => rejectOnce(err));
      currentUnsubscribes.push(unsubMeta);

      const unsubEvents = onSnapshot(eventsRef, { includeMetadataChanges: false }, (snapshot) => {
        if (!eventsLoaded) {
          snapshot.forEach((docSnap) => {
            const ev = docSnap.data();
            ev.assignedStaff = ev.assignedStaff || [];
            if (ev.month >= 1 && ev.month <= 12) {
              initialPlan.months[ev.month].events.push(ev);
            } else {
              console.warn('connectToCloud: event has out-of-range month, skipped', ev.id, ev.month);
            }
          });
          eventsLoaded = true;
          checkInitialLoad();
        } else {
          snapshot.docChanges().forEach((change) => {
            // hasPendingWrites = this change came from our own local write that
            // hasn't been server-confirmed yet — Go already has it, skip.
            if (change.doc.metadata.hasPendingWrites) return;
            const ev = change.doc.data();
            ev.assignedStaff = ev.assignedStaff || [];
            if (change.type === "added" || change.type === "modified") {
              SyncEventUpdate(ev.month, ev, false);
            } else if (change.type === "removed") {
              SyncEventUpdate(ev.month, ev, true);
            }
          });
        }
      }, (err) => rejectOnce(err));
      currentUnsubscribes.push(unsubEvents);

      async function checkInitialLoad() {
        if (metaLoaded && eventsLoaded) {
          clearTimeout(connectTimer);
          settled = true;
          const resolved = await SyncFullPlan(initialPlan);
          await ConnectCloud(roomCode, year); // must complete before resolving so Go's isOnline=true is visible to callers
          resolve(resolved);
        }
      }
    });
  } else {
    // Year 0 = just probe the room for available years, don't commit to it yet.
    // ConnectCloud on the Go side is called only once we actually load a year plan.
    return null;
  }
}

// ── Write helpers ─────────────────────────────────────────────────────────────
// These intentionally do NOT await server acknowledgment. Firestore's SDK
// commits writes to its local cache synchronously and syncs to the server in
// the background — awaiting only adds round-trip latency with no UX benefit.
// Callers that need to sequence writes (e.g. bootstrap) may await the returned
// promise; normal event-handler callers should fire-and-forget.

export function dbSaveEvent(month, ev) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbSaveEvent: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const eventRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/events/${ev.id}`);
  // Strip assignedStaff — concurrent staff toggles use atomic arrayUnion/arrayRemove
  // (dbAssignStaff/dbUnassignStaff) and a full overwrite here would clobber them.
  const { assignedStaff: _omit, ...rest } = ev;
  // Use merge:true so assignedStaff (managed separately) is preserved server-side.
  // Optional fields that are absent/empty must be explicitly deleted so that a
  // previously set value (e.g. dateEnd, comment) is cleared rather than left stale.
  const OPTIONAL_FIELDS = ['dateEnd', 'comment', 'timeSetup', 'timeTeardown'];
  const payload = { ...JSON.parse(JSON.stringify(rest)), month };
  for (const field of OPTIONAL_FIELDS) {
    if (payload[field] === '' || payload[field] == null) payload[field] = deleteField();
  }
  return setDoc(eventRef, payload, { merge: true });
}

// Bootstrap-only: write a complete event document including assignedStaff.
// Only safe to call during initial plan creation when no other clients are
// connected yet. Normal mutations must use dbSaveEvent + dbAssignStaff/dbUnassignStaff.
export function dbSaveEventFull(month, ev) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbSaveEventFull: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const eventRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/events/${ev.id}`);
  return setDoc(eventRef, JSON.parse(JSON.stringify({ ...ev, month })));
}

export function dbDeleteEvent(eventId) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbDeleteEvent: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const eventRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/events/${eventId}`);
  return deleteDoc(eventRef);
}

export function dbSaveMeta(metaData) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbSaveMeta: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const metaRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/meta/data`);
  const team = Array.isArray(metaData.team)
    ? Object.fromEntries(metaData.team.map(m => [m.id, m]))
    : (metaData.team || {});
  const pureData = JSON.parse(JSON.stringify({ ...metaData, team }));
  return setDoc(metaRef, pureData, { merge: true });
}

// Write a single team member into the meta doc's `team` map field.
// Only the fields for this one member are touched — other members are unaffected.
export function dbSaveMember(member) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbSaveMember: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const metaRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/meta/data`);
  const pureData = JSON.parse(JSON.stringify(member));
  // setDoc + merge:true writes only meta.team.<id>, leaving other team entries
  // and settings untouched, AND creates the meta doc if it doesn't exist yet
  // (updateDoc would reject with "no document to update" when connecting to a
  // room whose year has no meta doc — see the bootstrap path in connectToCloud).
  return setDoc(metaRef, { team: { [member.id]: pureData } }, { merge: true });
}

// Remove a single team member from the meta doc's `team` map.
export function dbDeleteMember(memberId) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbDeleteMember: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const metaRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/meta/data`);
  // setDoc + merge:true so a delete against a not-yet-created meta doc is a
  // harmless no-op rather than an "no document to update" rejection.
  return setDoc(metaRef, { team: { [memberId]: deleteField() } }, { merge: true });
}

// Write only the settings portion of the meta doc, leaving team untouched.
export function dbSaveSettings(settings) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbSaveSettings: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const metaRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/meta/data`);
  // setDoc + merge:true creates-or-updates so settings can be saved even when
  // the meta doc was not created yet (year exists in room but has no plan).
  return setDoc(metaRef, { settings: JSON.parse(JSON.stringify(settings)) }, { merge: true });
}

export function dbAppendActivity(entry) {
  if (!db || !currentRoomCode || !currentYear) return Promise.resolve();
  const actRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/activity/${entry.id}`);
  const pureData = JSON.parse(JSON.stringify(entry));
  return setDoc(actRef, pureData);
}

// Record that this year exists inside the room (awaited by callers that need ordering)
export function dbAddYearToRoom(roomCode, year) {
  if (!db) return Promise.resolve();
  const roomRef = doc(db, `rooms/${roomCode}`);
  return setDoc(roomRef, { years: arrayUnion(year) }, { merge: true });
}

// Atomic helpers: use arrayUnion/arrayRemove to avoid overwriting concurrent changes
export function dbAssignStaff(eventId, userId) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbAssignStaff: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const eventRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/events/${eventId}`);
  return updateDoc(eventRef, { assignedStaff: arrayUnion(userId) });
}

export function dbUnassignStaff(eventId, userId) {
  if (!db || !currentRoomCode || !currentYear) {
    if (db) console.warn('dbUnassignStaff: missing room context — write dropped', { currentRoomCode, currentYear });
    return Promise.resolve();
  }
  const eventRef = doc(db, `rooms/${currentRoomCode}/plans/${currentYear}/events/${eventId}`);
  return updateDoc(eventRef, { assignedStaff: arrayRemove(userId) });
}
