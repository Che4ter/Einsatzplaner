# Frontend Refactoring Plan

Goal: shrink the 3,100-line `frontend/app.js` into small, single-responsibility
modules that are **maintainable** and **testable**, without changing behavior.
Decisions locked in with the maintainer:

- **Language:** migrate the frontend to **TypeScript** (a build step is acceptable).
- **Storage:** investigated first (see below). Conclusion: **keep the current
  outbox architecture, consolidate it — do not collapse it.**

---

## 1. Guiding principle — dependency direction

The single rule that makes the controller split work and avoids circular imports:

```
LEAVES (import nothing from app):   utils  render/  ui  services  state  dom  sync/
CONTROLLERS (import only downward):  navigation  event  member  location  time  export  fileops
COMPOSITION ROOT (imports + wiring): app.ts
```

Everything a controller needs (`state`, `Planner.*`, `showToast`, `refreshSidebar`)
must already be a leaf module **before** the controller is pulled out of `app.js`.
That is why the phases extract leaves first, controllers second, the thin entry last.

Two hard constraints:
- **TypeScript types the Go↔JS boundary.** The Wails bindings in
  `frontend/bindings/` are currently emitted as **untyped `.js`** (the only `.d.ts`
  is a Wails-internal `eventdata.d.ts`). Part of the tooling step is regenerating
  them as TS so `Planner.*` signatures and the `cloud:*` event payloads become
  compile-checked — contract drift becomes a build error, not a runtime cloud-sync bug.
- **Tests run under Vitest + jsdom.** This is the bigger half of "testable": today
  `node --test` only reaches DOM-free code; jsdom lets us test controllers and the
  sync relay against a fake DOM and mocked `Planner` / Firestore SDK.

### Verified build reality (today)

There is **no build step at all** right now:
- Wails v3 serves the `frontend/` directory as **static files** (`wails.json` has no
  frontend build/dev/install config).
- Firebase is loaded via an `<script type="importmap">` in `index.html` mapping
  `firebase/app` and `firebase/firestore` to the **gstatic CDN** (v12.14.0) — that is
  what resolves the bare specifiers, not a bundler.
- Root `package.json` has **zero dependencies**; its only script is `node --test`.
- Bindings are untyped `.js`.

So Phase 0 *introduces* a build pipeline (net-new), rather than adopting into an
existing one. The maintainer has approved adding a build step.

---

## 2. Current architecture (as built)

```
frontend/
  app.js          3142 lines — state, autosave, all page renderers, all
                  controllers, all DOM + Wails wiring, the cloud relay
  render.js       250  — pure HTML-string components (5 fns) ✓ already a leaf
  utils.js        116  — pure helpers ✓ leaf
  ui.js           54   — toast / modal / confirm DOM primitives ✓ leaf
  firebaseSync.js 385  — Firebase connection + transport + Firestore codec (mixed)
  _tests/         node --test, pure modules only
```

`app.js` sections: `1 SERVICE PROXY` (imports only — the banner is a lie today),
`2 STATE`, `3 PURE RENDER` (~820 lines, 6 page renderers), `4 CONTROLLERS`
(the bulk), `5 EVENT WIRING` (DOM binds + the cloud relay).

Coupling trapped in `app.js`: **99** `state.*`, **241** `getElementById`, **67** `Planner.*`.

### Storage / cloud-sync flow (outbox pattern — keep this)

```
WRITE (online):
  controller → Planner.UpdateEvent()           # Go mutates s.plan (source of truth)
             → Go EmitEvent("cloud:save-event") # planner_cloud.go, only if s.isOnline
  Events.On("cloud:save-event") → trackCloudWrite(FirebaseSync.dbSaveEvent())
             → Firestore (local cache immediate, server in background)
  own onSnapshot echo suppressed via hasPendingWrites

INBOUND (remote change):
  Firestore onSnapshot → SyncEventUpdate()/SyncMetaUpdate()  # Go bindings
             → Go mutates s.plan + EmitEvent("plan:cloud-event-changed")
  Events.On("plan:cloud-event-changed") → Planner.GetPlan() → state.plan → re-render
```

