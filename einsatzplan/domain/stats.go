package domain

import (
	"cmp"
	"slices"
)

// MonthSummary is computed per-month for the sidebar nav.
type MonthSummary struct {
	Total  int `json:"total"`  // non-closed event count
	Issues int `json:"issues"` // understaffed event count
}

// YearStats is the four-card summary shown at the top of the statistics page.
type YearStats struct {
	TotalEvents   int     `json:"totalEvents"`
	TotalHours    float64 `json:"totalHours"`  // person-hours (duration × staff × days)
	VorOrtHours   float64 `json:"vorOrtHours"` // event hours (duration × days, regardless of staff)
	PrepHours     float64 `json:"prepHours"`   // total Vor- & Nachbearbeitungszeit (prepTime × staff)
	TotalNeed     int     `json:"totalNeed"`
	TotalAssigned int     `json:"totalAssigned"` // raw assigned count (may exceed need when over-assigned)
	FilledSlots   int     `json:"filledSlots"`   // sum of min(assigned, required) per event — never exceeds need
	OpenSlots     int     `json:"openSlots"`     // sum of max(0, required − assigned) per event
	CoveragePct   int     `json:"coveragePct"`
	UnderCount    int     `json:"underCount"` // events where assigned < required
}

// PersonStat is one row in the per-person bar chart.
type PersonStat struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Color   string  `json:"color"`
	Active  bool    `json:"active"`
	Wkd     int     `json:"wkd"`     // weekday event count
	Wke     int     `json:"wke"`     // weekend day count (2 for Sa+So)
	Total   int     `json:"total"`   // Wkd + Wke
	Hrs     float64 `json:"hrs"`     // total person-hours (excl. prep)
	PrepHrs float64 `json:"prepHrs"` // Vor- & Nachbearbeitungszeit
}

// CoverageClass returns "ok", "warn", or "danger" for display.
// Thresholds match the design: ≥95 ok, ≥80 warn, else danger.
func CoverageClass(pct int) string {
	if pct >= 95 {
		return "ok"
	}
	if pct >= 80 {
		return "warn"
	}
	return "danger"
}

// CalcMonthSummary computes the sidebar badge for one month's events.
func CalcMonthSummary(events []Event) MonthSummary {
	var s MonthSummary
	for _, e := range events {
		if e.IsClosed {
			continue
		}
		s.Total++
		if len(e.AssignedStaff) < e.StaffRequired {
			s.Issues++
		}
	}
	return s
}

// CalcAllMonthSummaries computes summaries for all 12 months.
func CalcAllMonthSummaries(plan *YearPlan) map[int]MonthSummary {
	out := make(map[int]MonthSummary, 12)
	for m := 1; m <= 12; m++ {
		var events []Event
		if mo, ok := plan.Months[m]; ok {
			events = mo.Events
		}
		out[m] = CalcMonthSummary(events)
	}
	return out
}

// CalcYearStats computes the four headline numbers from a set of events.
// Pass a filtered slice (e.g. one month or all months, already excluding closed).
func CalcYearStats(events []Event, _ float64, excludedIDs map[string]bool) YearStats {
	var s YearStats
	for _, e := range events {
		if e.IsClosed {
			continue
		}
		s.TotalEvents++
		s.TotalNeed += e.StaffRequired
		assigned := len(e.AssignedStaff)
		s.TotalAssigned += assigned
		// Cap filled slots at the requirement so over-assigning one event cannot
		// hide an under-staffed event in the aggregate coverage/open-slot numbers.
		if assigned >= e.StaffRequired {
			s.FilledSlots += e.StaffRequired
		} else {
			s.FilledSlots += assigned
			s.OpenSlots += e.StaffRequired - assigned
		}
		days := e.EventDays()
		dur := parseDuration(e.TimeFrom, e.TimeTo)
		s.VorOrtHours += dur * float64(days)
		prepTime := parseDuration(e.TimeSetup, e.TimeFrom) + parseDuration(e.TimeTo, e.TimeTeardown)
		for _, id := range e.AssignedStaff {
			if !excludedIDs[id] {
				s.TotalHours += dur * float64(days)
				s.PrepHours += prepTime
			}
		}
		if assigned < e.StaffRequired {
			s.UnderCount++
		}
	}
	if s.TotalNeed > 0 {
		s.CoveragePct = int(float64(s.FilledSlots) / float64(s.TotalNeed) * 100)
	} else {
		s.CoveragePct = 100
	}
	return s
}

// CalcPersonStats builds the per-person bar chart data, sorted by total (desc).
func CalcPersonStats(team []TeamMember, events []Event, _ float64) []PersonStat {
	idx := make(map[string]*PersonStat, len(team))
	out := make([]PersonStat, len(team))
	for i, m := range team {
		out[i] = PersonStat{ID: m.ID, Name: m.Name, Color: m.Color, Active: m.Active}
		idx[m.ID] = &out[i]
	}

	for _, e := range events {
		if e.IsClosed {
			continue
		}
		days := e.EventDays()
		dur := parseDuration(e.TimeFrom, e.TimeTo)
		prepTime := parseDuration(e.TimeSetup, e.TimeFrom) + parseDuration(e.TimeTo, e.TimeTeardown)
		for _, id := range e.AssignedStaff {
			p, ok := idx[id]
			if !ok {
				continue
			}
			if e.IsWeekday() {
				p.Wkd++
			} else {
				p.Wke += days
			}
			p.Hrs += dur * float64(days)
			p.PrepHrs += prepTime
		}
	}

	for i := range out {
		out[i].Total = out[i].Wkd + out[i].Wke
	}
	slices.SortFunc(out, func(a, b PersonStat) int { return cmp.Compare(b.Total, a.Total) })
	return out
}

// parseDuration returns the duration in hours between two HH:MM strings.
// Returns 0 for invalid or empty input.
func parseDuration(from, to string) float64 {
	fh, fm, ok1 := parseHHMM(from)
	th, tm, ok2 := parseHHMM(to)
	if !ok1 || !ok2 {
		return 0
	}
	diff := float64(th*60+tm-fh*60-fm) / 60.0
	if diff < 0 {
		return 0
	}
	return diff
}
