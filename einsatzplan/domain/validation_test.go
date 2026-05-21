package domain_test

import (
	"errors"
	"testing"

	"einsatzplaner/einsatzplan/domain"
)

// ── ValidateEvent ────────────────────────────────────────────────────────────

func TestValidateEvent_Valid(t *testing.T) {
	ev := domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		TimeFrom: "14:00", TimeTo: "17:00", StaffRequired: 2,
	}
	if err := domain.ValidateEvent(ev); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidateEvent_ValidWeekend(t *testing.T) {
	ev := domain.Event{
		Type: "weekend", Date: "2026-05-30", DateEnd: "2026-05-31",
		StaffRequired: 3,
	}
	if err := domain.ValidateEvent(ev); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidateEvent_ClosedRequiresOnlyType(t *testing.T) {
	ev := domain.Event{Type: "weekday", IsClosed: true}
	if err := domain.ValidateEvent(ev); err != nil {
		t.Errorf("closed event should pass without date: %v", err)
	}
}

func TestValidateEvent_UnknownType(t *testing.T) {
	ev := domain.Event{Type: "daily", Date: "2026-05-06"}
	err := domain.ValidateEvent(ev)
	if !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for unknown type, got %v", err)
	}
}

func TestValidateEvent_MissingDate(t *testing.T) {
	ev := domain.Event{Type: "wednesday"}
	err := domain.ValidateEvent(ev)
	if !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for missing date, got %v", err)
	}
}

func TestValidateEvent_InvalidDate(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "06-05-2026"}
	err := domain.ValidateEvent(ev)
	if !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for malformed date, got %v", err)
	}
}

func TestValidateEvent_DateEndBeforeDate(t *testing.T) {
	ev := domain.Event{Type: "weekend", Date: "2026-05-31", DateEnd: "2026-05-30"}
	err := domain.ValidateEvent(ev)
	if !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for dateEnd < date, got %v", err)
	}
}

func TestValidateEvent_NegativeStaffRequired(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", StaffRequired: -1}
	err := domain.ValidateEvent(ev)
	if !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for negative staffRequired, got %v", err)
	}
}

func TestValidateEvent_InvalidTimeFrom(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", TimeFrom: "25:00", TimeTo: "17:00"}
	err := domain.ValidateEvent(ev)
	if !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for invalid timeFrom, got %v", err)
	}
}

func TestValidateEvent_InvalidTimeTo(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", TimeFrom: "14:00", TimeTo: "99:99"}
	err := domain.ValidateEvent(ev)
	if !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for invalid timeTo, got %v", err)
	}
}

// ── ValidateTeamMember ───────────────────────────────────────────────────────

func TestValidateTeamMember_Valid(t *testing.T) {
	m := domain.TeamMember{Name: "Anna", Color: "#0d9488"}
	if err := domain.ValidateTeamMember(m); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidateTeamMember_EmptyName(t *testing.T) {
	m := domain.TeamMember{Name: "  ", Color: "#0d9488"}
	err := domain.ValidateTeamMember(m)
	if !errors.Is(err, domain.ErrInvalidMember) {
		t.Errorf("expected ErrInvalidMember for empty name, got %v", err)
	}
}

func TestValidateTeamMember_BadColor(t *testing.T) {
	m := domain.TeamMember{Name: "Anna", Color: "blue"}
	err := domain.ValidateTeamMember(m)
	if !errors.Is(err, domain.ErrInvalidMember) {
		t.Errorf("expected ErrInvalidMember for invalid color, got %v", err)
	}
}

func TestValidateTeamMember_NoColor(t *testing.T) {
	// Empty color is allowed (not yet assigned)
	m := domain.TeamMember{Name: "Anna"}
	if err := domain.ValidateTeamMember(m); err != nil {
		t.Errorf("unexpected error for empty color: %v", err)
	}
}

func TestValidateTeamMember_ShortHexColor(t *testing.T) {
	m := domain.TeamMember{Name: "Anna", Color: "#abc"}
	if err := domain.ValidateTeamMember(m); err != nil {
		t.Errorf("unexpected error for 3-char hex color: %v", err)
	}
}
