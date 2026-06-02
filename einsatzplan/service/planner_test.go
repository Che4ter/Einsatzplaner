package service_test

import (
	"context"
	"testing"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/service"
	"einsatzplaner/einsatzplan/storage"
)

func newTestService() (*service.PlannerService, *storage.MemStore) {
	ms := storage.NewMemStore()
	svc := service.NewPlannerService(nil, nil, ms)
	return svc, ms
}

func mustLoadPlan(t *testing.T, svc *service.PlannerService, ms *storage.MemStore) {
	t.Helper()
	plan := storage.NewYearPlan(2026)
	_ = ms.Save("test.json", plan)
	_, err := svc.ReopenPlan(context.Background(), "test.json")
	if err != nil {
		t.Fatalf("ReopenPlan: %v", err)
	}
}

// ── Plan load/query ──────────────────────────────────────────────────────────

func TestGetPlan_Nil_BeforeLoad(t *testing.T) {
	svc, _ := newTestService()
	if svc.GetPlan(context.Background()) != nil {
		t.Error("expected nil plan before any load")
	}
}

func TestReopenPlan(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	plan := svc.GetPlan(context.Background())
	if plan == nil || plan.Year != 2026 {
		t.Fatalf("expected plan year 2026, got %v", plan)
	}
}

func TestGetMonthEvents_Empty(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	events := svc.GetMonthEvents(context.Background(), 5)
	if len(events) != 0 {
		t.Errorf("expected 0 events, got %d", len(events))
	}
}

// ── CreateEvent ──────────────────────────────────────────────────────────────

func TestCreateEvent(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)

	id, err := svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		TimeFrom: "14:00", TimeTo: "17:00", StaffRequired: 2,
	})
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	if id == "" {
		t.Error("expected non-empty ID")
	}

	events := svc.GetMonthEvents(context.Background(), 5)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].ID != id {
		t.Errorf("event ID mismatch: got %q, want %q", events[0].ID, id)
	}
}

func TestCreateEvent_MarksIDirty(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	if svc.IsDirty(context.Background()) {
		t.Error("should not be dirty after load")
	}
	svc.CreateEvent(context.Background(), 1, domain.Event{Type: "wednesday", Date: "2026-01-07"})
	if !svc.IsDirty(context.Background()) {
		t.Error("should be dirty after create")
	}
}

func TestCreateEvent_LogsActivity(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	svc.CreateEvent(context.Background(), 5, domain.Event{Type: "wednesday", Date: "2026-05-06"})
	log := svc.GetActivityLog(context.Background())
	if len(log) != 1 {
		t.Fatalf("expected 1 log entry, got %d", len(log))
	}
	if log[0].Action != domain.ActionCreate {
		t.Errorf("action = %q, want %q", log[0].Action, domain.ActionCreate)
	}
	if log[0].Target.Month != 5 {
		t.Errorf("target month = %d, want 5", log[0].Target.Month)
	}
}

// ── UpdateEvent ──────────────────────────────────────────────────────────────

func TestUpdateEvent(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		Location: "Schörliweg", TimeFrom: "14:00", TimeTo: "17:00",
	})

	err := svc.UpdateEvent(context.Background(), 5, domain.Event{
		ID: id, Type: "wednesday", Date: "2026-05-06",
		Location: "Hegibach", TimeFrom: "14:00", TimeTo: "17:00",
	})
	if err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	events := svc.GetMonthEvents(context.Background(), 5)
	if events[0].Location != "Hegibach" {
		t.Errorf("Location = %q, want Hegibach", events[0].Location)
	}
}

func TestUpdateEvent_LogsLocationChange(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "wednesday", Date: "2026-05-06", Location: "Old",
	})
	svc.UpdateEvent(context.Background(), 5, domain.Event{ID: id, Type: "wednesday", Date: "2026-05-06", Location: "New"})

	log := svc.GetActivityLog(context.Background())
	// newest first: index 0 = update, index 1 = create
	if log[0].Action != domain.ActionEdit {
		t.Errorf("action = %q, want edit", log[0].Action)
	}
	if log[0].Field != "location" {
		t.Errorf("field = %q, want location", log[0].Field)
	}
}

