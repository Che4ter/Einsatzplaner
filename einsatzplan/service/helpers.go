package service

import (
	"crypto/rand"
	"fmt"
	"slices"
	"time"

	"einsatzplaner/einsatzplan/domain"
)

// generateID returns a short random hex ID (12 chars) suitable for events and members.
func generateID() string {
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		panic("generateID: crypto/rand unavailable: " + err.Error())
	}
	return fmt.Sprintf("%x", b)
}

// timestamp returns the current UTC time as an RFC3339 string.
func timestamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// appendActivity prepends an entry to the plan log (newest first) and trims to maxLog.
func appendActivity(plan *domain.YearPlan, entry domain.ActivityEntry) {
	plan.ActivityLog = slices.Insert(plan.ActivityLog, 0, entry)
	if len(plan.ActivityLog) > maxActivityLog {
		plan.ActivityLog = plan.ActivityLog[:maxActivityLog]
	}
}

const maxActivityLog = 500
