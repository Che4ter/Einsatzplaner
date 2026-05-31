package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"golang.org/x/mod/semver"

	"github.com/pkg/browser"
	"github.com/wailsapp/wails/v3/pkg/application"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/storage"
)

const maxRecentPaths = 3

// PlannerService is the single Wails-bound service. All frontend calls go here.
// It owns the in-memory plan and delegates persistence to the Store.
// mu protects plan, path, dirty, and loadedMtime which are accessed from multiple goroutines
// (Wails IPC goroutines + the window-close event goroutine).
type PlannerService struct {
	mu          sync.RWMutex
	app         *application.App
	win         *application.WebviewWindow
	store       storage.Store
	plan        *domain.YearPlan
	path        string
	dirty       bool
	version     string
	loadedMtime time.Time          // mtime of file when last loaded or saved
	pollCancel  context.CancelFunc // stops the background file-change poller
}

// NewPlannerService constructs the service with the given dependencies.
// Pass nil for app/win in tests.
func NewPlannerService(app *application.App, win *application.WebviewWindow, store storage.Store) *PlannerService {
	return &PlannerService{app: app, win: win, store: store}
}

// SetVersion stores the application version injected at build time.
func (s *PlannerService) SetVersion(v string) { s.version = v }

// GetVersion returns the application version (e.g. "v1.2.3" or "dev").
func (s *PlannerService) GetVersion() string { return s.version }

