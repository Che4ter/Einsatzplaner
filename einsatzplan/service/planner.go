package service

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/storage"
)

const maxRecentPaths = 3

// PlannerService is the single Wails-bound service. All frontend calls go here.
// It owns the in-memory plan and delegates persistence to the Store.
// mu protects plan, path, and dirty which are accessed from multiple goroutines
// (Wails IPC goroutines + the window-close event goroutine).
type PlannerService struct {
	mu      sync.RWMutex
	app     *application.App
	win     application.Window
	store   storage.Store
	plan    *domain.YearPlan
	path    string
	dirty   bool
	version string
}

// NewPlannerService constructs the service with the given dependencies.
// Pass nil for app/win in tests.
func NewPlannerService(app *application.App, win application.Window, store storage.Store) *PlannerService {
	return &PlannerService{app: app, win: win, store: store}
}

// SetVersion stores the application version injected at build time.
func (s *PlannerService) SetVersion(v string) { s.version = v }

// GetVersion returns the application version (e.g. "v1.2.3" or "dev").
func (s *PlannerService) GetVersion() string { return s.version }

// ── File operations ──────────────────────────────────────────────────────────

// CreatePlan initialises a blank plan for the given year and saves it via
// a native Save-As dialog. Returns the new plan on success.
func (s *PlannerService) CreatePlan(ctx context.Context, year int) (*domain.YearPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	plan := storage.NewYearPlan(year)
	path, err := s.saveAsDialog(fmt.Sprintf("einsatzplan-%d.json", year), plan)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil // user cancelled
	}
	s.plan = plan
	return storage.CopyPlan(s.plan), nil
}

// OpenPlan shows a native open dialog, loads and returns the plan.
func (s *PlannerService) OpenPlan(ctx context.Context) (*domain.YearPlan, error) {
	if s.app == nil {
		return nil, fmt.Errorf("no app context")
	}
	dlg := s.app.Dialog.OpenFile().
		SetTitle("Einsatzplan öffnen").
		AddFilter("Einsatzplan (JSON)", "*.json")
	if s.win != nil {
		dlg = dlg.AttachToWindow(s.win)
	}
	path, err := dlg.PromptForSingleSelection()
	if err != nil || path == "" {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadFromPath(ctx, path)
}

// ReopenPlan loads the plan at the given path directly (used for last-file restore).
func (s *PlannerService) ReopenPlan(ctx context.Context, path string) (*domain.YearPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadFromPath(ctx, path)
}

// SavePlan writes the current plan to its existing path.
func (s *PlannerService) SavePlan(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.plan == nil {
		return fmt.Errorf("no plan loaded")
	}
	if s.path == "" {
		_, err := s.saveAsDialog(fmt.Sprintf("einsatzplan-%d.json", s.plan.Year), s.plan)
		return err
	}
	if err := s.store.Save(s.path, s.plan); err != nil {
		return err
	}
	s.dirty = false
	return nil
}

// SavePlanAs opens a native Save-As dialog and writes the plan.
// Returns the chosen path so the frontend can update its filename display.
func (s *PlannerService) SavePlanAs(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.plan == nil {
		return "", fmt.Errorf("no plan loaded")
	}
	suggested := fmt.Sprintf("einsatzplan-%d.json", s.plan.Year)
	return s.saveAsDialog(suggested, s.plan)
}

// GetCurrentFileName returns just the base filename of the currently open file,
// or an empty string when no file is loaded.
func (s *PlannerService) GetCurrentFileName(_ context.Context) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.path == "" {
		return ""
	}
	return filepath.Base(s.path)
}

// GetPlan returns a deep copy of the current plan (for initial render after load).
func (s *PlannerService) GetPlan(ctx context.Context) *domain.YearPlan {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil {
		return nil
	}
	return storage.CopyPlan(s.plan)
}

// IsDirty returns whether there are unsaved changes.
func (s *PlannerService) IsDirty(ctx context.Context) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.dirty
}

// GetRecentPaths returns the up to 3 most recently opened file paths that still exist on disk.
func (s *PlannerService) GetRecentPaths(_ context.Context) []string {
	paths := loadRecentPaths()
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}

