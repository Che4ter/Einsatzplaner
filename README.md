# Einsatzplaner — Desktop App

Shift-planning desktop app for clubs, community centres, and small teams.
Plan events across the full year, assign team members, and track who did what.

Built with Go + Wails v3. Single binary, no install, runs on Linux and Windows.

## Features

**Year plan** — one JSON file per calendar year. Create a new plan or open an existing one. Recent files are remembered for quick access.

**Event management** — create, edit, and delete events per month. Three event types: Wednesday shifts, other weekday shifts, and weekend blocks (Sat+Sun counted as one multi-day event). Each event has a date (+ optional end date), location, time window, required headcount, and a free-text comment.

**Staff assignment** — toggle team members on/off for each event with one click. The app tracks how many slots are filled vs. required and shows per-person statistics (total shifts, weekday/weekend split) for any month or the whole year.

**Team management** — add, edit, and deactivate team members. Each member gets a colour for quick identification in the calendar view. Deactivated members are hidden from assignment but their history is preserved.

**Locations & time presets** — configure your team's default locations and time-slot presets in settings so you're not typing the same values every time.

**Activity log** — every assign, unassign, edit, close, reopen, and note action is recorded with a timestamp so you always know who changed what. The most recent 400 entries per year are loaded on connect.

**PDF** — export the schedule as a PDF to print out and hang it on the wall.

**iCal export** — export the schedule as a `.ics` file, either for the whole team or filtered to specific people, ready to import into any calendar app.

