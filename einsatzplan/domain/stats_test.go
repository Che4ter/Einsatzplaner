package domain_test

import (
	"testing"

	"einsatzplaner/einsatzplan/domain"
)

func TestCoverageClass(t *testing.T) {
	cases := []struct {
		pct  int
		want string
	}{
		{100, "ok"},
		{95, "ok"},
		{94, "warn"},
		{80, "warn"},
		{79, "danger"},
		{0, "danger"},
	}
	for _, c := range cases {
		got := domain.CoverageClass(c.pct)
		if got != c.want {
			t.Errorf("CoverageClass(%d) = %q, want %q", c.pct, got, c.want)
		}
	}
}

func TestCalcMonthSummary(t *testing.T) {
	events := []domain.Event{
		{IsClosed: true}, // excluded
		{StaffRequired: 3, AssignedStaff: []string{"a", "b", "c"}}, // ok
		{StaffRequired: 3, AssignedStaff: []string{"a"}},           // issue
		{StaffRequired: 0, AssignedStaff: nil},                     // ok (no requirement)
	}
	s := domain.CalcMonthSummary(events)
	if s.Total != 3 {
		t.Errorf("Total = %d, want 3", s.Total)
	}
	if s.Issues != 1 {
		t.Errorf("Issues = %d, want 1", s.Issues)
	}
}

func TestCalcYearStats_Coverage(t *testing.T) {
	events := []domain.Event{
		{StaffRequired: 2, AssignedStaff: []string{"a", "b"}, TimeFrom: "14:00", TimeTo: "17:00"},
		{StaffRequired: 2, AssignedStaff: []string{"a"}, TimeFrom: "14:00", TimeTo: "17:00"},
	}
	s := domain.CalcYearStats(events)
	// totalNeed=4, totalAssigned=3 → 75% → warn
	if s.TotalNeed != 4 {
		t.Errorf("TotalNeed = %d, want 4", s.TotalNeed)
	}
	if s.TotalAssigned != 3 {
		t.Errorf("TotalAssigned = %d, want 3", s.TotalAssigned)
	}
	if s.CoveragePct != 75 {
		t.Errorf("CoveragePct = %d, want 75", s.CoveragePct)
	}
	if s.UnderCount != 1 {
		t.Errorf("UnderCount = %d, want 1", s.UnderCount)
	}
	if domain.CoverageClass(s.CoveragePct) != "danger" {
		t.Errorf("expected danger class for 75%%")
	}
}

func TestCalcYearStats_Hours(t *testing.T) {
	// Single-day weekday: 3h duration × 2 people × 1 day = 6h
	events := []domain.Event{
		{
			Type: "wednesday", Date: "2026-05-06", StaffRequired: 2,
			AssignedStaff: []string{"a", "b"},
			TimeFrom:      "14:00", TimeTo: "17:00",
		},
	}
	s := domain.CalcYearStats(events)
	if s.TotalHours != 6 {
		t.Errorf("TotalHours = %f, want 6", s.TotalHours)
	}
}

func TestCalcYearStats_MultiDayHours(t *testing.T) {
	// Sa+So event: 3h × 1 person × 2 days = 6h
	events := []domain.Event{
		{
			Type: "weekend", Date: "2026-05-30", DateEnd: "2026-05-31",
			StaffRequired: 1, AssignedStaff: []string{"a"},
			TimeFrom: "14:00", TimeTo: "17:00",
		},
	}
	s := domain.CalcYearStats(events)
	if s.TotalHours != 6 {
		t.Errorf("TotalHours = %f, want 6 (multi-day)", s.TotalHours)
	}
}

func TestCalcYearStats_SkipsClosed(t *testing.T) {
	events := []domain.Event{
		{IsClosed: true, StaffRequired: 3, AssignedStaff: []string{"a", "b", "c"}},
		{StaffRequired: 1, AssignedStaff: []string{"a"}, TimeFrom: "14:00", TimeTo: "17:00"},
	}
	s := domain.CalcYearStats(events)
	if s.TotalEvents != 1 {
		t.Errorf("TotalEvents = %d, want 1 (closed excluded)", s.TotalEvents)
	}
}

func TestCalcPersonStats_Sort(t *testing.T) {
	team := []domain.TeamMember{
		{ID: "a", Name: "Anna", Active: true},
		{ID: "b", Name: "Bob", Active: true},
	}
	events := []domain.Event{
		// Bob assigned to 2 weekday events, Anna to 1
		{Type: "wednesday", AssignedStaff: []string{"a", "b"}, TimeFrom: "14:00", TimeTo: "17:00"},
		{Type: "wednesday", AssignedStaff: []string{"b"}, TimeFrom: "14:00", TimeTo: "17:00"},
	}
	stats := domain.CalcPersonStats(team, events)
	if stats[0].ID != "b" {
		t.Errorf("expected Bob first (2 events), got %s", stats[0].ID)
	}
	if stats[0].Wkd != 2 {
		t.Errorf("Bob.Wkd = %d, want 2", stats[0].Wkd)
	}
	if stats[1].Wkd != 1 {
		t.Errorf("Anna.Wkd = %d, want 1", stats[1].Wkd)
	}
}

func TestCalcPersonStats_WeekendDays(t *testing.T) {
	team := []domain.TeamMember{{ID: "a", Name: "Anna", Active: true}}
	events := []domain.Event{
		// Sa+So event → Wke += 2
		{Type: "weekend", Date: "2026-05-30", DateEnd: "2026-05-31",
			AssignedStaff: []string{"a"}, TimeFrom: "14:00", TimeTo: "17:00"},
	}
	stats := domain.CalcPersonStats(team, events)
	if stats[0].Wke != 2 {
		t.Errorf("Wke = %d, want 2 for Sa+So", stats[0].Wke)
	}
	if stats[0].Total != 2 {
		t.Errorf("Total = %d, want 2", stats[0].Total)
	}
}

func TestCalcAllMonthSummaries(t *testing.T) {
	plan := &domain.YearPlan{
		Months: map[int]*domain.Month{
			3: {Events: []domain.Event{
				{StaffRequired: 2, AssignedStaff: []string{"a", "b"}}, // ok
				{StaffRequired: 2, AssignedStaff: []string{"a"}},      // issue
			}},
			// Month 6 intentionally absent — should still appear with zeros.
		},
	}
	summaries := domain.CalcAllMonthSummaries(plan)
	if len(summaries) != 12 {
		t.Errorf("expected 12 month summaries, got %d", len(summaries))
	}
	if summaries[3].Total != 2 {
		t.Errorf("month 3 Total = %d, want 2", summaries[3].Total)
	}
	if summaries[3].Issues != 1 {
		t.Errorf("month 3 Issues = %d, want 1", summaries[3].Issues)
	}
	if summaries[6].Total != 0 {
		t.Errorf("month 6 Total = %d, want 0 (absent month)", summaries[6].Total)
	}
}