// AddRecentPath prepends path to the recent list, deduplicates, and trims to 3.
// Called by the frontend after any successful open or create.
func (s *PlannerService) AddRecentPath(_ context.Context, path string) {
	if path == "" {
		return
	}
	paths := loadRecentPaths()
	paths = prependUnique(paths, path)
	saveRecentPaths(paths)
}

// ── Queries ──────────────────────────────────────────────────────────────────

// GetMonthEvents returns all events for the given month (1–12).
func (s *PlannerService) GetMonthEvents(ctx context.Context, month int) []domain.Event {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil || month < 1 || month > 12 {
		return []domain.Event{}
	}
	return slices.Clone(s.plan.Months[month].Events)
}

// GetMonthSummaries returns sidebar badge data for all 12 months.
func (s *PlannerService) GetMonthSummaries(ctx context.Context) map[int]domain.MonthSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil {
		return map[int]domain.MonthSummary{}
	}
	return domain.CalcAllMonthSummaries(s.plan)
}

// GetYearStats returns the four stat-card numbers.
// month=0 means all months; 1–12 filters to that month.
func (s *PlannerService) GetYearStats(ctx context.Context, month int) domain.YearStats {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil {
		return domain.YearStats{}
	}
	return domain.CalcYearStats(s.eventsForFilter(month))
}

// GetPersonStats returns the per-person bar chart data.
func (s *PlannerService) GetPersonStats(ctx context.Context, month int) []domain.PersonStat {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil {
		return []domain.PersonStat{}
	}
	return domain.CalcPersonStats(s.plan.Team, s.eventsForFilter(month))
}

// GetActivityLog returns the full activity log (newest first).
func (s *PlannerService) GetActivityLog(ctx context.Context) []domain.ActivityEntry {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil {
		return []domain.ActivityEntry{}
	}
	return slices.Clone(s.plan.ActivityLog)
}

// ── Event mutations ──────────────────────────────────────────────────────────

// CreateEvent adds a new event to the given month. Returns the new event's ID.
func (s *PlannerService) CreateEvent(ctx context.Context, month int, ev domain.Event) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return "", err
	}
	if err := validateMonth(month); err != nil {
		return "", err
	}
	if err := domain.ValidateEvent(ev, s.plan.Year); err != nil {
		return "", err
	}
	ev.ID = generateID()
	if ev.AssignedStaff == nil {
		ev.AssignedStaff = []string{}
	}
	s.plan.Months[month].Events = append(s.plan.Months[month].Events, ev)
	appendActivity(s.plan, domain.ActivityEntry{
		ID:     generateID(),
		At:     timestamp(),
		Action: domain.ActionCreate,
		Target: targetFrom(month, ev),
	})
	s.markDirty()
	return ev.ID, nil
}

