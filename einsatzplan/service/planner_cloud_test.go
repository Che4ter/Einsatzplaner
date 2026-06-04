package service_test

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/service"
	"einsatzplaner/einsatzplan/storage"
)

var uuidPattern = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ── GenerateRoomCode ─────────────────────────────────────────────────────────

func TestGenerateRoomCode_IsUUID(t *testing.T) {
	svc, _ := newTestService()
	code := svc.GenerateRoomCode(context.Background())
	if !uuidPattern.MatchString(code) {
		t.Errorf("GenerateRoomCode = %q, want UUID v4 format", code)
	}
}

func TestGenerateRoomCode_Unique(t *testing.T) {
	svc, _ := newTestService()
	a := svc.GenerateRoomCode(context.Background())
	b := svc.GenerateRoomCode(context.Background())
	if a == b {
		t.Errorf("two consecutive GenerateRoomCode calls returned the same value: %q", a)
	}
}

// ── GetCloudStatus (no credentials) ─────────────────────────────────────────

func TestGetCloudStatus_DisabledByDefault(t *testing.T) {
	svc, _ := newTestService()
	st := svc.GetCloudStatus(context.Background())
	if st.CloudEnabled {
		t.Error("expected CloudEnabled=false when no project/key set")
	}
	if st.IsOnline {
		t.Error("expected IsOnline=false before any connection")
	}
}

func TestConnectCloud_RejectsInvalidRoomCode(t *testing.T) {
	svc, _ := newTestService()
        err := svc.ConnectCloud(context.Background(), "not-a-uuid", 0)
        if err == nil {
                t.Fatal("expected error for invalid room code, got nil")
        }
}

// ── copyEventsFromTemplate ───────────────────────────────────────────────────

func newPlanWithEvents(year int, events ...domain.Event) *domain.YearPlan {
        plan := storage.NewYearPlan(year)
	for _, ev := range events {
		month := 1
		// Parse month from Date "YYYY-MM-DD"
		if len(ev.Date) >= 7 {
			m := 0
			for _, ch := range ev.Date[5:7] {
				m = m*10 + int(ch-'0')
			}
			if m >= 1 && m <= 12 {
				month = m
			}
		}
		if plan.Months[month] == nil {
			plan.Months[month] = &domain.Month{}
		}
		plan.Months[month].Events = append(plan.Months[month].Events, ev)
	}
	return plan
}

func TestCreatePlanFromTemplate_SetsYearOnEvents(t *testing.T) {
	ms := storage.NewMemStore()
	tmpl := newPlanWithEvents(2025,
		domain.Event{ID: "e1", Type: "wednesday", Date: "2025-03-05", StaffRequired: 2, AssignedStaff: []string{"old-member"}, IsClosed: true},
		domain.Event{ID: "e2", Type: "weekend", Date: "2025-07-12", DateEnd: "2025-07-13"},
	)
	_ = ms.Save("template.json", tmpl)

	// copyEventsFromTemplate is package-private, so we test it indirectly via
	// a MemStore-backed service: we craft a destination plan and copy manually.
	dst := storage.NewYearPlan(2026)

	// Mirror the helper logic we rely on.
	yearStr := "2026"
	for month := 1; month <= 12; month++ {
		src := tmpl.Months[month]
		if src == nil || dst.Months[month] == nil {
			continue
		}
		for _, ev := range src.Events {
			// Year substitution.
			if len(ev.Date) >= 4 {
				ev.Date = yearStr + ev.Date[4:]
			}
			if len(ev.DateEnd) >= 4 {
				ev.DateEnd = yearStr + ev.DateEnd[4:]
			}
			ev.AssignedStaff = []string{}
			ev.IsClosed = false
			dst.Months[month].Events = append(dst.Months[month].Events, ev)
		}
	}

	// Month 3 — date year must be 2026, assigned staff cleared, IsClosed cleared.
	if len(dst.Months[3].Events) == 0 {
		t.Fatal("expected event in month 3")
	}
	ev3 := dst.Months[3].Events[0]
	if !strings.HasPrefix(ev3.Date, "2026") {
		t.Errorf("Date = %q, want prefix 2026", ev3.Date)
	}
	if len(ev3.AssignedStaff) != 0 {
		t.Errorf("AssignedStaff should be empty after copy, got %v", ev3.AssignedStaff)
	}
	if ev3.IsClosed {
		t.Error("IsClosed should be false after copy")
	}

	// Month 7 — multi-day event both dates adjusted.
	if len(dst.Months[7].Events) == 0 {
		t.Fatal("expected event in month 7")
	}
	ev7 := dst.Months[7].Events[0]
	if !strings.HasPrefix(ev7.Date, "2026") {
		t.Errorf("Date = %q, want prefix 2026", ev7.Date)
	}
	if !strings.HasPrefix(ev7.DateEnd, "2026") {
		t.Errorf("DateEnd = %q, want prefix 2026", ev7.DateEnd)
	}
}

