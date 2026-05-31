package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"einsatzplaner/einsatzplan/domain"
)

const fileVersion = 1

// defaultTeamColor is applied to team members whose stored color is missing or
// not a valid CSS hex color, preventing CSS injection via hand-edited files.
const defaultTeamColor = "#0d9488"

// Store is the persistence abstraction. The real implementation writes JSON to
// disk; tests can inject MemStore for zero I/O.
type Store interface {
	Load(path string) (*domain.YearPlan, error)
	Save(path string, plan *domain.YearPlan) error
}

// JSONStore reads and writes YearPlan as a single JSON file.
type JSONStore struct{}

func (s *JSONStore) Load(path string) (*domain.YearPlan, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %q: %w", path, err)
	}
	var plan domain.YearPlan
	if err := json.Unmarshal(data, &plan); err != nil {
		return nil, fmt.Errorf("parse %q: %w", path, err)
	}
	normalise(&plan)
	return &plan, nil
}

func (s *JSONStore) Save(path string, plan *domain.YearPlan) error {
	data, err := json.MarshalIndent(plan, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	// Write to a temp file in the same directory then atomically rename.
	// Prevents file corruption if the process is killed mid-write.
	tmp, err := os.CreateTemp(filepath.Dir(path), ".plan-*.json")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("write: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("close: %w", err)
	}
	// Restrict to owner-only — plan files contain personal data.
	if err := os.Chmod(tmpPath, 0600); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("chmod: %w", err)
	}
	if err := os.Rename(tmpPath, path); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("rename %q: %w", tmpPath, err)
	}
	return nil
}

// MemStore is an in-memory Store for tests — no disk I/O.
type MemStore struct {
	data map[string]*domain.YearPlan
}

func NewMemStore() *MemStore { return &MemStore{data: map[string]*domain.YearPlan{}} }

func (m *MemStore) Load(path string) (*domain.YearPlan, error) {
	p, ok := m.data[path]
	if !ok {
		return nil, fmt.Errorf("not found: %q", path)
	}
	// return a deep copy so callers can't mutate store internals
	clone := deepCopy(p)
	return clone, nil
}

func (m *MemStore) Save(path string, plan *domain.YearPlan) error {
	m.data[path] = deepCopy(plan)
	return nil
}

// NewYearPlan creates a blank plan for the given year.
func NewYearPlan(year int) *domain.YearPlan {
	months := make(map[int]*domain.Month, 12)
	for m := 1; m <= 12; m++ {
		months[m] = &domain.Month{Events: []domain.Event{}}
	}
	return &domain.YearPlan{
		Version: fileVersion,
		Year:    year,
		Settings: domain.Settings{
			TeamName:  "",
			Locations: []string{},
			DefaultTimes: []domain.TimePreset{
				{Label: "Standard", From: "13:30", To: "17:30"},
			},
		},
		Team:        []domain.TeamMember{},
		Months:      months,
		ActivityLog: []domain.ActivityEntry{},
	}
}

// normalise fills in any fields that old JSON files may be missing.
func normalise(plan *domain.YearPlan) {
	if plan.Months == nil {
		plan.Months = make(map[int]*domain.Month, 12)
	}
	for m := 1; m <= 12; m++ {
		if plan.Months[m] == nil {
			plan.Months[m] = &domain.Month{Events: []domain.Event{}}
		}
		if plan.Months[m].Events == nil {
			plan.Months[m].Events = []domain.Event{}
		}
	}
	if plan.Team == nil {
		plan.Team = []domain.TeamMember{}
	}
	// Sanitize team colors loaded from disk: an invalid value (e.g. a crafted
	// CSS payload in a hand-edited file) is reset to a safe default before it
	// can be interpolated into a style attribute in the frontend.
	for i := range plan.Team {
		if !domain.IsValidHexColor(plan.Team[i].Color) {
			plan.Team[i].Color = defaultTeamColor
		}
	}
	if plan.ActivityLog == nil {
		plan.ActivityLog = []domain.ActivityEntry{}
	}
	if plan.Settings.Locations == nil {
		plan.Settings.Locations = []string{}
	}
	if plan.Settings.DefaultTimes == nil {
		plan.Settings.DefaultTimes = []domain.TimePreset{}
	}
}

func deepCopy(p *domain.YearPlan) *domain.YearPlan {
	data, err := json.Marshal(p)
	if err != nil {
		panic("deepCopy: marshal failed: " + err.Error())
	}
	var out domain.YearPlan
	if err := json.Unmarshal(data, &out); err != nil {
		panic("deepCopy: unmarshal failed: " + err.Error())
	}
	normalise(&out)
	return &out
}

// CopyPlan returns a deep copy of p. Used by PlannerService to ensure
// callers cannot mutate internal state through the returned pointer.
func CopyPlan(p *domain.YearPlan) *domain.YearPlan {
	return deepCopy(p)
}