// CheckForUpdate queries the GitHub releases API and returns the latest tag
// name if it is strictly newer than the running version, or "" when already
// up to date, running a dev build, or on any network/parse error.
func (s *PlannerService) CheckForUpdate() string {
	if s.version == "" || s.version == "dev" || !semver.IsValid(s.version) {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://api.github.com/repos/Che4ter/Einsatzplaner/releases/latest", nil)
	if err != nil {
		return ""
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&payload); err != nil {
		return ""
	}
	if semver.IsValid(payload.TagName) && semver.Compare(payload.TagName, s.version) > 0 {
		return payload.TagName
	}
	return ""
}

// OpenURL opens the given URL in the system default browser.
func (s *PlannerService) OpenURL(url string) {
	_ = browser.OpenURL(url)
}

// ── File operations ──────────────────────────────────────────────────────────

// CreatePlan initialises a blank plan for the given year and saves it via
// a native Save-As dialog. Returns the new plan on success.
func (s *PlannerService) CreatePlan(ctx context.Context, year int) (*domain.YearPlan, error) {
	plan := storage.NewYearPlan(year)
	// Show dialog without holding the mutex to avoid deadlock with the close-guard.
	path, err := s.showSaveDialog(fmt.Sprintf("einsatzplan-%d.json", year), plan)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil // user cancelled
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.plan = plan
	s.path = path
	s.dirty = false
	if info, err2 := os.Stat(path); err2 == nil {
		s.loadedMtime = info.ModTime()
	}
	s.restartPoller(path)
	return storage.CopyPlan(s.plan), nil
}

// PickTemplateFile shows a native open-file dialog restricted to JSON files and
// returns the selected path, or an empty string if the user cancels.
func (s *PlannerService) PickTemplateFile(ctx context.Context) (string, error) {
	if s.app == nil {
		return "", fmt.Errorf("no app context")
	}
	dlg := s.app.Dialog.OpenFile().
		SetTitle("Vorlage auswählen").
		AddFilter("Einsatzplan (JSON)", "*.json")
	if s.win != nil {
		dlg = dlg.AttachToWindow(s.win)
	}
	return dlg.PromptForSingleSelection()
}

// CreatePlanFromTemplate creates a blank plan for year but pre-fills Settings
// and Team from the JSON file at templatePath. The user is then prompted for a
// save location via a native Save-As dialog.
func (s *PlannerService) CreatePlanFromTemplate(ctx context.Context, year int, templatePath string) (*domain.YearPlan, error) {
	tmpl, err := s.store.Load(templatePath)
	if err != nil {
		return nil, fmt.Errorf("Vorlage laden: %w", err)
	}

	plan := storage.NewYearPlan(year)
	plan.Settings = tmpl.Settings
	// Deep-copy team slice so we don't share memory with the template.
	plan.Team = make([]domain.TeamMember, len(tmpl.Team))
	copy(plan.Team, tmpl.Team)

	path, err := s.showSaveDialog(fmt.Sprintf("einsatzplan-%d.json", year), plan)
	if err != nil {
		return nil, err
	}
	if path == "" {
		return nil, nil // user cancelled
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.plan = plan
	s.path = path
	s.dirty = false
	if info, err2 := os.Stat(path); err2 == nil {
		s.loadedMtime = info.ModTime()
	}
	s.restartPoller(path)
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
// Returns an error starting with "conflict:" if the file was modified externally
// since it was last loaded or saved. Use ForceOverwriteSave to bypass.
func (s *PlannerService) SavePlan(ctx context.Context) error {
	s.mu.Lock()
	if s.plan == nil {
		s.mu.Unlock()
		return fmt.Errorf("no plan loaded")
	}
	if s.path != "" {
		// Check whether the file was modified externally since we last loaded/saved.
		if info, err := os.Stat(s.path); err == nil {
			if info.ModTime().After(s.loadedMtime) {
				s.mu.Unlock()
				return fmt.Errorf("conflict: file was modified externally")
			}
		}
		// Pre-date loadedMtime to close the poller race window between write and stat.
		prevMtime := s.loadedMtime
		s.loadedMtime = time.Now()
		err := s.store.Save(s.path, s.plan)
		if err == nil {
			s.dirty = false
			// Update to the exact OS mtime; fall back to pre-dated value on stat failure.
			if info, err2 := os.Stat(s.path); err2 == nil {
				s.loadedMtime = info.ModTime()
			}
		} else {
			s.loadedMtime = prevMtime // restore on write failure
		}
		s.mu.Unlock()
		return err
	}
	// No path yet — show Save-As dialog without holding the mutex.
	planCopy := storage.CopyPlan(s.plan)
	suggested := fmt.Sprintf("einsatzplan-%d.json", s.plan.Year)
	s.mu.Unlock()
	path, err := s.showSaveDialog(suggested, planCopy)
	if err != nil || path == "" {
		return err
	}
	s.mu.Lock()
	s.path = path
	s.dirty = false
	if info, err2 := os.Stat(path); err2 == nil {
		s.loadedMtime = info.ModTime()
	}
	s.restartPoller(path)
	s.mu.Unlock()
	return nil
}

// ForceOverwriteSave saves the plan unconditionally, bypassing the mtime check.
// Called when the user explicitly confirms overwriting after a conflict.
func (s *PlannerService) ForceOverwriteSave(ctx context.Context) error {
	s.mu.Lock()
	if s.plan == nil {
		s.mu.Unlock()
		return fmt.Errorf("no plan loaded")
	}
	if s.path == "" {
		s.mu.Unlock()
		return fmt.Errorf("no path set")
	}
	// Pre-date loadedMtime to close the poller race window between write and stat.
	prevMtime := s.loadedMtime
	s.loadedMtime = time.Now()
	err := s.store.Save(s.path, s.plan)
	if err == nil {
		s.dirty = false
		if info, err2 := os.Stat(s.path); err2 == nil {
			s.loadedMtime = info.ModTime()
		}
	} else {
		s.loadedMtime = prevMtime // restore on write failure
	}
	s.mu.Unlock()
	return err
}

// SavePlanAs opens a native Save-As dialog and writes the plan.
// Returns the chosen path so the frontend can update its filename display.
func (s *PlannerService) SavePlanAs(ctx context.Context) (string, error) {
	s.mu.Lock()
	if s.plan == nil {
		s.mu.Unlock()
		return "", fmt.Errorf("no plan loaded")
	}
	planCopy := storage.CopyPlan(s.plan)
	suggested := fmt.Sprintf("einsatzplan-%d.json", s.plan.Year)
	s.mu.Unlock()
	path, err := s.showSaveDialog(suggested, planCopy)
	if err != nil || path == "" {
		return path, err
	}
	s.mu.Lock()
	s.path = path
	s.dirty = false
	if info, err2 := os.Stat(path); err2 == nil {
		s.loadedMtime = info.ModTime()
	}
	s.restartPoller(path)
	s.mu.Unlock()
	return path, nil
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
	if s.plan == nil || month < 1 || month > 12 || s.plan.Months[month] == nil {
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
	excluded := make(map[string]bool)
	for _, m := range s.plan.Team {
		if m.ExcludeFromHours {
			excluded[m.ID] = true
		}
	}
	return domain.CalcYearStats(s.eventsForFilter(month), s.plan.Settings.PrepTimeHours, excluded)
}

// GetPersonStats returns the per-person bar chart data.
func (s *PlannerService) GetPersonStats(ctx context.Context, month int) []domain.PersonStat {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil {
		return []domain.PersonStat{}
	}
	return domain.CalcPersonStats(s.plan.Team, s.eventsForFilter(month), s.plan.Settings.PrepTimeHours)
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
	for _, e := range staffEntries {
		appendActivity(s.plan, e)
	}

	newEditEntry := func() domain.ActivityEntry {
		return domain.ActivityEntry{
			ID:     generateID(),
			At:     timestamp(),
			Action: domain.ActionEdit,
			Target: targetFrom(month, ev),
		}
	}

	// A close/reopen transition is logged as a single dedicated entry; closed
	// events carry no scheduling data, so other field diffs are not logged.
	if old.IsClosed != ev.IsClosed {
		entry := newEditEntry()
		if ev.IsClosed {
			entry.Action = domain.ActionClose
			entry.Reason = ev.Comment
		} else {
			entry.Action = domain.ActionReopen
		}
		appendActivity(s.plan, entry)
		s.markDirty()
		return nil
	}

	// Otherwise log one entry per changed field, in a stable order.
	addFieldEntry := func(field, from, to string) {
		entry := newEditEntry()
		entry.Field = field
		entry.From = from
		entry.To = to
		appendActivity(s.plan, entry)
	}
	if old.Type != ev.Type {
		addFieldEntry("type", old.Type, ev.Type)
	}
	if old.Date != ev.Date {
		addFieldEntry("date", old.Date, ev.Date)
	}
	if old.DateEnd != ev.DateEnd {
		addFieldEntry("dateEnd", old.DateEnd, ev.DateEnd)
	}
	if old.Location != ev.Location {
		addFieldEntry("location", old.Location, ev.Location)
	}
	if old.TimeFrom != ev.TimeFrom || old.TimeTo != ev.TimeTo {
		addFieldEntry("time", old.TimeFrom+"–"+old.TimeTo, ev.TimeFrom+"–"+ev.TimeTo)
	}
	if old.StaffRequired != ev.StaffRequired {
		addFieldEntry("staffRequired", fmt.Sprintf("%d", old.StaffRequired), fmt.Sprintf("%d", ev.StaffRequired))
	}
	if old.Comment != ev.Comment {
		addFieldEntry("comment", old.Comment, ev.Comment)
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

// ToggleMemberExcludeHours flips the excludeFromHours flag for a team member.
func (s *PlannerService) ToggleMemberExcludeHours(ctx context.Context, memberID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.requirePlan(); err != nil {
		return err
	}
	idx := slices.IndexFunc(s.plan.Team, func(t domain.TeamMember) bool { return t.ID == memberID })
	if idx < 0 {
		return fmt.Errorf("member %q not found", memberID)
	}
	s.plan.Team[idx].ExcludeFromHours = !s.plan.Team[idx].ExcludeFromHours
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
func (s *PlannerService) SetApp(app *application.App)              { s.app = app }
func (s *PlannerService) SetWindow(win *application.WebviewWindow) { s.win = win }

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

func (s *PlannerService) loadFromPath(ctx context.Context, path string) (*domain.YearPlan, error) {
	plan, err := s.store.Load(path)
	if err != nil {
		return nil, err
	}
	s.plan = plan
	s.path = path
	s.dirty = false
	if info, err2 := os.Stat(path); err2 == nil {
		s.loadedMtime = info.ModTime()
	}
	saveRecentPaths(prependUnique(loadRecentPaths(), path))
	s.restartPoller(path)
	return storage.CopyPlan(s.plan), nil
}

// restartPoller cancels any running file-change poller and starts a new one for path.
// Must be called with s.mu write-locked.
func (s *PlannerService) restartPoller(path string) {
	if s.pollCancel != nil {
		s.pollCancel()
	}
	pollCtx, cancel := context.WithCancel(context.Background())
	s.pollCancel = cancel
	go s.startFilePoller(pollCtx, path)
}

// startFilePoller checks the file's mtime every 15 s and emits an event to
// the frontend when it detects an external change.
func (s *PlannerService) startFilePoller(ctx context.Context, path string) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	// lastNotified tracks the mtime we most recently emitted an event for,
	// so we don't re-fire for the same external change on every tick.
	var lastNotified time.Time
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			info, err := os.Stat(path)
			if err != nil {
				continue
			}
			s.mu.RLock()
			known := s.loadedMtime
			s.mu.RUnlock()
			fileMtime := info.ModTime()
			if fileMtime.After(known) && fileMtime.After(lastNotified) {
				lastNotified = fileMtime
				if s.win != nil {
					s.win.EmitEvent("plan:file-changed-externally")
				}
			}
		}
	}
}

// ReloadPlan re-reads the current file from disk and returns the fresh plan.
// Called by the frontend after the user confirms a reload.
func (s *PlannerService) ReloadPlan(ctx context.Context) (*domain.YearPlan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path == "" {
		return nil, fmt.Errorf("no plan loaded")
	}
	return s.loadFromPath(ctx, s.path)
}

// showSaveDialog shows a native Save-As dialog and writes plan to the chosen path.
// It does NOT hold or modify any mutex-protected state; callers handle that.
func (s *PlannerService) showSaveDialog(suggested string, plan *domain.YearPlan) (string, error) {
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
func (s *PlannerService) ExportICal(ctx context.Context, personIDs []string, includePrep bool) error {
	// Build the iCal content under the read-lock, then release before showing the dialog.
	s.mu.RLock()
	if err := s.requirePlan(); err != nil {
		s.mu.RUnlock()
		return err
	}
	if s.app == nil {
		s.mu.RUnlock()
		return fmt.Errorf("no app context")
	}
	allPersons := personIDs == nil
	content := buildICal(s.plan, personIDs, allPersons, includePrep)
	year := s.plan.Year
	s.mu.RUnlock()

	sdlg := s.app.Dialog.SaveFile()
	sdlg.SetOptions(&application.SaveFileDialogOptions{
		Title:    "Kalender exportieren",
		Filename: fmt.Sprintf("einsatzplan-%d.ics", year),
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