// UpdateEvent replaces an existing event (matched by ID) in the given month.
func (s *PlannerService) UpdateEvent(ctx context.Context, month int, ev domain.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	if err := validateMonth(month); err != nil {
		return err
	}
	if err := domain.ValidateEvent(ev, s.plan.Year); err != nil {
		return err
	}
	events := s.plan.Months[month].Events
	idx := slices.IndexFunc(events, func(e domain.Event) bool { return e.ID == ev.ID })
	if idx < 0 {
		return fmt.Errorf("event %q not found in month %d", ev.ID, month)
	}
	old := events[idx]
	if ev.AssignedStaff == nil {
		ev.AssignedStaff = []string{}
	}
	s.plan.Months[month].Events[idx] = ev

	// Log the most notable field change.
	entry := domain.ActivityEntry{
		ID:     generateID(),
		At:     timestamp(),
		Action: domain.ActionEdit,
		Target: targetFrom(month, ev),
	}
	// Collect per-person assign/unassign entries when the staff list changed via
	// the edit dialog (mirrors what ToggleStaff logs for individual toggles).
	oldStaff := slices.Clone(old.AssignedStaff)
	newStaff := slices.Clone(ev.AssignedStaff)
	var staffEntries []domain.ActivityEntry
	for _, id := range oldStaff {
		if !slices.Contains(newStaff, id) {
			staffEntries = append(staffEntries, domain.ActivityEntry{
				ID:     generateID(),
				At:     timestamp(),
				Action: domain.ActionUnassign,
				Target: targetFrom(month, ev),
				Person: id,
			})
		}
	}
	for _, id := range newStaff {
		if !slices.Contains(oldStaff, id) {
			staffEntries = append(staffEntries, domain.ActivityEntry{
				ID:     generateID(),
				At:     timestamp(),
				Action: domain.ActionAssign,
				Target: targetFrom(month, ev),
				Person: id,
			})
		}
	}

	switch {
	case old.IsClosed != ev.IsClosed:
		if ev.IsClosed {
			entry.Action = domain.ActionClose
			entry.Reason = ev.Comment
		} else {
			entry.Action = domain.ActionReopen
		}
	case old.Location != ev.Location:
		entry.Field = "location"
		entry.From = old.Location
		entry.To = ev.Location
	case old.TimeFrom != ev.TimeFrom || old.TimeTo != ev.TimeTo:
		entry.Field = "time"
		entry.From = old.TimeFrom + "–" + old.TimeTo
		entry.To = ev.TimeFrom + "–" + ev.TimeTo
	case old.Date != ev.Date:
		entry.Field = "date"
		entry.From = old.Date
		entry.To = ev.Date
	case old.DateEnd != ev.DateEnd:
		entry.Field = "dateEnd"
		entry.From = old.DateEnd
		entry.To = ev.DateEnd
	case old.StaffRequired != ev.StaffRequired:
		entry.Field = "staffRequired"
		entry.From = fmt.Sprintf("%d", old.StaffRequired)
		entry.To = fmt.Sprintf("%d", ev.StaffRequired)
	case old.Comment != ev.Comment:
		entry.Field = "comment"
		entry.From = old.Comment
		entry.To = ev.Comment
	case old.Type != ev.Type:
		entry.Field = "type"
		entry.From = old.Type
		entry.To = ev.Type
	}

	fieldChanged := entry.Field != "" || entry.Action == domain.ActionClose || entry.Action == domain.ActionReopen

	for _, e := range staffEntries {
		appendActivity(s.plan, e)
	}
	if fieldChanged {
		appendActivity(s.plan, entry)
	}
	s.markDirty()
	return nil
}

// DeleteEvent removes an event by ID from the given month.
func (s *PlannerService) DeleteEvent(ctx context.Context, month int, eventID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	if err := validateMonth(month); err != nil {
		return err
	}
	events := s.plan.Months[month].Events
	idx := slices.IndexFunc(events, func(e domain.Event) bool { return e.ID == eventID })
	if idx < 0 {
		return fmt.Errorf("event %q not found in month %d", eventID, month)
	}
	ev := events[idx]
	s.plan.Months[month].Events = slices.Delete(events, idx, idx+1)
	appendActivity(s.plan, domain.ActivityEntry{
		ID:     generateID(),
		At:     timestamp(),
		Action: domain.ActionDelete,
		Target: targetFrom(month, ev),
	})
	s.markDirty()
	return nil
}

// ToggleStaff assigns or unassigns a team member from an event.
// Returns the updated AssignedStaff slice.
func (s *PlannerService) ToggleStaff(ctx context.Context, month int, eventID, memberID string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return nil, err
	}
	if err := validateMonth(month); err != nil {
		return nil, err
	}
	if !slices.ContainsFunc(s.plan.Team, func(t domain.TeamMember) bool { return t.ID == memberID }) {
		return nil, fmt.Errorf("member %q not found in team", memberID)
	}
	events := s.plan.Months[month].Events
	idx := slices.IndexFunc(events, func(e domain.Event) bool { return e.ID == eventID })
	if idx < 0 {
		return nil, fmt.Errorf("event %q not found", eventID)
	}
	ev := &s.plan.Months[month].Events[idx]
	action := domain.ActionAssign
	if slices.Contains(ev.AssignedStaff, memberID) {
		ev.AssignedStaff = slices.DeleteFunc(ev.AssignedStaff, func(id string) bool { return id == memberID })
		action = domain.ActionUnassign
	} else {
		ev.AssignedStaff = append(ev.AssignedStaff, memberID)
	}
	appendActivity(s.plan, domain.ActivityEntry{
		ID:     generateID(),
		At:     timestamp(),
		Action: action,
		Target: targetFrom(month, *ev),
		Person: memberID,
	})
	s.markDirty()
	return slices.Clone(ev.AssignedStaff), nil
}

