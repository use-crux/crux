package promptlatest

import "errors"

type Status string

const (
	StatusFound       Status = "found"
	StatusEmpty       Status = "empty"
	StatusUnavailable Status = "unavailable"
)

type UnavailableReason string

const (
	ReasonOwnerNotFound  UnavailableReason = "owner-not-found"
	ReasonOwnerNotPrompt UnavailableReason = "owner-not-prompt"
)

var ErrTemporarilyUnavailable = errors.New("latest Run is temporarily unavailable")

// Result is the private latest-Run selection. The Local route separately
// validates and projects this result onto its closed browser-safe wire.
type Result struct {
	Status                Status
	DefinitionID          string
	ObservabilityRevision int64
	OperationID           string
	ExactPreviewAvailable bool
	UnavailableReason     UnavailableReason
}
