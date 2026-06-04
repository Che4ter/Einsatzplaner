package service

import (
	"strings"
	"testing"
	"time"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/storage"
)

// ── icalEscape ───────────────────────────────────────────────────────────────

func TestIcalEscape(t *testing.T) {
	cases := []struct{ in, want string }{
		{`back\slash`, `back\\slash`},
		{"semi;colon", `semi\;colon`},
		{"com,ma", `com\,ma`},
		{"new\nline", `new\nline`},
		{"plain text", "plain text"},
		{"", ""},
	}
	for _, c := range cases {
		if got := icalEscape(c.in); got != c.want {
			t.Errorf("icalEscape(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// ── icalDescription ──────────────────────────────────────────────────────────

func TestIcalDescription_TeamAndComment(t *testing.T) {
	ev := domain.Event{
		AssignedStaff: []string{"a", "b"},
		Comment:       "Bring gear",
	}
	team := map[string]domain.TeamMember{
		"a": {ID: "a", Name: "Anna"},
		"b": {ID: "b", Name: "Bob"},
	}
	got := icalDescription(ev, team)
	// comma is escaped per RFC 5545
	if !strings.Contains(got, `Team: Anna\, Bob`) {
		t.Errorf("missing team line in %q", got)
	}
	if !strings.Contains(got, `\n`) {
		t.Errorf("missing \\n separator in %q", got)
	}
	if !strings.Contains(got, "Bring gear") {
		t.Errorf("missing comment in %q", got)
	}
}

func TestIcalDescription_CommentWithSpecialChars(t *testing.T) {
	ev := domain.Event{Comment: "a,b;c\\d\ne"}
	got := icalDescription(ev, nil)
	// All special chars must appear in escaped form only
	if !strings.Contains(got, `\,`) {
		t.Errorf("comma not escaped in %q", got)
	}
	if !strings.Contains(got, `\;`) {
		t.Errorf("semicolon not escaped in %q", got)
	}
	if strings.Contains(got, "\n") {
		t.Errorf("literal newline must be escaped, got %q", got)
	}
}

func TestIcalDescription_Empty(t *testing.T) {
	if got := icalDescription(domain.Event{}, nil); got != "" {
		t.Errorf("empty event: want empty description, got %q", got)
	}
}

// ── icalDateTimes ─────────────────────────────────────────────────────────────

func TestIcalDateTimes_Timed(t *testing.T) {
	ev := domain.Event{TimeFrom: "14:00", TimeTo: "17:00"}
	dtStart, dtEnd := icalDateTimes(ev, date("2026-05-06"), true)
	// DTSTART;TZID=<iana-name>:<datetime>  — RFC 5545 §3.2.19
	if !strings.Contains(dtStart, ":20260506T140000") || !strings.HasPrefix(dtStart, "DTSTART;TZID=") {
		t.Errorf("DTSTART = %q", dtStart)
	}
	if !strings.Contains(dtEnd, ":20260506T170000") || !strings.HasPrefix(dtEnd, "DTEND;TZID=") {
		t.Errorf("DTEND = %q", dtEnd)
	}
}

func TestIcalDateTimes_AllDay(t *testing.T) {
	dtStart, dtEnd := icalDateTimes(domain.Event{}, date("2026-05-06"), true)
	if dtStart != "DTSTART;VALUE=DATE:20260506" {
		t.Errorf("DTSTART = %q", dtStart)
	}
	if dtEnd != "DTEND;VALUE=DATE:20260507" {
		t.Errorf("DTEND = %q (want next day)", dtEnd)
	}
}

func TestIcalDateTimes_MultiDayTimed(t *testing.T) {
	ev := domain.Event{Date: "2026-05-30", DateEnd: "2026-05-31", TimeFrom: "14:00", TimeTo: "17:00"}
	dtStart, dtEnd := icalDateTimes(ev, date("2026-05-30"), true)
	if !strings.Contains(dtStart, ":20260530T140000") || !strings.HasPrefix(dtStart, "DTSTART;TZID=") {
		t.Errorf("DTSTART = %q", dtStart)
	}
	// DTEND must be on the DateEnd date (2026-05-31), not the start date.
	if !strings.Contains(dtEnd, ":20260531T170000") || !strings.HasPrefix(dtEnd, "DTEND;TZID=") {
		t.Errorf("DTEND = %q, want DTEND on 2026-05-31T17:00 local", dtEnd)
	}
}

func TestIcalDateTimes_MultiDayAllDay(t *testing.T) {
	ev := domain.Event{Date: "2026-05-30", DateEnd: "2026-05-31"}
	_, dtEnd := icalDateTimes(ev, date("2026-05-30"), true)
	if dtEnd != "DTEND;VALUE=DATE:20260601" {
		t.Errorf("DTEND = %q, want 20260601", dtEnd)
	}
}

// ── buildICal ────────────────────────────────────────────────────────────────

func planWithEvent(ev domain.Event) *domain.YearPlan {
	plan := storage.NewYearPlan(2026)
	plan.Settings.TeamName = "Testteam"
	plan.Team = []domain.TeamMember{
		{ID: "a", Name: "Anna", Active: true},
		{ID: "b", Name: "Bob", Active: true},
	}
	ev.ID = "abc123"
	plan.Months[5].Events = append(plan.Months[5].Events, ev)
	return plan
}

func TestBuildICal_ContainsVCalendar(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWednesday, Date: "2026-05-06",
		TimeFrom: "14:00", TimeTo: "17:00",
	})
	out := buildICal(plan, nil, true, true)
	for _, want := range []string{
		"BEGIN:VCALENDAR", "END:VCALENDAR",
		"BEGIN:VEVENT", "END:VEVENT",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in output", want)
		}
	}
	// Timestamps must use TZID form: DTSTART;TZID=<name>:<datetime>
	if !strings.Contains(out, ":20260506T140000") || !strings.Contains(out, "DTSTART;TZID=") {
		t.Errorf("DTSTART not in TZID format; output:\n%s", out)
	}
	if !strings.Contains(out, ":20260506T170000") || !strings.Contains(out, "DTEND;TZID=") {
		t.Errorf("DTEND not in TZID format; output:\n%s", out)
	}
}

func TestBuildICal_SkipsClosedEvents(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWednesday, Date: "2026-05-06", IsClosed: true,
	})
	if strings.Contains(buildICal(plan, nil, true, true), "BEGIN:VEVENT") {
		t.Error("closed event must not appear in export")
	}
}