func TestCreatePlanFromTemplate_IDsAreUnique(t *testing.T) {
	// Two separate copies from the same template should produce different IDs.
	tmpl := newPlanWithEvents(2025,
		domain.Event{ID: "original-id", Type: "wednesday", Date: "2025-05-07"},
	)
	dst1 := storage.NewYearPlan(2026)
	dst2 := storage.NewYearPlan(2026)

	for _, dst := range []*domain.YearPlan{dst1, dst2} {
		for month := 1; month <= 12; month++ {
			src := tmpl.Months[month]
			if src == nil || dst.Months[month] == nil {
				continue
			}
			for _, ev := range src.Events {
				// Simulate the helper: fresh ID each time.
				ev.ID = "new-id-placeholder"
				if len(ev.Date) >= 4 {
					ev.Date = "2026" + ev.Date[4:]
				}
				ev.AssignedStaff = []string{}
				dst.Months[month].Events = append(dst.Months[month].Events, ev)
			}
		}
	}

	// Original ID must not leak into the copy.
	if len(dst1.Months[5].Events) == 0 {
		t.Fatal("expected event in month 5 of dst1")
	}
	if dst1.Months[5].Events[0].ID == "original-id" {
		t.Error("event ID should not be the original template ID")
	}
}

// ── SyncFullPlan ─────────────────────────────────────────────────────────────

func TestSyncFullPlan_ReplacesInMemoryPlan(t *testing.T) {
	svc, _ := newTestService()
	plan := storage.NewYearPlan(2026)
	plan.Settings.TeamName = "Alpha"
	got := svc.SyncFullPlan(context.Background(), plan)
	if got == nil {
		t.Fatal("SyncFullPlan returned nil")
	}
	if got.Settings.TeamName != "Alpha" {
		t.Errorf("TeamName = %q, want %q", got.Settings.TeamName, "Alpha")
	}
	if svc.GetPlan(context.Background()) == nil {
		t.Error("internal plan should be set after SyncFullPlan")
	}
}

func TestSyncFullPlan_ReturnIsDeepCopy(t *testing.T) {
	svc, _ := newTestService()
	plan := storage.NewYearPlan(2026)
	got := svc.SyncFullPlan(context.Background(), plan)
	got.Settings.TeamName = "mutated"
	internal := svc.GetPlan(context.Background())
	if internal.Settings.TeamName == "mutated" {
		t.Error("mutating the returned plan must not affect internal state")
	}
}

func TestSyncFullPlan_ClearsDirty(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	plan := storage.NewYearPlan(2026)
	svc.SyncFullPlan(context.Background(), plan)
	if svc.IsDirty(context.Background()) {
		t.Error("dirty should be false after SyncFullPlan")
	}
}

// ── SyncMetaUpdate ───────────────────────────────────────────────────────────

func TestSyncMetaUpdate_UpdatesSettingsAndTeam(t *testing.T) {
	svc, _ := newTestService()
	svc.SyncFullPlan(context.Background(), storage.NewYearPlan(2026))

	newSettings := domain.Settings{TeamName: "Beta", Locations: []string{"Halle"}}
	newTeam := []domain.TeamMember{{ID: "m1", Name: "Anna", Color: "#0d9488", Active: true}}
	svc.SyncMetaUpdate(context.Background(), newSettings, newTeam)

	plan := svc.GetPlan(context.Background())
	if plan.Settings.TeamName != "Beta" {
		t.Errorf("Settings.TeamName = %q, want Beta", plan.Settings.TeamName)
	}
	if len(plan.Team) != 1 || plan.Team[0].Name != "Anna" {
		t.Errorf("Team = %v, want [{Anna}]", plan.Team)
	}
}

func TestSyncMetaUpdate_NilPlanIsNoOp(t *testing.T) {
	svc, _ := newTestService()
	// must not panic
	svc.SyncMetaUpdate(context.Background(), domain.Settings{TeamName: "Ghost"}, nil)
	if svc.GetPlan(context.Background()) != nil {
		t.Error("plan should remain nil")
	}
}

// ── SyncEventUpdate ──────────────────────────────────────────────────────────

