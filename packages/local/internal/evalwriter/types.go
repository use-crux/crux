// Package evalwriter invokes Core-owned Eval repository mutations.
package evalwriter

import "context"

// SetBaselineRequest identifies one persisted run arm to accept.
type SetBaselineRequest struct {
	RunID         string `json:"runId"`
	Variant       string `json:"variant,omitempty"`
	AcceptFailing bool   `json:"acceptFailing,omitempty"`
}

// SetBaselineResult describes the repository artifact written by Core.
type SetBaselineResult struct {
	RunID string `json:"runId"`
	Path  string `json:"path"`
}

// BaselineWriter persists an accepted Baseline through the project-local Core.
type BaselineWriter interface {
	SetBaseline(context.Context, SetBaselineRequest) (SetBaselineResult, error)
}
