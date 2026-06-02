package service

import (
	"slices"
	"strings"
	"testing"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/storage"
)

func TestAppendActivity_Cap(t *testing.T) {
	plan := storage.NewYearPlan(2026)
	for range 600 {
		appendActivity(plan, domain.ActivityEntry{ID: generateID(), Action: "create"})
	}
	if len(plan.ActivityLog) > maxActivityLog {
		t.Errorf("ActivityLog len = %d, want ≤ %d", len(plan.ActivityLog), maxActivityLog)
	}
}

func TestPlanFromTemplate(t *testing.T) {
	tmpl := storage.NewYearPlan(2025)
	tmpl.Settings.TeamName = "Crew"
	tmpl.Team = []domain.TeamMember{{ID: "m1", Name: "Anna", Color: "#0d9488", Active: true}}
	tmpl.Months[3].Events = []domain.Event{{
		ID: "old-id", Type: domain.EventTypeWeekday, Date: "2025-03-04",
		DateEnd: "2025-03-05", IsClosed: true, StaffRequired: 2,
		AssignedStaff: []string{"m1"},
	}}

	t.Run("settings and team copied, no events", func(t *testing.T) {
		got := planFromTemplate(tmpl, 2026, false)
		if got.Year != 2026 {
			t.Errorf("year = %d, want 2026", got.Year)
		}
		if got.Settings.TeamName != "Crew" {
			t.Errorf("settings not copied: %+v", got.Settings)
		}
		if len(got.Team) != 1 || got.Team[0].ID != "m1" {
			t.Errorf("team not copied: %+v", got.Team)
		}
		if len(got.Months[3].Events) != 0 {
			t.Error("events copied despite includeEvents=false")
		}
		// Mutating the copy must not touch the template.
		got.Team[0].Name = "Changed"
		if tmpl.Team[0].Name != "Anna" {
			t.Error("template team aliased — deep copy failed")
		}
	})

	t.Run("events copied, year-adjusted, fresh IDs, cleared state", func(t *testing.T) {
		got := planFromTemplate(tmpl, 2026, true)
		evs := got.Months[3].Events
		if len(evs) != 1 {
			t.Fatalf("expected 1 event, got %d", len(evs))
		}
		ev := evs[0]
		if ev.Date != "2026-03-04" || ev.DateEnd != "2026-03-05" {
			t.Errorf("dates not year-adjusted: %s / %s", ev.Date, ev.DateEnd)
		}
		if ev.ID == "old-id" || ev.ID == "" {
			t.Errorf("event ID not regenerated: %q", ev.ID)
		}
		if ev.IsClosed {
			t.Error("IsClosed should be reset to false")
		}
	})
}

func TestGenerateID_Format(t *testing.T) {
	id := generateID()
	if len(id) != 12 {
		t.Errorf("generateID len = %d, want 12", len(id))
	}
	for _, c := range id {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Errorf("generateID contains non-hex char %q", c)
		}
	}
}

func TestPrependUnique(t *testing.T) {
	cases := []struct {
		name   string
		paths  []string
		add    string
		want   []string
	}{
		{
			name: "empty list",
			add:  "/a/b.json",
			want: []string{"/a/b.json"},
		},
		{
			name:  "prepend new path",
			paths: []string{"/a/b.json", "/c/d.json"},
			add:   "/e/f.json",
			want:  []string{"/e/f.json", "/a/b.json", "/c/d.json"},
		},
		{
			name:  "existing path moves to front",
			paths: []string{"/a/b.json", "/c/d.json", "/e/f.json"},
			add:   "/c/d.json",
			want:  []string{"/c/d.json", "/a/b.json", "/e/f.json"},
		},
		{
			name:  "trims to 3",
			paths: []string{"/a.json", "/b.json", "/c.json"},
			add:   "/d.json",
			want:  []string{"/d.json", "/a.json", "/b.json"},
		},
		{
			name:  "already first — no change to order",
			paths: []string{"/a.json", "/b.json"},
			add:   "/a.json",
			want:  []string{"/a.json", "/b.json"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := prependUnique(tc.paths, tc.add)
			if !slices.Equal(got, tc.want) {
				t.Errorf("prependUnique(%v, %q) = %v, want %v", tc.paths, tc.add, got, tc.want)
			}
		})
	}
}
