package service

// planner_cloud.go — cloud sync endpoints for JS integration.

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"

	"github.com/google/uuid"

	"einsatzplaner/einsatzplan/domain"
	"einsatzplaner/einsatzplan/storage"
)

// CloudStatus is returned by GetCloudStatus.
type CloudStatus struct {
	CloudEnabled bool   `json:"cloudEnabled"` // true when project+key were injected at build
	IsOnline     bool   `json:"isOnline"`     // true when currently connected to Firestore
	RoomCode     string `json:"roomCode"`     // empty when not connected
	ProjectID    string `json:"projectId"`
	APIKey       string `json:"apiKey"`
}

var uuidRe = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// SetCloudCredentials is called from main() with the ldflags-injected values.
// It is NOT a Wails binding.
func (s *PlannerService) SetCloudCredentials(projectID, apiKey string) {
	s.firestoreProjectID = projectID
	s.firestoreAPIKey = apiKey
}

// GenerateRoomCode returns a new random UUID v4 suitable for use as a room code.
func (s *PlannerService) GenerateRoomCode(_ context.Context) string {
	return uuid.New().String()
}

// GetCloudStatus returns current cloud connectivity state.
func (s *PlannerService) GetCloudStatus(_ context.Context) CloudStatus {
	s.mu.RLock()
	st := CloudStatus{
		CloudEnabled: s.firestoreProjectID != "" && s.firestoreAPIKey != "",
		IsOnline:     s.isOnline,
		RoomCode:     s.cloudRoomCode,
		ProjectID:    s.firestoreProjectID,
		APIKey:       s.firestoreAPIKey,
	}
	s.mu.RUnlock()

	// If not online, see if we have a saved config to reconnect
	if !st.IsOnline {
		if cfg, err := storage.LoadCloudConfig(); err == nil && cfg.RoomCode != "" {
			st.RoomCode = cfg.RoomCode
		}
	}

	return st
}

// ConnectCloud is called by JS to indicate we are successfully connected to a room.
func (s *PlannerService) ConnectCloud(ctx context.Context, roomCode string, year int) error {
	if !uuidRe.MatchString(roomCode) {
		return fmt.Errorf("invalid room code")
	}

	s.mu.Lock()
	s.cloudRoomCode = roomCode
	s.isOnline = true
	// Stop the file poller (no local file while online).
	if s.pollCancel != nil {
		s.pollCancel()
		s.pollCancel = nil
	}
	s.path = "" // no local path when online
	s.mu.Unlock()

	if year > 0 {
		_ = storage.SaveCloudConfig(&storage.CloudConfig{RoomCode: roomCode, LastYear: year})
	}
	return nil
}

// DisconnectCloud clears cloud state.
func (s *PlannerService) DisconnectCloud(_ context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.isOnline = false
	s.cloudRoomCode = ""
	storage.ClearCloudConfig()
	return nil
}

// SyncFullPlan replaces the in-memory plan with the plan down-synced from Firebase via JS.
func (s *PlannerService) SyncFullPlan(_ context.Context, plan *domain.YearPlan) *domain.YearPlan {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.plan = plan
	s.dirty = false
	return storage.CopyPlan(plan)
}

// SyncMetaUpdate updates team and settings from JS Firebase listener.
func (s *PlannerService) SyncMetaUpdate(_ context.Context, settings domain.Settings, team []domain.TeamMember) {
	s.mu.Lock()
	if s.plan != nil {
		s.plan.Settings = settings
		s.plan.Team = team
	}
	s.mu.Unlock()

	if s.win != nil {
		s.win.EmitEvent("plan:cloud-meta-changed")
	}
}

// SyncEventUpdate updates a single event from JS Firebase listener.
func (s *PlannerService) SyncEventUpdate(_ context.Context, month int, ev domain.Event, isDelete bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.plan == nil || month < 1 || month > 12 {
		return
	}
	mo := s.plan.Months[month]
	if mo == nil {
		return
	}

	if isDelete {
		mo.Events = slices.DeleteFunc(mo.Events, func(e domain.Event) bool { return e.ID == ev.ID })
	} else {
		// Remove the event from any other month first — guards against a remote
		// month-field change that would otherwise leave a stale copy behind.
		for m, other := range s.plan.Months {
			if m == month || other == nil {
				continue
			}
			other.Events = slices.DeleteFunc(other.Events, func(e domain.Event) bool { return e.ID == ev.ID })
		}
		found := false
		for i, e := range mo.Events {
			if e.ID == ev.ID {
				mo.Events[i] = ev
				found = true
				break
			}
		}
		if !found {
			mo.Events = append(mo.Events, ev)
		}
	}

	if s.win != nil {
		type evPayload struct {
			Month int    `json:"month"`
			ID    string `json:"id"`
			Kind  string `json:"kind"`
		}
		kind := "event_upsert"
		if isDelete {
			kind = "event_delete"
		}
		b, _ := json.Marshal(evPayload{Month: month, ID: ev.ID, Kind: kind})
		s.win.EmitEvent("plan:cloud-event-changed", string(b))
	}
}