func TestBuildICal_PersonFilter_Included(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWednesday, Date: "2026-05-06",
		AssignedStaff: []string{"a"},
	})
	if !strings.Contains(buildICal(plan, []string{"a"}, false, true), "BEGIN:VEVENT") {
		t.Error("event assigned to 'a' must appear when filtering by 'a'")
	}
}

func TestBuildICal_PersonFilter_Excluded(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWednesday, Date: "2026-05-06",
		AssignedStaff: []string{"b"},
	})
	if strings.Contains(buildICal(plan, []string{"a"}, false, true), "BEGIN:VEVENT") {
		t.Error("event assigned only to 'b' must not appear when filtering by 'a'")
	}
}

func TestBuildICal_EmptyPersonIDs_ExcludesAll(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWednesday, Date: "2026-05-06",
		AssignedStaff: []string{"a"},
	})
	// empty non-nil slice + allPersons=false means no persons selected
	if strings.Contains(buildICal(plan, []string{}, false, true), "BEGIN:VEVENT") {
		t.Error("empty personIDs with allPersons=false must produce no events")
	}
}

func TestBuildICal_NilPersonIDs_IncludesAll(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWednesday, Date: "2026-05-06",
	})
	if !strings.Contains(buildICal(plan, nil, true, true), "BEGIN:VEVENT") {
		t.Error("nil personIDs with allPersons=true must include all events")
	}
}

func TestBuildICal_CalName(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWednesday, Date: "2026-05-06",
	})
	if !strings.Contains(buildICal(plan, nil, true, true), "X-WR-CALNAME:Testteam") {
		t.Error("X-WR-CALNAME:Testteam not found")
	}
}

func TestBuildICal_MultiDayDTEND(t *testing.T) {
	plan := planWithEvent(domain.Event{
		Type: domain.EventTypeWeekend, Date: "2026-05-30", DateEnd: "2026-05-31",
		TimeFrom: "14:00", TimeTo: "17:00",
	})
	out := buildICal(plan, nil, true, true)
	// DTEND must be on the DateEnd date (2026-05-31), not the start date.
	if !strings.Contains(out, ":20260531T170000") || !strings.Contains(out, "DTEND;TZID=") {
		t.Errorf("multi-day DTEND must use DateEnd in TZID format; got:\n%s", out)
	}
}

// ── helper ───────────────────────────────────────────────────────────────────

func date(s string) time.Time {
	d, err := time.Parse("2006-01-02", s)
	if err != nil {
		panic(err)
	}
	return d
}
// ── icalFold ─────────────────────────────────────────────────────────────────

func TestIcalFold_ShortLine_NoFolding(t *testing.T) {
	in := "SUMMARY:Hello"
	got := icalFold(in)
	// Short lines must pass through unchanged.
	if got != in+"\r\n" {
		t.Errorf("icalFold(%q) = %q, want unchanged + CRLF", in, got)
	}
}

func TestIcalFold_ExactlyAtLimit_NoFolding(t *testing.T) {
	// 75 bytes — the limit is ≤75 on the first line, so this must NOT fold.
	in := strings.Repeat("A", 75)
	got := icalFold(in)
	if strings.Contains(got, "\r\n ") {
		t.Errorf("icalFold: unexpected fold in 75-byte line: %q", got)
	}
}

func TestIcalFold_LongLine_FoldsAt75(t *testing.T) {
	// 150 chars — must produce a continuation fold.
	in := strings.Repeat("X", 150)
	got := icalFold(in)
	// RFC 5545: long line split with CRLF + SPACE continuation.
	if !strings.Contains(got, "\r\n ") {
		t.Errorf("icalFold: expected CRLF+SPACE continuation for 150-char line; got:\n%q", got)
	}
	// Reassembled content must equal the original.
	reassembled := strings.ReplaceAll(got, "\r\n ", "")
	reassembled = strings.TrimRight(reassembled, "\r\n")
	if reassembled != in {
		t.Errorf("icalFold: reassembled content mismatch\nwant: %q\ngot:  %q", in, reassembled)
	}
}

func TestIcalFold_VeryLongLine_MultipleWraps(t *testing.T) {
	// 300 chars — needs at least 3 lines.
	in := strings.Repeat("Y", 300)
	got := icalFold(in)
	lineCount := strings.Count(got, "\r\n")
	if lineCount < 3 {
		t.Errorf("icalFold: expected >=3 CRLF for 300-char line, got %d", lineCount)
	}
}