func TestUpdateEvent_LogsClose(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{Type: "wednesday", Date: "2026-05-06"})
	svc.UpdateEvent(context.Background(), 5, domain.Event{ID: id, Type: "wednesday", IsClosed: true, Comment: "Ferien"})
	log := svc.GetActivityLog(context.Background())
	if log[0].Action != domain.ActionClose {
		t.Errorf("action = %q, want close", log[0].Action)
	}
	if log[0].Reason != "Ferien" {
		t.Errorf("reason = %q, want Ferien", log[0].Reason)
	}
}

func TestUpdateEvent_NotFound(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	err := svc.UpdateEvent(context.Background(), 5, domain.Event{ID: "nonexistent", Type: "wednesday", Date: "2026-05-06"})
	if err == nil {
		t.Error("expected error for missing event")
	}
}

func TestUpdateEvent_NoOp_NoLogEntry(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		Location: "Hegibach", TimeFrom: "14:00", TimeTo: "17:00",
	})
	logBefore := svc.GetActivityLog(context.Background())

	// Submit identical data — no field changes, no staff changes.
	err := svc.UpdateEvent(context.Background(), 5, domain.Event{
		ID: id, Type: "wednesday", Date: "2026-05-06",
		Location: "Hegibach", TimeFrom: "14:00", TimeTo: "17:00",
	})
	if err != nil {
		t.Fatalf("UpdateEvent no-op: %v", err)
	}
	logAfter := svc.GetActivityLog(context.Background())
	if len(logAfter) != len(logBefore) {
		t.Errorf("log grew by %d entries on no-op update, want 0", len(logAfter)-len(logBefore))
	}
}

// ── DeleteEvent ──────────────────────────────────────────────────────────────

func TestDeleteEvent(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{Type: "wednesday", Date: "2026-05-06"})
	if err := svc.DeleteEvent(context.Background(), 5, id); err != nil {
		t.Fatalf("DeleteEvent: %v", err)
	}
	events := svc.GetMonthEvents(context.Background(), 5)
	if len(events) != 0 {
		t.Errorf("expected 0 events after delete, got %d", len(events))
	}
}

// ── ToggleStaff ──────────────────────────────────────────────────────────────

func TestToggleStaff_AssignAndUnassign(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	mid, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Anna", Color: "#0d9488", Active: true})
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{Type: "wednesday", Date: "2026-05-06", StaffRequired: 2})

	staff, err := svc.ToggleStaff(context.Background(), 5, id, mid)
	if err != nil {
		t.Fatalf("ToggleStaff assign: %v", err)
	}
	if len(staff) != 1 || staff[0] != mid {
		t.Errorf("staff after assign = %v, want [%s]", staff, mid)
	}

	staff, err = svc.ToggleStaff(context.Background(), 5, id, mid)
	if err != nil {
		t.Fatalf("ToggleStaff unassign: %v", err)
	}
	if len(staff) != 0 {
		t.Errorf("staff after unassign = %v, want []", staff)
	}
}

func TestToggleStaff_LogsAction(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	mid, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Anna", Color: "#0d9488", Active: true})
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{Type: "wednesday", Date: "2026-05-06"})
	svc.ToggleStaff(context.Background(), 5, id, mid)
	log := svc.GetActivityLog(context.Background())
	if log[0].Action != domain.ActionAssign {
		t.Errorf("action = %q, want assign", log[0].Action)
	}
	svc.ToggleStaff(context.Background(), 5, id, mid)
	log = svc.GetActivityLog(context.Background())
	if log[0].Action != domain.ActionUnassign {
		t.Errorf("action = %q, want unassign", log[0].Action)
	}
}

func TestToggleStaff_UnknownMember(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateEvent(context.Background(), 5, domain.Event{Type: "wednesday", Date: "2026-05-06"})
	_, err := svc.ToggleStaff(context.Background(), 5, id, "ghost-id")
	if err == nil {
		t.Error("expected error for unknown member, got nil")
	}
}

// ── Team mutations ───────────────────────────────────────────────────────────