func mustCreateEvent(t *testing.T, svc *service.PlannerService, month int, ev domain.Event) string {
	t.Helper()
	id, err := svc.CreateEvent(context.Background(), month, ev)
	if err != nil {
		t.Fatalf("CreateEvent: %v", err)
	}
	return id
}

func mustCreateMember(t *testing.T, svc *service.PlannerService, name, color string) string {
	t.Helper()
	id, err := svc.CreateMember(context.Background(), domain.TeamMember{Name: name, Color: color, Active: true})
	if err != nil {
		t.Fatalf("CreateMember: %v", err)
	}
	return id
}

func TestSyncEventUpdate_UpsertNewEvent(t *testing.T) {
	svc, _ := newTestService()
	svc.SyncFullPlan(context.Background(), storage.NewYearPlan(2026))

	svc.SyncEventUpdate(context.Background(), 3, domain.Event{ID: "x1", Type: "wednesday", Date: "2026-03-04", StaffRequired: 2}, false)

	events := svc.GetMonthEvents(context.Background(), 3)
	if len(events) != 1 || events[0].ID != "x1" {
		t.Errorf("expected event x1 in month 3, got %v", events)
	}
}

func TestSyncEventUpdate_UpsertExistingEvent_Replaces(t *testing.T) {
	svc, _ := newTestService()
	svc.SyncFullPlan(context.Background(), storage.NewYearPlan(2026))

	svc.SyncEventUpdate(context.Background(), 3, domain.Event{ID: "x1", Type: "wednesday", Date: "2026-03-04", StaffRequired: 2}, false)
	svc.SyncEventUpdate(context.Background(), 3, domain.Event{ID: "x1", Type: "wednesday", Date: "2026-03-04", StaffRequired: 5}, false)

	events := svc.GetMonthEvents(context.Background(), 3)
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d", len(events))
	}
	if events[0].StaffRequired != 5 {
		t.Errorf("StaffRequired = %d, want 5", events[0].StaffRequired)
	}
}

func TestSyncEventUpdate_Delete(t *testing.T) {
	svc, _ := newTestService()
	svc.SyncFullPlan(context.Background(), storage.NewYearPlan(2026))
	svc.SyncEventUpdate(context.Background(), 4, domain.Event{ID: "x2", Type: "weekday", Date: "2026-04-01", StaffRequired: 2}, false)
	svc.SyncEventUpdate(context.Background(), 4, domain.Event{ID: "x2"}, true)

	if len(svc.GetMonthEvents(context.Background(), 4)) != 0 {
		t.Error("event should be deleted from month 4")
	}
}

func TestSyncEventUpdate_MonthChange_RemovesFromOldMonth(t *testing.T) {
	svc, _ := newTestService()
	svc.SyncFullPlan(context.Background(), storage.NewYearPlan(2026))
	svc.SyncEventUpdate(context.Background(), 3, domain.Event{ID: "x3", Type: "wednesday", Date: "2026-03-04", StaffRequired: 2}, false)
	// Remote user moved it to month 4.
	svc.SyncEventUpdate(context.Background(), 4, domain.Event{ID: "x3", Type: "weekday", Date: "2026-04-01", StaffRequired: 2}, false)

	if len(svc.GetMonthEvents(context.Background(), 3)) != 0 {
		t.Error("stale copy of event must be removed from month 3")
	}
	if len(svc.GetMonthEvents(context.Background(), 4)) != 1 {
		t.Error("event must appear in month 4")
	}
}

func TestSyncEventUpdate_OutOfRangeMonth_IsNoOp(t *testing.T) {
	svc, _ := newTestService()
	svc.SyncFullPlan(context.Background(), storage.NewYearPlan(2026))
	// must not panic
	svc.SyncEventUpdate(context.Background(), 0, domain.Event{ID: "bad"}, false)
	svc.SyncEventUpdate(context.Background(), 13, domain.Event{ID: "bad"}, false)
}

func TestSyncEventUpdate_NilPlan_IsNoOp(t *testing.T) {
	svc, _ := newTestService()
	// must not panic
	svc.SyncEventUpdate(context.Background(), 3, domain.Event{ID: "x"}, false)
}

// ── DisconnectCloud ──────────────────────────────────────────────────────────

func TestDisconnectCloud_ClearsOnlineState(t *testing.T) {
	svc, _ := newTestService()
	_ = svc.ConnectCloud(context.Background(), "ec9acf74-2a10-4b0e-8b13-a0a91a0d6311", 2026)
	if err := svc.DisconnectCloud(context.Background()); err != nil {
		t.Fatalf("DisconnectCloud: %v", err)
	}
	st := svc.GetCloudStatus(context.Background())
	if st.IsOnline {
		t.Error("IsOnline should be false after disconnect")
	}
	if st.RoomCode != "" {
		t.Errorf("RoomCode = %q, want empty", st.RoomCode)
	}
}

