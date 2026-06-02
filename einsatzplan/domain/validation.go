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

// DefaultTeamColor is applied to team members whose color is missing or not a
// valid CSS hex color. Centralising it here keeps the "stored color is always
// valid hex" invariant in one place: both the storage layer (on load) and the
// service layer (on create/update) call NormalizeMemberColor.
const DefaultTeamColor = "#0d9488"

// NormalizeMemberColor returns color unchanged if it is a valid CSS hex color,
// otherwise DefaultTeamColor. This prevents an empty or crafted value from being
// interpolated into a style attribute in the frontend.
func NormalizeMemberColor(color string) string {
	if IsValidHexColor(color) {
		return color
	}
	return DefaultTeamColor
}

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
	if ev.TimeSetup != "" {
		if !isValidHHMM(ev.TimeSetup) {
			return fmt.Errorf("%w: timeSetup %q must be HH:MM", ErrInvalidEvent, ev.TimeSetup)
		}
		// Setup must start no later than the event start.
		if ev.TimeFrom != "" && minutes(ev.TimeSetup) > minutes(ev.TimeFrom) {
			return fmt.Errorf("%w: timeSetup %q must not be after timeFrom %q", ErrInvalidEvent, ev.TimeSetup, ev.TimeFrom)
		}
	}
	if ev.TimeTeardown != "" {
		if !isValidHHMM(ev.TimeTeardown) {
			return fmt.Errorf("%w: timeTeardown %q must be HH:MM", ErrInvalidEvent, ev.TimeTeardown)
		}
		// Teardown must end no earlier than the event end.
		if ev.TimeTo != "" && minutes(ev.TimeTeardown) < minutes(ev.TimeTo) {
			return fmt.Errorf("%w: timeTeardown %q must not be before timeTo %q", ErrInvalidEvent, ev.TimeTeardown, ev.TimeTo)
		}
	}
	return nil
}

// minutes converts a valid HH:MM string to minutes since midnight.
// Returns 0 for malformed input (callers validate format beforehand).
func minutes(hhmm string) int {
	h, m, ok := parseHHMM(hhmm)
	if !ok {
		return 0
	}
	return h*60 + m
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
	return IsValidHexColor(s)
}

// IsValidHexColor reports whether s is a CSS hex color (#rgb or #rrggbb).
// Exported so the storage layer can sanitize untrusted colors loaded from disk
// before they are interpolated into CSS style attributes in the frontend.
func IsValidHexColor(s string) bool {
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