func TestCreateMember(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, err := svc.CreateMember(context.Background(), domain.TeamMember{
		Name: "Anna", Color: "#0d9488", Active: true,
	})
	if err != nil || id == "" {
		t.Fatalf("CreateMember: err=%v id=%q", err, id)
	}
	plan := svc.GetPlan(context.Background())
	if len(plan.Team) != 1 || plan.Team[0].ID != id {
		t.Errorf("team after create: %v", plan.Team)
	}
}

// CreateMember normalises an empty colour to the default so the "stored colour
// is always valid hex" invariant holds on the API path too, not just on
// disk-load. An explicitly invalid (non-empty) colour is still rejected by
// validation rather than silently rewritten.
func TestCreateMember_NormalizesEmptyColor(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, err := svc.CreateMember(context.Background(), domain.TeamMember{Name: "X", Color: ""})
	if err != nil {
		t.Fatalf("CreateMember: %v", err)
	}
	plan := svc.GetPlan(context.Background())
	var got string
	for _, m := range plan.Team {
		if m.ID == id {
			got = m.Color
		}
	}
	if !domain.IsValidHexColor(got) {
		t.Errorf("stored colour %q is not valid hex", got)
	}
	if got != domain.DefaultTeamColor {
		t.Errorf("empty colour = %q, want default %q", got, domain.DefaultTeamColor)
	}
}

func TestCreateMember_RejectsInvalidColor(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	for _, bad := range []string{"red", "#fff;background:url(x)", "0d9488"} {
		if _, err := svc.CreateMember(context.Background(), domain.TeamMember{Name: "X", Color: bad}); err == nil {
			t.Errorf("CreateMember accepted invalid colour %q", bad)
		}
	}
}

func TestUpdateMember_NormalizesColor(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Y", Color: "#123456"})
	plan := svc.GetPlan(context.Background())
	upd := plan.Team[0]
	upd.Color = "" // user cleared the colour field
	if err := svc.UpdateMember(context.Background(), upd); err != nil {
		t.Fatalf("UpdateMember: %v", err)
	}
	plan = svc.GetPlan(context.Background())
	for _, m := range plan.Team {
		if m.ID == id && !domain.IsValidHexColor(m.Color) {
			t.Errorf("cleared colour normalised to %q, not valid hex", m.Color)
		}
	}
}

func TestToggleMemberActive(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Bob", Active: true})
	svc.ToggleMemberActive(context.Background(), id)
	plan := svc.GetPlan(context.Background())
	if plan.Team[0].Active {
		t.Error("expected member to be inactive after toggle")
	}
}

func TestDeleteMember(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Carl"})
	svc.DeleteMember(context.Background(), id)
	plan := svc.GetPlan(context.Background())
	if len(plan.Team) != 0 {
		t.Errorf("expected empty team after delete, got %d", len(plan.Team))
	}
}

func TestDeleteMember_SweepsOrphans(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	mid, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Dana", Color: "#0d9488", Active: true})
	// Assign the member to events in two different months.
	id1, _ := svc.CreateEvent(context.Background(), 3, domain.Event{Type: "wednesday", Date: "2026-03-04"})
	id2, _ := svc.CreateEvent(context.Background(), 9, domain.Event{Type: "wednesday", Date: "2026-09-02"})
	svc.ToggleStaff(context.Background(), 3, id1, mid)
	svc.ToggleStaff(context.Background(), 9, id2, mid)

	svc.DeleteMember(context.Background(), mid)

	for _, tc := range []struct {
		month int
		evID  string
	}{{3, id1}, {9, id2}} {
		events := svc.GetMonthEvents(context.Background(), tc.month)
		for _, e := range events {
			if e.ID == tc.evID {
				for _, sid := range e.AssignedStaff {
					if sid == mid {
						t.Errorf("month %d event %s still contains deleted member", tc.month, tc.evID)
					}
				}
			}
		}
	}
}

func TestUpdateMember(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	id, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Eve", Color: "#0d9488", Active: true})
	err := svc.UpdateMember(context.Background(), domain.TeamMember{ID: id, Name: "Eva", Color: "#0d9488", Active: true})
	if err != nil {
		t.Fatalf("UpdateMember: %v", err)
	}
	plan := svc.GetPlan(context.Background())
	if plan.Team[0].Name != "Eva" {
		t.Errorf("name after update = %q, want Eva", plan.Team[0].Name)
	}
}