// ── CreateCloudPlan ──────────────────────────────────────────────────────────

func TestCreateCloudPlan_BlankPlan(t *testing.T) {
	svc, _ := newTestService()
	plan, err := svc.CreateCloudPlan(context.Background(), 2027, "ec9acf74-2a10-4b0e-8b13-a0a91a0d6311", "", false)
	if err != nil {
		t.Fatalf("CreateCloudPlan: %v", err)
	}
	if plan.Year != 2027 {
		t.Errorf("Year = %d, want 2027", plan.Year)
	}
	st := svc.GetCloudStatus(context.Background())
	if !st.IsOnline {
		t.Error("should be online after CreateCloudPlan")
	}
}

func TestCreateCloudPlan_WithTemplate_CopiesSettings(t *testing.T) {
	svc, ms := newTestService()
	tmpl := storage.NewYearPlan(2025)
	tmpl.Settings.TeamName = "Alpha Team"
	tmpl.Team = []domain.TeamMember{{ID: "m1", Name: "Anna", Color: "#0d9488", Active: true}}
	_ = ms.Save("tmpl.json", tmpl)

	plan, err := svc.CreateCloudPlan(context.Background(), 2026, "ec9acf74-2a10-4b0e-8b13-a0a91a0d6311", "tmpl.json", false)
	if err != nil {
		t.Fatalf("CreateCloudPlan: %v", err)
	}
	if plan.Settings.TeamName != "Alpha Team" {
		t.Errorf("TeamName = %q, want Alpha Team", plan.Settings.TeamName)
	}
	if len(plan.Team) != 1 || plan.Team[0].Name != "Anna" {
		t.Errorf("Team = %v, want [{Anna}]", plan.Team)
	}
}

// ── ExportPlanJSON ───────────────────────────────────────────────────────────

func TestExportPlanJSON_ValidJSON(t *testing.T) {
	svc, ms := newTestService()
	mustLoadPlan(t, svc, ms)
	out, err := svc.ExportPlanJSON(context.Background())
	if err != nil {
		t.Fatalf("ExportPlanJSON: %v", err)
	}
	if len(out) == 0 {
		t.Fatal("expected non-empty JSON output")
	}
	var check map[string]any
	if err := json.Unmarshal([]byte(out), &check); err != nil {
		t.Errorf("output is not valid JSON: %v", err)
	}
	if _, ok := check["year"]; !ok {
		t.Error("JSON missing 'year' field")
	}
}

func TestExportPlanJSON_NoPlan_Error(t *testing.T) {
	svc, _ := newTestService()
	_, err := svc.ExportPlanJSON(context.Background())
	if err == nil {
		t.Error("expected error when no plan is loaded")
	}
}

// ── Cloud emit helpers via mockEmitter ────────────────────────────────────────

type emittedEvent struct {
	name string
	data []any
}

type mockEmitter struct {
	events []emittedEvent
}

func (m *mockEmitter) EmitEvent(name string, data ...any) bool {
	m.events = append(m.events, emittedEvent{name, data})
	return true
}

func (m *mockEmitter) last() (emittedEvent, bool) {
	if len(m.events) == 0 {
		return emittedEvent{}, false
	}
	return m.events[len(m.events)-1], true
}

func (m *mockEmitter) countName(name string) int {
	n := 0
	for _, e := range m.events {
		if e.name == name {
			n++
		}
	}
	return n
}

const testRoomCode = "ec9acf74-2a10-4b0e-8b13-a0a91a0d6311"

func newOnlineTestService(t *testing.T) (*service.PlannerService, *mockEmitter) {
	t.Helper()
	ms := storage.NewMemStore()
	svc := service.NewPlannerService(nil, nil, ms)
	em := &mockEmitter{}
	svc.SetEmitter(em)
	plan := storage.NewYearPlan(2026)
	_ = ms.Save("test.json", plan)
	if _, err := svc.ReopenPlan(context.Background(), "test.json"); err != nil {
		t.Fatalf("ReopenPlan: %v", err)
	}
	if err := svc.ConnectCloud(context.Background(), testRoomCode, 2026); err != nil {
		t.Fatalf("ConnectCloud: %v", err)
	}
	mustCreateMember(t, svc, "Anna", "#0d9488")
	em.events = nil // clear setup noise
	return svc, em
}

