package service

import (
	"fmt"
	"strings"
	"time"

	"einsatzplaner/einsatzplan/domain"
)

// buildICal produces an iCalendar (RFC 5545) string for the given plan.
//
// personIDs controls filtering:
//   - non-empty: include only events where at least one of the given members is assigned
//   - empty (nil or len==0): include no events (caller must pass nil to mean "all")
//
// Use the sentinel nil to export all events regardless of assignment.
func buildICal(plan *domain.YearPlan, personIDs []string, allPersons bool, includePrep bool) string {
	personSet := make(map[string]bool, len(personIDs))
	for _, id := range personIDs {
		personSet[id] = true
	}

	teamByID := make(map[string]domain.TeamMember, len(plan.Team))
	for _, m := range plan.Team {
		teamByID[m.ID] = m
	}

	tzid := time.Local.String()

	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//Einsatzplan//DE\r\n")
	sb.WriteString("CALSCALE:GREGORIAN\r\n")
	sb.WriteString("METHOD:PUBLISH\r\n")
	if plan.Settings.TeamName != "" {
		sb.WriteString(icalFold("X-WR-CALNAME:" + icalEscape(plan.Settings.TeamName)))
	}
	sb.WriteString(vtimezone(tzid, plan.Year))

	for month := 1; month <= 12; month++ {
		mo := plan.Months[month]
		if mo == nil {
			continue
		}
		for _, ev := range mo.Events {
			if ev.IsClosed {
				continue
			}
			if !allPersons {
				matched := false
				for _, id := range ev.AssignedStaff {
					if personSet[id] {
						matched = true
						break
					}
				}
				if !matched {
					continue
				}
			}

			startDate, err := time.Parse("2006-01-02", ev.Date)
			if err != nil {
				continue
			}

			dtStart, dtEnd := icalDateTimes(ev, startDate, includePrep)

			summary := ev.Location
			if summary == "" {
				summary = plan.Settings.TeamName
			}

			sb.WriteString("BEGIN:VEVENT\r\n")
			sb.WriteString(fmt.Sprintf("UID:%s-%d-%s@einsatzplan\r\n", ev.ID, plan.Year, ev.Date))
			fmt.Fprintf(&sb, "%s\r\n", dtStart)
			fmt.Fprintf(&sb, "%s\r\n", dtEnd)
			sb.WriteString(icalFold("SUMMARY:" + icalEscape(summary)))
			if desc := icalDescription(ev, teamByID); desc != "" {
				sb.WriteString(icalFold("DESCRIPTION:" + desc))
			}
			if ev.Location != "" {
				sb.WriteString(icalFold("LOCATION:" + icalEscape(ev.Location)))
			}
			sb.WriteString("END:VEVENT\r\n")
		}
	}
	sb.WriteString("END:VCALENDAR\r\n")
	return sb.String()
}

// icalDateTimes returns the DTSTART and DTEND property strings for an event.
// Timed events reference the system local TZID so calendar apps honour DST.
// All-day events fall back to DATE values.
func icalDateTimes(ev domain.Event, startDate time.Time, includePrep bool) (dtStart, dtEnd string) {
	tzid := time.Local.String()

	endDate := startDate
	if ev.DateEnd != "" {
		if d, err := time.Parse("2006-01-02", ev.DateEnd); err == nil {
			endDate = d
		}
	}

	if ev.TimeFrom != "" && ev.TimeTo != "" {
		startTimeStr := ev.TimeFrom
		endTimeStr := ev.TimeTo
		if includePrep {
			if ev.TimeSetup != "" {
				startTimeStr = ev.TimeSetup
			}
			if ev.TimeTeardown != "" {
				endTimeStr = ev.TimeTeardown
			}
		}
		tf, err1 := time.Parse("15:04", startTimeStr)
		tt, err2 := time.Parse("15:04", endTimeStr)
		if err1 == nil && err2 == nil {
			start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(),
				tf.Hour(), tf.Minute(), 0, 0, time.Local)
			end := time.Date(endDate.Year(), endDate.Month(), endDate.Day(),
				tt.Hour(), tt.Minute(), 0, 0, time.Local)
			return "DTSTART;TZID=" + tzid + ":" + start.Format("20060102T150405"),
				"DTEND;TZID=" + tzid + ":" + end.Format("20060102T150405")
		}
	}

	// All-day fallback: DTEND is exclusive so add one day past the end date.
	return "DTSTART;VALUE=DATE:" + startDate.Format("20060102"),
		"DTEND;VALUE=DATE:" + endDate.AddDate(0, 0, 1).Format("20060102")
}