**Cloud sync** — optionally sync your plan in real time via Firestore. Multiple people can work on the same plan simultaneously; changes appear live for all connected clients. See [Cloud sync](#cloud-sync) below.

---

## Cloud sync

Cloud sync is an **optional** feature that must be enabled at build time by injecting a Firebase project ID and API key. Binaries built without these values run in local-only mode and show no cloud UI.

### How it works

- Each team gets a **room code** — a private UUID v4 you generate and share. Anyone with the same code and a cloud-enabled binary can read and write the plan.
- Every mutation (event create/update/delete, staff toggle, settings change) is written directly to Firestore as a granular document update, keeping bandwidth and free-tier usage low.
- A real-time watch stream (Firestore Listen API) pushes incremental changes back to all connected clients instantly.
- The room code is the only secret. The Firebase API key is safe to embed in a public binary — it only identifies the project, not the user.

### Using the hosted instance

A hosted cloud instance is available baked into published releases. To connect:

1. Click **Connect** in the sidebar
2. Click **Generate Code** to create a new room code (or paste an existing one shared by a colleague)
3. Click **Verbinden**, then create or select a year

> **Disclaimer — free hobby project**
>
> The hosted Firestore backend is provided as a free, best-effort service for small teams.
> I reserve the right to remove individual rooms, suspend access for specific teams, or
> shut down the service entirely at any time and without prior notice.
> Export your plan regularly using the **Export → JSON** option so you always have a local copy.
> If you need a guaranteed, independent setup, host your own Firebase project (see below).

---

## Self-hosting: set up your own Firebase project

Follow these steps to run the cloud sync against your own Firebase project, independent of any hosted instance.

### 1. Create the project

1. Go to <https://console.firebase.google.com> → **Add project**
2. Give it a name, disable Google Analytics if you don't need it
3. Sidebar: **Build → Firestore Database → Create database**
   - Choose **production mode**
   - Pick a region (e.g. `europe-west1`)

### 2. Get your credentials

You need two values:

| Value | Where to find it |
|---|---|
| **Project ID** | Shown in the Firebase console URL: `.../project/<PROJECT_ID>/...` and on the project overview page |
| **Web API Key** | **Project Settings** (gear icon top-left) → **General** tab → **Web API Key** field at the top of the page |

> You do **not** need to register a Web App — the Web API Key is always visible on the General settings page.

### 3. Deploy the security rules

```sh
# Install Firebase CLI (once)
npm install -g firebase-tools
firebase login

# Deploy the rules bundled with this repo
./firebase/manage-firebase.sh <PROJECT_ID>
```

All Firebase-related files live in the [`firebase/`](firebase/) directory:

| File | Purpose |
|---|---|
| `firebase/firestore.rules` | Firestore security rules |
| `firebase/firebase.json` | Firebase project config (rules pointer) |
| `firebase/manage-firebase.sh` | Management CLI (deploy, list rooms, backup, …) |

The rules in [`firebase/firestore.rules`](firebase/firestore.rules) enforce:
- Rooms **cannot be listed** — prevents enumeration of room codes
- Only a client that knows the exact 36-character UUID room code can read or write that room's data
- Activity log entries can be created but **not deleted or overwritten**

#### `manage-firebase.sh` commands

```sh
# Show help
./firebase/manage-firebase.sh help

# Deploy rules (default command)
./firebase/manage-firebase.sh <PROJECT_ID>
./firebase/manage-firebase.sh <PROJECT_ID> deploy-rules

# List all room codes in the project
./firebase/manage-firebase.sh <PROJECT_ID> list-rooms

# Export a room's plans to a local JSON backup
./firebase/manage-firebase.sh <PROJECT_ID> export-room <ROOM_CODE>

# Restore a room from a backup
./firebase/manage-firebase.sh <PROJECT_ID> import-room room-export-<ROOM_CODE>.json

# Permanently delete a room (prompts for confirmation)
./firebase/manage-firebase.sh <PROJECT_ID> delete-room <ROOM_CODE>
```

### 4. Build with your credentials

Pass the values via `-ldflags` at build time:

```sh
# Development build
go build \
  -ldflags "-X main.FirestoreProjectID=<PROJECT_ID> -X main.FirestoreAPIKey=<API_KEY>" \
  -o bin/einsatzplaner .

# Production build (Linux)
go build -tags production \
  -ldflags "-w -s -X main.Version=v1.0.0 -X main.FirestoreProjectID=<PROJECT_ID> -X main.FirestoreAPIKey=<API_KEY>" \
  -o bin/einsatzplaner .

# Production build (Windows cross-compile from Linux)
GOOS=windows GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc \
  go build -tags production \
  -ldflags "-w -s -X main.Version=v1.0.0 -X main.FirestoreProjectID=<PROJECT_ID> -X main.FirestoreAPIKey=<API_KEY>" \
  -o bin/einsatzplaner.exe .
```

Binaries built **without** the ldflags show no Connect button and behave as a pure local app.

### Free-tier limits (Firebase Spark plan)

| Operation | Daily limit |
|---|---|
| Reads | 50,000 |
| Deletes | 20,000 |
| Writes | 20,000 |

For a small team with one or two active plans this is effectively unlimited in normal use. The built-in reconnect budget (max 8 reconnects per 5-minute window, exponential back-off) prevents runaway usage on flaky connections.

---

## Development

### First-time setup (after cloning)

```bash
# 1. Fetch Go dependencies
go mod tidy

# 2. Generate Wails JS bindings (also re-run when Go service signatures change)
#    -b: use bundled runtime path (/wails/runtime.js)
go run github.com/wailsapp/wails/v3/cmd/wails3 generate bindings -b

# 3. Install frontend npm dependencies and do an initial build
cd frontend && npm install && npm run build && cd ..
```

> **Note:** `go build` embeds `frontend/dist/` — that directory must exist before
> the Go build runs. Steps 2 and 3 above create it.

### Day-to-day dev workflow

The app serves `frontend/dist/` from disk in dev mode, so you only need to rebuild
the Go binary when Go source changes. Frontend changes are applied by rebuilding the
Vite bundle (fast, ~1 s) and reloading the window.

**Terminal 1 — watch for frontend changes:**

```bash
cd frontend && npm run build:watch
```

**Terminal 2 — run the app:**

```bash
go build -o bin/einsatzplaner . && ./bin/einsatzplaner
```

After saving a frontend file, wait for Vite to finish (you'll see `✓ built in …` in
Terminal 1), then press **Ctrl + R** in the app window to reload (or use the
DevTools → Reload option if DevTools are open).

To enable cloud sync during development:

```bash
go build \
  -ldflags "-X main.FirestoreProjectID=<PROJECT_ID> -X main.FirestoreAPIKey=<API_KEY>" \
  -o bin/einsatzplaner . && ./bin/einsatzplaner
```

### Frontend tests

```bash
cd frontend
npm test           # run once
npm run test:watch # watch mode
npm run typecheck  # TypeScript type-check (no emit)
```

## Production build

The `production` build tag embeds `frontend/dist/` into the binary. Build the
frontend first:

```bash
# 1. Build frontend bundle
cd frontend && npm run build && cd ..

# 2. Build Go binary — Linux
go build -tags production -ldflags="-w -s -X main.Version=v1.0.0" -o bin/einsatzplaner .

# 2. Build Go binary — Windows (cross-compile from Linux)
GOOS=windows GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc \
  go build -tags production -ldflags="-w -s -X main.Version=v1.0.0" -o bin/einsatzplaner.exe .
```
