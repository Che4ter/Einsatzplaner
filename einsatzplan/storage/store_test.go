package storage_test

import (
	"os"
	"path/filepath"
	"testing"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/storage"
)

func TestJSONStore_RoundTrip(t *testing.T) {
	plan := storage.NewYearPlan(2026)
	plan.Settings.TeamName = "Testteam"
	plan.Team = append(plan.Team,
		domain.TeamMember{ID: "m1", Name: "Anna", Color: "#0d9488", Active: true},
		domain.TeamMember{ID: "m2", Name: "Bob", Color: "#2563eb", Active: false},
	)

	tmp := filepath.Join(t.TempDir(), "plan.json")
	store := &storage.JSONStore{}

	if err := store.Save(tmp, plan); err != nil {
		t.Fatalf("Save: %v", err)
	}

	loaded, err := store.Load(tmp)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}

	if loaded.Year != 2026 {
		t.Errorf("Year = %d, want 2026", loaded.Year)
	}
	if loaded.Settings.TeamName != "Testteam" {
		t.Errorf("TeamName = %q, want %q", loaded.Settings.TeamName, "Testteam")
	}
	if len(loaded.Months) != 12 {
		t.Errorf("Months len = %d, want 12", len(loaded.Months))
	}
	if len(loaded.Team) != 2 {
		t.Fatalf("Team len = %d, want 2", len(loaded.Team))
	}
	if loaded.Team[0].Name != "Anna" || loaded.Team[0].ID != "m1" || !loaded.Team[0].Active {
		t.Errorf("Team[0] = %+v, want {ID:m1 Name:Anna Active:true}", loaded.Team[0])
	}
	if loaded.Team[1].Name != "Bob" || loaded.Team[1].ID != "m2" || loaded.Team[1].Active {
		t.Errorf("Team[1] = %+v, want {ID:m2 Name:Bob Active:false}", loaded.Team[1])
	}
}

func TestJSONStore_Load_Missing(t *testing.T) {
	store := &storage.JSONStore{}
	_, err := store.Load("/nonexistent/path.json")
	if err == nil {
		t.Error("expected error loading missing file")
	}
}

func TestJSONStore_Load_InvalidJSON(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "bad.json")
	os.WriteFile(tmp, []byte("not json{{{"), 0644)
	store := &storage.JSONStore{}
	_, err := store.Load(tmp)
	if err == nil {
		t.Error("expected error loading invalid JSON")
	}
}

func TestMemStore_RoundTrip(t *testing.T) {
	ms := storage.NewMemStore()
	plan := storage.NewYearPlan(2025)
	plan.Settings.TeamName = "Demo"

	if err := ms.Save("test.json", plan); err != nil {
		t.Fatalf("Save: %v", err)
	}

	loaded, err := ms.Load("test.json")
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded.Settings.TeamName != "Demo" {
		t.Errorf("TeamName = %q, want Demo", loaded.Settings.TeamName)
	}

	// Mutations to loaded copy must not affect stored copy.
	loaded.Settings.TeamName = "Modified"
	again, _ := ms.Load("test.json")
	if again.Settings.TeamName != "Demo" {
		t.Error("MemStore returned reference instead of copy")
	}
}

func TestMemStore_Load_Missing(t *testing.T) {
	ms := storage.NewMemStore()
	_, err := ms.Load("missing.json")
	if err == nil {
		t.Error("expected error for missing key")
	}
}

func TestNewYearPlan(t *testing.T) {
	plan := storage.NewYearPlan(2026)
	if plan.Year != 2026 {
		t.Errorf("Year = %d, want 2026", plan.Year)
	}
	if len(plan.Months) != 12 {
		t.Errorf("Months = %d, want 12", len(plan.Months))
	}
	for m := 1; m <= 12; m++ {
		if plan.Months[m] == nil {
			t.Errorf("Months[%d] is nil", m)
		}
	}
	if plan.Version != 1 {
		t.Errorf("Version = %d, want 1", plan.Version)
	}
}

// ── normalise — via JSONStore.Load with hand-crafted minimal JSON ─────────────

func TestNormalise_NilMonths_InitialisesAll12(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plan.json")
	// JSON with no "months" key at all.
	if err := os.WriteFile(path, []byte(`{"version":1,"year":2026}`), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := (&storage.JSONStore{}).Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	for m := 1; m <= 12; m++ {
		if plan.Months[m] == nil {
			t.Errorf("month %d not initialised", m)
		}
		if plan.Months[m].Events == nil {
			t.Errorf("month %d events nil", m)
		}
	}
}

func TestNormalise_NilTeam_InitialisesToEmptySlice(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plan.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"year":2026}`), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := (&storage.JSONStore{}).Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if plan.Team == nil {
		t.Error("Team should be non-nil empty slice, not nil")
	}
}

func TestNormalise_NilActivityLog_InitialisesToEmptySlice(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plan.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"year":2026}`), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := (&storage.JSONStore{}).Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if plan.ActivityLog == nil {
		t.Error("ActivityLog should be non-nil empty slice, not nil")
	}
}

func TestNormalise_NilLocations_InitialisesToEmptySlice(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plan.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"year":2026,"settings":{}}`), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := (&storage.JSONStore{}).Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if plan.Settings.Locations == nil {
		t.Error("Settings.Locations should be non-nil empty slice, not nil")
	}
}

func TestNormalise_InvalidMemberColor_Sanitized(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plan.json")
	payload := `{"version":1,"year":2026,"team":[{"id":"m1","name":"Anna","color":"javascript:alert(1)","active":true}]}`
	if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := (&storage.JSONStore{}).Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(plan.Team) == 0 {
		t.Fatal("expected one team member")
	}
	if plan.Team[0].Color == "javascript:alert(1)" {
		t.Error("unsafe color must be sanitized on load")
	}
	if plan.Team[0].Color == "" {
		t.Error("sanitized color must be a non-empty default, not empty string")
	}
}

func TestNormalise_NullMonthEvents_InitialisesToEmptySlice(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plan.json")
	// Month present but events is null.
	payload := `{"version":1,"year":2026,"months":{"3":{"events":null}}}`
	if err := os.WriteFile(path, []byte(payload), 0600); err != nil {
		t.Fatal(err)
	}
	plan, err := (&storage.JSONStore{}).Load(path)
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if plan.Months[3] == nil || plan.Months[3].Events == nil {
		t.Error("month 3 events should be non-nil empty slice after normalise")
	}
}
