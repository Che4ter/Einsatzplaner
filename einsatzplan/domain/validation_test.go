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

// ── ValidateEvent — time range & prep/teardown ───────────────────────────────

func TestValidateEvent_TimeInversion_Error(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", TimeFrom: "17:00", TimeTo: "14:00"}
	if err := domain.ValidateEvent(ev); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for inverted time range, got %v", err)
	}
}

func TestValidateEvent_TimeEqual_Error(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", TimeFrom: "14:00", TimeTo: "14:00"}
	if err := domain.ValidateEvent(ev); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent when timeTo == timeFrom, got %v", err)
	}
}

func TestValidateEvent_ValidTimeRange(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", TimeFrom: "14:00", TimeTo: "17:00"}
	if err := domain.ValidateEvent(ev); err != nil {
		t.Errorf("unexpected error for valid time range: %v", err)
	}
}

func TestValidateEvent_SetupAfterStart_Error(t *testing.T) {
	ev := domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		TimeFrom: "14:00", TimeTo: "17:00",
		TimeSetup: "15:00", // starts AFTER the event start
	}
	if err := domain.ValidateEvent(ev); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent when timeSetup > timeFrom, got %v", err)
	}
}

func TestValidateEvent_ValidSetup(t *testing.T) {
	ev := domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		TimeFrom: "14:00", TimeTo: "17:00",
		TimeSetup: "13:00",
	}
	if err := domain.ValidateEvent(ev); err != nil {
		t.Errorf("unexpected error for valid timeSetup: %v", err)
	}
}

func TestValidateEvent_TeardownBeforeEnd_Error(t *testing.T) {
	ev := domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		TimeFrom: "14:00", TimeTo: "17:00",
		TimeTeardown: "16:00", // ends BEFORE the event end
	}
	if err := domain.ValidateEvent(ev); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent when timeTeardown < timeTo, got %v", err)
	}
}

func TestValidateEvent_ValidTeardown(t *testing.T) {
	ev := domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		TimeFrom: "14:00", TimeTo: "17:00",
		TimeTeardown: "18:00",
	}
	if err := domain.ValidateEvent(ev); err != nil {
		t.Errorf("unexpected error for valid timeTeardown: %v", err)
	}
}

func TestValidateEvent_InvalidTimeSetup_BadFormat(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", TimeFrom: "14:00", TimeTo: "17:00", TimeSetup: "25:00"}
	if err := domain.ValidateEvent(ev); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for malformed timeSetup, got %v", err)
	}
}

func TestValidateEvent_InvalidTimeTeardown_BadFormat(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-05-06", TimeFrom: "14:00", TimeTo: "17:00", TimeTeardown: "bad"}
	if err := domain.ValidateEvent(ev); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for malformed timeTeardown, got %v", err)
	}
}

// ── ValidateEvent — year parameter ───────────────────────────────────────────

func TestValidateEvent_DateInWrongYear_Error(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2025-03-04"}
	if err := domain.ValidateEvent(ev, 2026); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for date in wrong year, got %v", err)
	}
}

func TestValidateEvent_DateInCorrectYear_OK(t *testing.T) {
	ev := domain.Event{Type: "wednesday", Date: "2026-03-04"}
	if err := domain.ValidateEvent(ev, 2026); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidateEvent_DateEndInWrongYear_Error(t *testing.T) {
	ev := domain.Event{Type: "weekend", Date: "2026-12-31", DateEnd: "2027-01-01"}
	if err := domain.ValidateEvent(ev, 2026); !errors.Is(err, domain.ErrInvalidEvent) {
		t.Errorf("expected ErrInvalidEvent for dateEnd in wrong year, got %v", err)
	}
}

// ── NormalizeMemberColor ─────────────────────────────────────────────────────

func TestNormalizeMemberColor_ValidHex_Passthrough(t *testing.T) {
	if got := domain.NormalizeMemberColor("#0d9488"); got != "#0d9488" {
		t.Errorf("NormalizeMemberColor(%q) = %q, want %q", "#0d9488", got, "#0d9488")
	}
}

func TestNormalizeMemberColor_InvalidColor_ReturnsDefault(t *testing.T) {
	got := domain.NormalizeMemberColor("not-a-color")
	if got != domain.DefaultTeamColor {
		t.Errorf("NormalizeMemberColor(invalid) = %q, want DefaultTeamColor %q", got, domain.DefaultTeamColor)
	}
}

func TestNormalizeMemberColor_EmptyString_ReturnsDefault(t *testing.T) {
	got := domain.NormalizeMemberColor("")
	if got != domain.DefaultTeamColor {
		t.Errorf("NormalizeMemberColor(%q) = %q, want DefaultTeamColor %q", "", got, domain.DefaultTeamColor)
	}
}

func TestNormalizeMemberColor_ShortHex_Passthrough(t *testing.T) {
	if got := domain.NormalizeMemberColor("#abc"); got != "#abc" {
		t.Errorf("NormalizeMemberColor(%q) = %q, want passthrough", "#abc", got)
	}
}
