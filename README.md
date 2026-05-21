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

**Activity log** — every assign, unassign, edit, close, reopen, and note action is recorded with a timestamp so you always know who changed what.

**PDF** — export the schedule as a PDF to print out and hang it on the wall.

**iCal export** — export the schedule as a `.ics` file, either for the whole team or filtered to specific people, ready to import into any calendar app.

## Development

```bash
# Generate JS bindings (run once after Go service changes)
wails3 generate bindings -b -d frontend/bindings

# Build and run (frontend served live from disk)
go build -o bin/einsatzplaner . && ./bin/einsatzplaner
```

Frontend changes (HTML/CSS/JS) are picked up immediately without rebuilding.

## Production build

```bash
# Linux
go build -tags production -ldflags="-w -s -X main.Version=v1.0.0" -o bin/einsatzplaner .

# Windows (cross-compile from Linux)
GOOS=windows GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc \
  go build -tags production -ldflags="-w -s -X main.Version=v1.0.0" -o bin/einsatzplaner.exe .
```

The `production` build tag embeds the entire `frontend/` directory into the binary —
no external files needed at runtime.