func TestUpdateMember_NotFound(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	err := svc.UpdateMember(context.Background(), domain.TeamMember{ID: "ghost", Name: "Ghost", Color: "#0d9488"})
	if err == nil {
		t.Error("expected error for unknown member ID, got nil")
	}
}

// ── Settings ─────────────────────────────────────────────────────────────────

func TestUpdateSettings(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	err := svc.UpdateSettings(context.Background(), domain.Settings{
		TeamName:  "MSS",
		Locations: []string{"Schörliweg"},
	})
	if err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}
	plan := svc.GetPlan(context.Background())
	if plan.Settings.TeamName != "MSS" {
		t.Errorf("TeamName = %q, want MSS", plan.Settings.TeamName)
	}
}

// ── Stats queries ─────────────────────────────────────────────────────────────

func TestGetYearStats_AllMonths(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "wednesday", Date: "2026-05-06", StaffRequired: 2, AssignedStaff: []string{"a", "b"},
		TimeFrom: "14:00", TimeTo: "17:00",
	})
	svc.CreateEvent(context.Background(), 6, domain.Event{
		Type: "wednesday", Date: "2026-06-03", StaffRequired: 2, AssignedStaff: []string{"a"},
		TimeFrom: "14:00", TimeTo: "17:00",
	})
	stats := svc.GetYearStats(context.Background(), 0) // all months
	if stats.TotalEvents != 2 {
		t.Errorf("TotalEvents = %d, want 2", stats.TotalEvents)
	}
	if stats.TotalNeed != 4 {
		t.Errorf("TotalNeed = %d, want 4", stats.TotalNeed)
	}
}

func TestGetYearStats_FilterByMonth(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	svc.CreateEvent(context.Background(), 5, domain.Event{Type: "wednesday", Date: "2026-05-06", StaffRequired: 1})
	svc.CreateEvent(context.Background(), 6, domain.Event{Type: "wednesday", Date: "2026-06-03", StaffRequired: 1})
	stats := svc.GetYearStats(context.Background(), 5)
	if stats.TotalEvents != 1 {
		t.Errorf("filtered stats TotalEvents = %d, want 1", stats.TotalEvents)
	}
}

func TestGetMonthSummaries_HasIssue(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "wednesday", Date: "2026-05-06", StaffRequired: 3, AssignedStaff: []string{"a"},
	})
	summaries := svc.GetMonthSummaries(context.Background())
	if summaries[5].Issues != 1 {
		t.Errorf("month 5 issues = %d, want 1", summaries[5].Issues)
	}
	if summaries[6].Issues != 0 {
		t.Errorf("month 6 issues = %d, want 0", summaries[6].Issues)
	}
}

func TestGetPersonStats(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	mid, _ := svc.CreateMember(context.Background(), domain.TeamMember{Name: "Fiona", Color: "#0d9488", Active: true})
	// Two events: one weekday-type, one weekend-type — both assigned to Fiona.
	svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "wednesday", Date: "2026-05-06",
		StaffRequired: 1, AssignedStaff: []string{mid},
		TimeFrom: "14:00", TimeTo: "17:00",
	})
	svc.CreateEvent(context.Background(), 5, domain.Event{
		Type: "weekend", Date: "2026-05-09", DateEnd: "2026-05-10",
		StaffRequired: 1, AssignedStaff: []string{mid},
		TimeFrom: "09:00", TimeTo: "17:00",
	})

	stats := svc.GetPersonStats(context.Background(), 0)
	if len(stats) != 1 {
		t.Fatalf("expected 1 person stat, got %d", len(stats))
	}
	ps := stats[0]
	if ps.ID != mid {
		t.Errorf("ID = %q, want %q", ps.ID, mid)
	}
	if ps.Wkd != 1 {
		t.Errorf("Wkd = %d, want 1", ps.Wkd)
	}
	if ps.Wke != 2 { // weekend event spans 2 days
		t.Errorf("Wke = %d, want 2", ps.Wke)
	}
	if ps.Total != 3 {
		t.Errorf("Total = %d, want 3", ps.Total)
	}
}
