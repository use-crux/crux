package observability

import "encoding/json"

// EvidenceInspectSubject mirrors Core's provider-neutral public subject shape.
type EvidenceInspectSubject struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	EffectID string `json:"effectId,omitempty"`
}

// EvidenceInspectRequest is the bounded query accepted by every Local adapter.
type EvidenceInspectRequest struct {
	Subject        EvidenceInspectSubject `json:"subject"`
	Role           string                 `json:"role,omitempty"`
	Limit          int                    `json:"limit"`
	Cursor         string                 `json:"cursor,omitempty"`
	IncludeHistory bool                   `json:"includeHistory"`
	IncludeData    bool                   `json:"includeData"`
}

// EvidenceInspectResult is Local's canonical five-role destination read model.
type EvidenceInspectResult struct {
	Subject EvidenceInspectSubject `json:"subject"`
	Roles   EvidenceInspectRoles   `json:"roles"`
}

// EvidenceInspectRoles keeps all five semantic roles present in every result.
type EvidenceInspectRoles struct {
	Intent       EvidenceInspectRole `json:"intent"`
	Authority    EvidenceInspectRole `json:"authority"`
	Change       EvidenceInspectRole `json:"change"`
	Verification EvidenceInspectRole `json:"verification"`
	Recovery     EvidenceInspectRole `json:"recovery"`
}

// EvidenceInspectRole contains complete aggregates and optionally hydrated rows.
type EvidenceInspectRole struct {
	Role              string                  `json:"role"`
	Status            string                  `json:"status"`
	ActiveRecordCount int                     `json:"activeRecordCount"`
	Records           []EvidenceInspectRecord `json:"records"`
	History           []EvidenceInspectRecord `json:"history,omitempty"`
	Coverage          string                  `json:"coverage,omitempty"`
	Conclusion        string                  `json:"conclusion,omitempty"`
	Conflicting       bool                    `json:"conflicting"`
	Truncated         bool                    `json:"truncated"`
	Cursor            string                  `json:"cursor,omitempty"`
}

// EvidenceInspectRecord is one immutable retained relationship.
type EvidenceInspectRecord struct {
	Ref                      EvidenceInspectRef             `json:"ref"`
	Source                   EvidenceInspectSubject         `json:"source"`
	Conclusion               string                         `json:"conclusion,omitempty"`
	ObservedAt               string                         `json:"observedAt,omitempty"`
	Supersedes               []EvidenceInspectRef           `json:"supersedes"`
	Producer                 *EvidenceInspectSubject        `json:"producer,omitempty"`
	AcceptedAfterTerminal    *EvidenceAcceptedAfterTerminal `json:"acceptedAfterTerminal,omitempty"`
	PayloadState             string                         `json:"payloadState"`
	PayloadUnavailableReason string                         `json:"payloadUnavailableReason,omitempty"`
	Data                     json.RawMessage                `json:"data,omitempty"`
}

// EvidenceInspectRef is the public identity embedded in records and history.
type EvidenceInspectRef struct {
	Kind         string                 `json:"kind"`
	ID           string                 `json:"id"`
	Subject      EvidenceInspectSubject `json:"subject"`
	Role         string                 `json:"role"`
	EvidenceKind string                 `json:"evidenceKind"`
	RecordedAt   string                 `json:"recordedAt"`
}

// EvidenceAcceptedAfterTerminal is immutable destination-derived provenance.
type EvidenceAcceptedAfterTerminal struct {
	JudgedAgainst EvidenceTerminalExecution `json:"judgedAgainst"`
}

// EvidenceTerminalExecution preserves the canonical run/span distinction.
type EvidenceTerminalExecution struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}