// ── Team mutations ───────────────────────────────────────────────────────────

// CreateMember adds a team member. Returns the new member's ID.
func (s *PlannerService) CreateMember(ctx context.Context, m domain.TeamMember) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return "", err
	}
	if err := domain.ValidateTeamMember(m); err != nil {
		return "", err
	}
	m.ID = generateID()
	s.plan.Team = append(s.plan.Team, m)
	s.markDirty()
	return m.ID, nil
}

// UpdateMember replaces a team member (matched by ID).
func (s *PlannerService) UpdateMember(ctx context.Context, m domain.TeamMember) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	if err := domain.ValidateTeamMember(m); err != nil {
		return err
	}
	idx := slices.IndexFunc(s.plan.Team, func(t domain.TeamMember) bool { return t.ID == m.ID })
	if idx < 0 {
		return fmt.Errorf("member %q not found", m.ID)
	}
	s.plan.Team[idx] = m
	s.markDirty()
	return nil
}

// ToggleMemberActive flips the active flag for a team member.
func (s *PlannerService) ToggleMemberActive(ctx context.Context, memberID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	idx := slices.IndexFunc(s.plan.Team, func(t domain.TeamMember) bool { return t.ID == memberID })
	if idx < 0 {
		return fmt.Errorf("member %q not found", memberID)
	}
	s.plan.Team[idx].Active = !s.plan.Team[idx].Active
	s.markDirty()
	return nil
}

// DeleteMember removes a team member by ID and scrubs their ID from every event's AssignedStaff.
func (s *PlannerService) DeleteMember(ctx context.Context, memberID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	idx := slices.IndexFunc(s.plan.Team, func(t domain.TeamMember) bool { return t.ID == memberID })
	if idx < 0 {
		return fmt.Errorf("member %q not found", memberID)
	}
	s.plan.Team = slices.Delete(s.plan.Team, idx, idx+1)
	// Remove orphan references from all events.
	for month := 1; month <= 12; month++ {
		mo := s.plan.Months[month]
		if mo == nil {
			continue
		}
		for i := range mo.Events {
			mo.Events[i].AssignedStaff = slices.DeleteFunc(
				mo.Events[i].AssignedStaff,
				func(id string) bool { return id == memberID },
			)
		}
	}
	s.markDirty()
	return nil
}

// ── Settings mutations ───────────────────────────────────────────────────────

// UpdateSettings replaces the plan settings.
func (s *PlannerService) UpdateSettings(ctx context.Context, settings domain.Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	s.plan.Settings = settings
	s.markDirty()
	return nil
}

// ── Internals ────────────────────────────────────────────────────────────────

func validateMonth(month int) error {
	if month < 1 || month > 12 {
		return fmt.Errorf("month %d out of range [1,12]", month)
	}
	return nil
}

func (s *PlannerService) requirePlan() error {
	if s.plan == nil {
		return fmt.Errorf("no plan loaded")
	}
	return nil
}

func (s *PlannerService) markDirty() {
	s.dirty = true
}

// SetApp and SetWindow are called from main() after the Wails app is built.
// They are NOT exposed as Wails bindings (no context.Context parameter).
func (s *PlannerService) SetApp(app *application.App)      { s.app = app }
func (s *PlannerService) SetWindow(win application.Window) { s.win = win }

// IsDirtySync returns the dirty flag synchronously (for the close-guard hook).
func (s *PlannerService) IsDirtySync() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.dirty
}

// ClearDirty resets the dirty flag (called when the user confirms discard).
func (s *PlannerService) ClearDirty() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dirty = false
}

func (s *PlannerService) eventsForFilter(month int) []domain.Event {
	if month == 0 {
		var count int
		for m := 1; m <= 12; m++ {
			if s.plan.Months[m] != nil {
				count += len(s.plan.Months[m].Events)
			}
		}
		all := make([]domain.Event, 0, count)
		for m := 1; m <= 12; m++ {
			if s.plan.Months[m] != nil {
				all = append(all, s.plan.Months[m].Events...)
			}
		}
		return all
	}
	if s.plan.Months[month] == nil {
		return nil
	}
	return slices.Clone(s.plan.Months[month].Events)
}