**Why the outbox stays:** `planner.go:825` — deleting a member loops every event
and emits one `cloud:toggle-staff` per assignment. The single Go mutation point
fans out to N cloud writes automatically. Collapsing the relay into JS controllers
would force every such cascade (and autosave, batch ops) to be re-mirrored by hand,
and would lose the "Go mirrors whatever Go did" guarantee. **Do not collapse.**

### Invariants the refactor MUST preserve (today only documented as prose)

- **assignedStaff is separate.** Update path (`dbSaveEvent`) strips it; create path
  (`dbSaveEventFull` via `cloud:create-event`) writes the full doc; toggles use
  atomic `arrayUnion`/`arrayRemove`. (See `cloud-sync-invariants` memory.)
- **Optional fields** (`dateEnd`, `comment`, `timeSetup`, `timeTeardown`) must be
  `deleteField()`'d when empty, or stale values persist.
- **Activity log** is restored by a one-shot `getDocs` on connect (append-only, no
  live listener) — must be read back or history is silently lost.
- **Team** is a map keyed by id in Firestore but an array in the domain model
  (`teamFromFirestore` / `Object.fromEntries`).
- **`hasPendingWrites`** guards against self-echo; **missing meta doc** is
  disambiguated (bootstrap vs deleted room) by the room root doc.
- Writes are **fire-and-forget** (cache-first); only bootstrap awaits ordering.

---

## 3. Target module layout

```
frontend/
  app.ts                  composition root: imports + DOM/Events wiring + boot
  state.ts                state getters/setters, autosave, dirty (+ pure decision fns)
  services.ts             typed proxy over Planner.* with error/toast (the real "service proxy")
  dom.ts                  el()/on()/val() helpers (shrinks 241 getElementById)
  ui.ts                   (existing ui.js) toast/modal/confirm
  utils.ts                (existing utils.js) pure helpers
  render/
    cards.ts              (existing render.js content)
    month.ts year.ts stats.ts settings.ts verlauf.ts nav.ts
    index.ts              re-exports (app import stays one line)
  controllers/
    navigation.ts event.ts member.ts location.ts time.ts export.ts fileops.ts
  sync/
    connection.ts         connectToCloud / disconnect / onSnapshot listeners
    transport.ts          db* Firestore writers (thin)
    codec.ts              Firestore-doc ↔ domain-model rules (PURE, unit-tested)
    relay.ts              cloud:* event → transport, as ONE typed table
    writeTracker.ts       trackCloudWrite + cloudWrites pill state
    rooms.ts              recent-rooms localStorage
    events.ts             typed CloudEvent map shared with the relay
  _tests/ or *.test.ts    Vitest
```

---

## 4. Phases (dependency-ordered; ship low-risk first)

Each phase: keep the app launching, run tests, smoke-test in Wails before moving on.

- [x] **Phase 0 — Introduce a build pipeline (net-new; see "Verified build reality").**
      - Add `frontend/package.json` with `vite`, `typescript`, `vitest`, `jsdom`,
        and `firebase` (moving it from the CDN importmap to an npm dependency).
      - Add `tsconfig.json` (`strict`, `allowJs` on for gradual migration) and a
        `vite.config.ts`.
      - **Wire Wails to the build:** add frontend `install` / `build` / `dev`
        commands to `wails.json` so Wails embeds Vite's `dist/` output instead of
        the raw `frontend/` dir. (Confirm the exact Wails v3 mechanism for the
        installed version — Taskfile vs. wails.json hooks.)
      - **Regenerate bindings as TypeScript** (`wails3 generate bindings -ts` or
        equivalent) so `services.ts` can type the 67-call `Planner.*` surface.
      - Once bundled, the `index.html` importmap for Firebase is removed (Vite
        resolves `firebase/*`).
      - Port existing `_tests` to Vitest. No logic changes. Prove: `vite build`
        produces the embedded frontend, `vitest` runs green, the Wails app launches.

      **Decision point:** full Vite bundle for the shipped app (recommended now that
      a build is sanctioned — consistent, tree-shaken, no CDN dependency) **vs.**
      keep the importmap/CDN for the shipped app and use Vite/Vitest only for
      typecheck + tests (lighter, app stays unbundled, but two resolution paths).