// ExportPlanJSON returns the current in-memory plan as a JSON string.
func (s *PlannerService) ExportPlanJSON(_ context.Context) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.plan == nil {
		return "", fmt.Errorf("no plan loaded")
	}
	b, err := json.MarshalIndent(s.plan, "", "  ")
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// CreateCloudPlan is kept for backward compat if needed, but typically JS handles this via batch writes.
// Since Go doesn't have Firestore anymore, Go will just return a new empty YearPlan.
// The actual saving to Firebase will happen in the JS side by calling initial save functions.
func (s *PlannerService) CreateCloudPlan(ctx context.Context, year int, roomCode string, templatePath string, includeEvents bool) (*domain.YearPlan, error) {
	plan := storage.NewYearPlan(year)

	if templatePath != "" {
		if tmpl, err := s.store.Load(templatePath); err == nil {
			plan.Settings = tmpl.Settings
			plan.Team = make([]domain.TeamMember, len(tmpl.Team))
			copy(plan.Team, tmpl.Team)
			if includeEvents {
				// Reuse the same helper as CreatePlanFromTemplate: adjusts event
				// dates to the target year, assigns fresh IDs, clears assignments.
				copyEventsFromTemplate(tmpl, plan, year)
			}
		}
	}

	// Set the plan locally and stop any file-change poller that may be running.
	s.mu.Lock()
	s.plan = plan
	s.isOnline = true
	s.cloudRoomCode = roomCode
	s.path = ""
	if s.pollCancel != nil {
		s.pollCancel()
		s.pollCancel = nil
	}
	s.mu.Unlock()

	_ = storage.SaveCloudConfig(&storage.CloudConfig{RoomCode: roomCode, LastYear: year})

	return plan, nil
}

// The following wrappers emit events to JS to perform granular updates
func (s *PlannerService) cloudSaveEvent(month int, ev domain.Event) {
	if s.isOnline && s.win != nil {
		s.win.EmitEvent("cloud:save-event", month, ev)
	}
}
func (s *PlannerService) cloudDeleteEvent(eventID string) {
	if s.isOnline && s.win != nil {
		s.win.EmitEvent("cloud:delete-event", eventID)
	}
}
// cloudSaveMember emits a single member upsert — JS writes only that member's
// map entry in Firestore, leaving all other members untouched.
func (s *PlannerService) cloudSaveMember(m domain.TeamMember) {
	if s.isOnline && s.win != nil {
		s.win.EmitEvent("cloud:save-member", m)
	}
}

// cloudDeleteMember emits a single member deletion by ID.
func (s *PlannerService) cloudDeleteMember(memberID string) {
	if s.isOnline && s.win != nil {
		s.win.EmitEvent("cloud:delete-member", memberID)
	}
}

// NotifyCloudDisconnected tells the frontend the cloud connection was lost
// (e.g. called if a future reconnect-loop gives up). The JS handler updates
// the UI and shows a warning toast.
func (s *PlannerService) NotifyCloudDisconnected() {
	if s.win != nil {
		s.win.EmitEvent("plan:cloud-disconnected")
	}
}

// cloudSaveSettings emits only the settings portion of meta.
func (s *PlannerService) cloudSaveSettings() {
	if s.isOnline && s.win != nil && s.plan != nil {
		s.win.EmitEvent("cloud:save-settings", s.plan.Settings)
	}
}
func (s *PlannerService) cloudAppendActivity(entry domain.ActivityEntry) {
	if s.isOnline && s.win != nil {
		s.win.EmitEvent("cloud:append-activity", entry)
	}
}
func (s *PlannerService) cloudToggleStaff(ev domain.Event, memberID string, action string) {
	if s.isOnline && s.win != nil {
		s.win.EmitEvent("cloud:toggle-staff", ev.ID, memberID, action == domain.ActionAssign)
	}
}