// vtimezone emits a VTIMEZONE component for the given IANA tzid and year.
// It computes the actual STANDARD and DAYLIGHT transitions for that year from
// Go's embedded tz database, so the output is always correct for the host
// timezone without any hardcoded rules.
func vtimezone(tzid string, year int) string {
	loc, err := time.LoadLocation(tzid)
	if err != nil {
		loc = time.UTC
		tzid = "UTC"
	}

	// Walk through the year one hour at a time and collect every offset
	// transition. This works for any timezone, including those with more than
	// one DST transition per year.
	type transition struct {
		at     time.Time
		name   string
		offset int // seconds east of UTC
	}
	var transitions []transition

	t := time.Date(year, 1, 1, 0, 0, 0, 0, loc)
	end := time.Date(year+1, 1, 1, 0, 0, 0, 0, loc)
	prevName, prevOffset := t.Zone()

	for t.Before(end) {
		t = t.Add(time.Hour)
		name, offset := t.Zone()
		if name != prevName || offset != prevOffset {
			transitions = append(transitions, transition{at: t, name: name, offset: offset})
			prevName, prevOffset = name, offset
		}
	}

	fmtOffset := func(secs int) string {
		sign := "+"
		if secs < 0 {
			sign = "-"
			secs = -secs
		}
		return fmt.Sprintf("%s%02d%02d", sign, secs/3600, (secs%3600)/60)
	}

	var sb strings.Builder
	sb.WriteString("BEGIN:VTIMEZONE\r\n")
	fmt.Fprintf(&sb, "TZID:%s\r\n", tzid)

	// Emit one STANDARD block (lowest offset = winter time).
	// Emit one DAYLIGHT block per DST transition found.
	// If no transitions were found the timezone is fixed-offset — emit only STANDARD.
	_, baseOffset := time.Date(year, 1, 1, 12, 0, 0, 0, loc).Zone()

	if len(transitions) == 0 {
		sb.WriteString("BEGIN:STANDARD\r\n")
		fmt.Fprintf(&sb, "TZOFFSETFROM:%s\r\n", fmtOffset(baseOffset))
		fmt.Fprintf(&sb, "TZOFFSETTO:%s\r\n", fmtOffset(baseOffset))
		fmt.Fprintf(&sb, "DTSTART:%s\r\n", time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC).Format("20060102T150405"))
		sb.WriteString("END:STANDARD\r\n")
	} else {
		// The offset in effect before the first transition is the "from" for the first block.
		_, preTxOffset := time.Date(year, 1, 1, 0, 0, 0, 0, loc).Zone()
		prevOff := preTxOffset
		for _, tx := range transitions {
			isDST := tx.offset > baseOffset
			if isDST {
				sb.WriteString("BEGIN:DAYLIGHT\r\n")
			} else {
				sb.WriteString("BEGIN:STANDARD\r\n")
			}
			fmt.Fprintf(&sb, "TZOFFSETFROM:%s\r\n", fmtOffset(prevOff))
			fmt.Fprintf(&sb, "TZOFFSETTO:%s\r\n", fmtOffset(tx.offset))
			// DTSTART in local wall-clock time of the transition.
			local := tx.at.In(loc)
			fmt.Fprintf(&sb, "DTSTART:%s\r\n", local.Format("20060102T150405"))
			fmt.Fprintf(&sb, "TZNAME:%s\r\n", tx.name)
			if isDST {
				sb.WriteString("END:DAYLIGHT\r\n")
			} else {
				sb.WriteString("END:STANDARD\r\n")
			}
			prevOff = tx.offset
		}
	}

	sb.WriteString("END:VTIMEZONE\r\n")
	return sb.String()
}

// icalDescription builds the escaped DESCRIPTION value from team names and comment.
// Each part is escaped individually before being joined so separators are not double-escaped.
func icalDescription(ev domain.Event, teamByID map[string]domain.TeamMember) string {
	var parts []string
	var names []string
	for _, id := range ev.AssignedStaff {
		if m, ok := teamByID[id]; ok {
			names = append(names, m.Name)
		}
	}
	if len(names) > 0 {
		parts = append(parts, icalEscape("Team: "+strings.Join(names, ", ")))
	}
	if ev.Comment != "" {
		parts = append(parts, icalEscape(ev.Comment))
	}
	return strings.Join(parts, `\n`)
}

// icalEscape applies RFC 5545 text escaping (backslash, semicolons, commas, newlines).
func icalEscape(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, ";", `\;`)
	s = strings.ReplaceAll(s, ",", `\,`)
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}

// icalFold wraps a property line at 75 octets per RFC 5545 §3.1.
// Returns the folded line(s) terminated with \r\n.
func icalFold(line string) string {
	const max = 75
	if len(line) <= max {
		return line + "\r\n"
	}
	var sb strings.Builder
	for i := 0; len(line) > 0; i++ {
		chunk := max
		if i > 0 {
			chunk = max - 1 // continuation lines start with one space (already written)
		}
		if chunk > len(line) {
			chunk = len(line)
		}
		// Don't split a multi-byte UTF-8 rune.
		for chunk > 0 && chunk < len(line) && line[chunk]&0xC0 == 0x80 {
			chunk--
		}
		if i > 0 {
			sb.WriteString(" ")
		}
		sb.WriteString(line[:chunk])
		sb.WriteString("\r\n")
		line = line[chunk:]
	}
	return sb.String()
}
