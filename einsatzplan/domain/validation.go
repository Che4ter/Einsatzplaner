package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Sentinel errors — use errors.Is for matching.
var (
	ErrInvalidEvent  = errors.New("invalid event")
	ErrInvalidMember = errors.New("invalid team member")
)

func isValidEventType(t string) bool {
	switch t {
	case EventTypeWednesday, EventTypeWeekday, EventTypeWeekend:
		return true
	}
	return false
}

// ValidateEvent returns a descriptive error if ev is not well-formed.
// A closed event (isClosed=true) only requires a valid Type.
// year, when non-zero, is used to verify that Date and DateEnd belong to that year.
func ValidateEvent(ev Event, year ...int) error {
	if !isValidEventType(ev.Type) {
		return fmt.Errorf("%w: type %q is not one of wednesday|weekday|weekend", ErrInvalidEvent, ev.Type)
	}
	if ev.IsClosed {
		return nil // closed events carry no scheduling data
	}
	if ev.Date == "" {
		return fmt.Errorf("%w: date is required", ErrInvalidEvent)
	}
	if !isValidDate(ev.Date) {
		return fmt.Errorf("%w: date %q must be YYYY-MM-DD", ErrInvalidEvent, ev.Date)
	}
	if len(year) > 0 && year[0] != 0 {
		y := year[0]
		d, _ := time.Parse("2006-01-02", ev.Date)
		if d.Year() != y {
			return fmt.Errorf("%w: date %q must be in year %d", ErrInvalidEvent, ev.Date, y)
		}
		if ev.DateEnd != "" {
			if !isValidDate(ev.DateEnd) {
				return fmt.Errorf("%w: dateEnd %q must be YYYY-MM-DD", ErrInvalidEvent, ev.DateEnd)
			}
			de, _ := time.Parse("2006-01-02", ev.DateEnd)
			if de.Year() != y {
				return fmt.Errorf("%w: dateEnd %q must be in year %d", ErrInvalidEvent, ev.DateEnd, y)
			}
		}
	} else {
		if ev.DateEnd != "" && !isValidDate(ev.DateEnd) {
			return fmt.Errorf("%w: dateEnd %q must be YYYY-MM-DD", ErrInvalidEvent, ev.DateEnd)
		}
	}
	if ev.DateEnd != "" && ev.DateEnd < ev.Date {
		return fmt.Errorf("%w: dateEnd must not be before date", ErrInvalidEvent)
	}
	if ev.StaffRequired < 0 {
		return fmt.Errorf("%w: staffRequired must be >= 0", ErrInvalidEvent)
	}
	if ev.TimeFrom != "" && !isValidHHMM(ev.TimeFrom) {
		return fmt.Errorf("%w: timeFrom %q must be HH:MM", ErrInvalidEvent, ev.TimeFrom)
	}
	if ev.TimeTo != "" && !isValidHHMM(ev.TimeTo) {
		return fmt.Errorf("%w: timeTo %q must be HH:MM", ErrInvalidEvent, ev.TimeTo)
	}
	if ev.TimeFrom != "" && ev.TimeTo != "" {
		fh, fm, _ := parseHHMM(ev.TimeFrom)
		th, tm, _ := parseHHMM(ev.TimeTo)
		if th*60+tm <= fh*60+fm {
			return fmt.Errorf("%w: timeTo %q must be after timeFrom %q", ErrInvalidEvent, ev.TimeTo, ev.TimeFrom)
		}
	}
	return nil
}

// ValidateTeamMember returns an error if m is not well-formed.
func ValidateTeamMember(m TeamMember) error {
	if strings.TrimSpace(m.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalidMember)
	}
	if m.Color != "" && !isValidHexColor(m.Color) {
		return fmt.Errorf("%w: color %q must be a hex color (#rrggbb)", ErrInvalidMember, m.Color)
	}
	return nil
}

// isValidDate reports whether s is a valid YYYY-MM-DD date.
func isValidDate(s string) bool {
	_, err := time.Parse("2006-01-02", s)
	return err == nil
}

// isValidHHMM reports whether s is a valid HH:MM time string (00:00–23:59).
func isValidHHMM(s string) bool {
	h, m, ok := parseHHMM(s)
	return ok && h >= 0 && h <= 23 && m >= 0 && m <= 59
}

// isValidHexColor reports whether s is a CSS hex color (#rgb or #rrggbb).
func isValidHexColor(s string) bool {
	if len(s) == 0 || s[0] != '#' {
		return false
	}
	rest := s[1:]
	if len(rest) != 3 && len(rest) != 6 {
		return false
	}
	for _, c := range rest {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}
