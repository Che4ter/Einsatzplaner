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
