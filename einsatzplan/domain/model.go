package domain

import "time"

// YearPlan is the root data structure — one file per calendar year.
type YearPlan struct {
	Version     int              `json:"version"`
	Year        int              `json:"year"`
	Settings    Settings         `json:"settings"`
	Team        []TeamMember     `json:"team"`
	Months      map[int]*Month   `json:"months"` // keys 1–12
	ActivityLog []ActivityEntry  `json:"activityLog"`
}

type Month struct {
	Events []Event `json:"events"`
}

type Event struct {
	ID            string   `json:"id"`
	Type          string   `json:"type"`                    // "wednesday" | "weekday" | "weekend"
	Date          string   `json:"date"`                    // YYYY-MM-DD
	DateEnd       string   `json:"dateEnd,omitempty"`       // YYYY-MM-DD, only for multi-day
	IsClosed      bool     `json:"isClosed"`
	Location      string   `json:"location"`
	TimeFrom      string   `json:"timeFrom"`                // HH:MM
	TimeTo        string   `json:"timeTo"`                  // HH:MM
	StaffRequired int      `json:"staffRequired"`
	AssignedStaff []string `json:"assignedStaff"` // team member IDs
	Comment       string   `json:"comment,omitempty"`
}

type TeamMember struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Color  string `json:"color"` // hex, e.g. "#0d9488"
	Active bool   `json:"active"`
	Notes  string `json:"notes,omitempty"`
}

type Settings struct {
	TeamName     string       `json:"teamName"`
	Locations    []string     `json:"locations"`
	DefaultTimes []TimePreset `json:"defaultTimes"`
}

type TimePreset struct {
	Label string `json:"label"`
	From  string `json:"from"` // HH:MM
	To    string `json:"to"`   // HH:MM
}

type ActivityEntry struct {
	ID     string         `json:"id"`
	At     string         `json:"at"`     // RFC3339 timestamp
	Action string         `json:"action"` // see constants below
	Target ActivityTarget `json:"target"`
	// action-specific fields (omitempty keeps JSON lean)
	Person string `json:"person,omitempty"` // for assign/unassign
	Field  string `json:"field,omitempty"`  // for edit
	From   string `json:"from,omitempty"`   // for edit (old value)
	To     string `json:"to,omitempty"`     // for edit (new value)
	Reason string `json:"reason,omitempty"` // for close
	Note   string `json:"note,omitempty"`   // for note action
	Count  int    `json:"count,omitempty"`  // for close-batch
}

type ActivityTarget struct {
	Month    int    `json:"month"`
	EventID  string `json:"eventId"`
	Date     string `json:"date"`
	Location string `json:"location"`
	Type     string `json:"type"`
}

// EventType constants for the Event.Type field.
const (
	EventTypeWednesday = "wednesday"
	EventTypeWeekday   = "weekday"
	EventTypeWeekend   = "weekend"
)

// Action constants.
const (
	ActionAssign   = "assign"
	ActionUnassign = "unassign"
	ActionCreate   = "create"
	ActionEdit     = "edit"
	ActionDelete   = "delete"
	ActionClose    = "close"
	ActionReopen   = "reopen"
	ActionNote     = "note"
)

// EventDays returns the number of calendar days spanned by the event (≥ 1).
func (e Event) EventDays() int {
	if e.DateEnd != "" && e.DateEnd > e.Date {
		start, err1 := time.Parse("2006-01-02", e.Date)
		end, err2 := time.Parse("2006-01-02", e.DateEnd)
		if err1 == nil && err2 == nil {
			days := int(end.Sub(start).Hours()/24) + 1
			if days > 1 {
				return days
			}
		}
	}
	return 1
}

// IsWeekday reports whether the event is a weekday type.
func (e Event) IsWeekday() bool {
	return e.Type == EventTypeWednesday || e.Type == EventTypeWeekday
}