func (s *PlannerService) loadFromPath(_ context.Context, path string) (*domain.YearPlan, error) {
	plan, err := s.store.Load(path)
	if err != nil {
		return nil, err
	}
	s.plan = plan
	s.path = path
	s.dirty = false
	saveRecentPaths(prependUnique(loadRecentPaths(), path))
	return storage.CopyPlan(s.plan), nil
}

func (s *PlannerService) saveAsDialog(suggested string, plan *domain.YearPlan) (string, error) {
	if s.app == nil {
		return "", fmt.Errorf("no app context")
	}
	sdlg := s.app.Dialog.SaveFile()
	sdlg.SetOptions(&application.SaveFileDialogOptions{
		Title:    "Einsatzplan speichern",
		Filename: suggested,
	})
	sdlg = sdlg.AddFilter("Einsatzplan (JSON)", "*.json")
	if s.win != nil {
		sdlg = sdlg.AttachToWindow(s.win)
	}
	path, err := sdlg.PromptForSingleSelection()
	if err != nil || path == "" {
		return path, err
	}
	if err := s.store.Save(path, plan); err != nil {
		return "", err
	}
	s.path = path
	s.dirty = false
	saveRecentPaths(prependUnique(loadRecentPaths(), path))
	return path, nil
}

func targetFrom(month int, ev domain.Event) domain.ActivityTarget {
	return domain.ActivityTarget{
		Month:    month,
		EventID:  ev.ID,
		Date:     ev.Date,
		Location: ev.Location,
		Type:     ev.Type,
	}
}

func recentPathsFile() (string, bool) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", false
	}
	return filepath.Join(dir, "einsatzplan", "recent-paths.json"), true
}

func loadRecentPaths() []string {
	p, ok := recentPathsFile()
	if !ok {
		return nil
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return nil
	}
	var paths []string
	if err := json.Unmarshal(data, &paths); err != nil {
		return nil
	}
	return paths
}

func saveRecentPaths(paths []string) {
	p, ok := recentPathsFile()
	if !ok {
		return
	}
	_ = os.MkdirAll(filepath.Dir(p), 0755)
	data, err := json.Marshal(paths)
	if err != nil {
		return
	}
	_ = os.WriteFile(p, data, 0600)
}

// prependUnique puts path at the front, removes any existing duplicate, and caps at 3.
// Paths are cleaned with filepath.Clean before comparison.
func prependUnique(paths []string, path string) []string {
	path = filepath.Clean(path)
	out := make([]string, 0, maxRecentPaths+1)
	out = append(out, path)
	for _, p := range paths {
		if filepath.Clean(p) != path {
			out = append(out, p)
		}
	}
	if len(out) > maxRecentPaths {
		out = out[:maxRecentPaths]
	}
	return out
}

// ── iCal export ──────────────────────────────────────────────────────────────

// ExportICal generates an iCal (.ics) file and saves it via a native Save-As dialog.
//
// personIDs controls which events are included:
//   - non-empty slice: only events where at least one of the given members is assigned
//   - nil: all events regardless of assignment
func (s *PlannerService) ExportICal(ctx context.Context, personIDs []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	if s.app == nil {
		return fmt.Errorf("no app context")
	}

	allPersons := personIDs == nil
	content := buildICal(s.plan, personIDs, allPersons)

	sdlg := s.app.Dialog.SaveFile()
	sdlg.SetOptions(&application.SaveFileDialogOptions{
		Title:    "Kalender exportieren",
		Filename: fmt.Sprintf("einsatzplan-%d.ics", s.plan.Year),
	})
	sdlg = sdlg.AddFilter("iCal Kalender", "*.ics")
	if s.win != nil {
		sdlg = sdlg.AttachToWindow(s.win)
	}
	path, err := sdlg.PromptForSingleSelection()
	if err != nil || path == "" {
		return err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".ics") {
		path += ".ics"
	}
	return os.WriteFile(path, []byte(content), 0600)
}