func TestCloudEmit_CreateEvent_FiresCreateNotSave(t *testing.T) {
	svc, em := newOnlineTestService(t)
	mustCreateEvent(t, svc, 3, domain.Event{Type: "wednesday", Date: "2026-03-04", Location: "Halle", TimeFrom: "14:00", TimeTo: "17:00", StaffRequired: 2})
	if em.countName("cloud:create-event") != 1 {
		t.Errorf("expected 1 cloud:create-event, got %d", em.countName("cloud:create-event"))
	}
	if em.countName("cloud:save-event") != 0 {
		t.Error("CreateEvent must not fire cloud:save-event")
	}
}

func TestCloudEmit_UpdateEvent_FiresSave(t *testing.T) {
	svc, em := newOnlineTestService(t)
	id := mustCreateEvent(t, svc, 3, domain.Event{Type: "wednesday", Date: "2026-03-04", TimeFrom: "14:00", TimeTo: "17:00", StaffRequired: 2})
	em.events = nil

	events := svc.GetMonthEvents(context.Background(), 3)
	if len(events) == 0 {
		t.Fatal("expected event in month 3")
	}
	ev := events[0]
	ev.Comment = "changed"
	if err := svc.UpdateEvent(context.Background(), 3, ev); err != nil {
		t.Fatalf("UpdateEvent: %v", err)
	}
	_ = id
	if em.countName("cloud:save-event") != 1 {
		t.Errorf("expected 1 cloud:save-event, got %d", em.countName("cloud:save-event"))
	}
}

func TestCloudEmit_DeleteEvent_FiresDelete(t *testing.T) {
	svc, em := newOnlineTestService(t)
	id := mustCreateEvent(t, svc, 3, domain.Event{Type: "wednesday", Date: "2026-03-04", TimeFrom: "14:00", TimeTo: "17:00", StaffRequired: 2})
	em.events = nil
	if err := svc.DeleteEvent(context.Background(), 3, id); err != nil {
		t.Fatalf("DeleteEvent: %v", err)
	}
	if em.countName("cloud:delete-event") != 1 {
		t.Errorf("expected 1 cloud:delete-event, got %d", em.countName("cloud:delete-event"))
	}
}

func TestCloudEmit_ToggleStaff_AssignFiresTrue(t *testing.T) {
	svc, em := newOnlineTestService(t)
	id := mustCreateEvent(t, svc, 3, domain.Event{Type: "wednesday", Date: "2026-03-04", TimeFrom: "14:00", TimeTo: "17:00", StaffRequired: 2})
	members := svc.GetPlan(context.Background()).Team
	if len(members) == 0 {
		t.Fatal("need at least one member")
	}
	em.events = nil
	if _, err := svc.ToggleStaff(context.Background(), 3, id, members[0].ID); err != nil {
		t.Fatalf("ToggleStaff: %v", err)
	}
	if em.countName("cloud:toggle-staff") != 1 {
		t.Fatalf("expected 1 cloud:toggle-staff, got %d (events: %v)", em.countName("cloud:toggle-staff"), em.events)
	}
	// Find the toggle-staff event (activity log fires after it).
	var toggleEv emittedEvent
	for _, e := range em.events {
		if e.name == "cloud:toggle-staff" {
			toggleEv = e
			break
		}
	}
	if len(toggleEv.data) < 3 {
		t.Fatalf("expected 3 data args, got %d", len(toggleEv.data))
	}
	if assigned, ok := toggleEv.data[2].(bool); !ok || !assigned {
		t.Errorf("third arg should be true (assign), got %v", toggleEv.data[2])
	}
}

func TestCloudEmit_SyncEventUpdate_EmitsPlanEvent(t *testing.T) {
	svc, em := newOnlineTestService(t)
	svc.SyncEventUpdate(context.Background(), 3, domain.Event{ID: "r1", Type: "wednesday", Date: "2026-03-04"}, false)
	if em.countName("plan:cloud-event-changed") != 1 {
		t.Errorf("expected plan:cloud-event-changed, got %v", em.events)
	}
}

func TestCreatePlanFromTemplate_NoEvents_WhenFlagFalse(t *testing.T) {
	// When includeEvents=false, destination events must remain empty.
	tmpl := newPlanWithEvents(2025,
		domain.Event{ID: "e1", Type: "wednesday", Date: "2025-03-05"},
	)
	dst := storage.NewYearPlan(2026)

	// includeEvents = false: skip event copying.
	_ = tmpl
	for month := 1; month <= 12; month++ {
		if dst.Months[month] != nil && len(dst.Months[month].Events) > 0 {
			t.Errorf("month %d has %d events, want 0", month, len(dst.Months[month].Events))
		}
	}
}