- [x] **Phase 1 — `render/` folder.** Move the 6 page renderers out of `app.js`
      section 3 into per-page files; convert to `.ts`; add a test per renderer.
      Pure moves, zero behavior risk.
- [x] **Phase 2 — `services.ts`.** Wrap the 67 `Planner.*` calls with the
      error/toast handling currently inlined. Typed against the bindings. Make the
      "SERVICE PROXY" banner true.
- [x] **Phase 3 — `sync/` module (storage consolidation).**
      - `sync/events.ts`: a typed `CloudEvent` discriminated union for every
        `cloud:*` / `plan:cloud-*` payload.
      - `sync/codec.ts`: pull the Firestore-doc rules (assignedStaff strip/keep,
        optional-field delete, team array↔map, month-range validation) into PURE
        functions and **unit-test them** — this is the riskiest logic in the app.
      - `sync/transport.ts`, `sync/connection.ts`: split today's `firebaseSync.js`.
      - `sync/relay.ts`: replace the scattered `Events.On('cloud:*')` handlers with
        one typed event→transport table.
      - `sync/writeTracker.ts`, `sync/rooms.ts`: move `trackCloudWrite` /
        `cloudWrites` pill / recent-rooms localStorage out of `app.js`.
      Slow down here; lean on the typed contract + invariants in §2.
- [x] **Phase 4 — `state.ts` + `dom.ts`.** State as a leaf with getters/setters,
      autosave, dirty. Pull *decidable* logic (autosave scheduling, conflict /
      external-change resolution) into PURE functions and test them. Keep plain
      getters/setters — **not** reactive pub/sub — unless a concrete need appears.
      Add `dom.ts` helpers.
- [x] **Phase 5 — Controllers.** Lift section-4 groups into `controllers/*`,
      importing only downward from leaves. Add jsdom tests for the gnarly flows
      (event modal, quick-assign, conflict handling).
- [x] **Phase 6 — Thin `app.ts`.** What remains is imports + DOM/`Events.On`
      wiring + boot. Target a few hundred readable lines.

### Risk / sequencing

| Phase | Risk | Payoff |
|------|------|--------|
| 0 Tooling | low (no logic) | unlocks TS + jsdom tests |
| 1 render/ | none | tests every page |
| 2 services | low | de-dups 67 call sites |
| 3 sync/ | **medium** | **fixes the drift risk; tests the trickiest code** |
| 4 state/dom | medium | testable autosave/conflict logic |
| 5 controllers | medium | jsdom-testable features |
| 6 app.ts | low | readable entry |

Phases 0–2 are independently mergeable. Phase 3 is the heart of the storage work.

---

## 5. Testing strategy

- **Pure (Vitest, no DOM):** `utils`, `render/*`, `sync/codec`, the `state` decision
  functions. Highest value-per-effort; covers the storage rules that are currently
  untested prose.
- **jsdom (Vitest):** controllers and `sync/relay`, with `Planner` and the Firestore
  SDK mocked. Lets us assert e.g. "deleting a member emits N toggle writes" without
  a live backend.
- **Contract:** TS types over the Wails bindings catch Go↔JS payload drift at build.

---

## 6. Open question (not blocking)

Inbound changes route Firestore → JS → Go (`SyncEventUpdate`) → Go emits → JS
(`GetPlan`) → render. The JS listener already holds the event; the Go round-trip
exists to keep `s.plan` authoritative. Worth confirming during Phase 3 whether that
round-trip is load-bearing or can be shortened — but only with the typed contract
and tests in place first.
