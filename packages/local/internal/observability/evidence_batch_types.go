package observability

// EvidenceSubjectSummaryRequest bounds a positional Local-only subject batch.
type EvidenceSubjectSummaryRequest struct {
	Subjects []EvidenceInspectSubject `json:"subjects"`
}

// EvidenceSubjectSummaryResponse preserves one result per submitted subject.
type EvidenceSubjectSummaryResponse struct {
	Results []EvidenceSubjectSummaryResult `json:"results"`
}

// EvidenceSubjectSummaryResult reports only authorized subject availability
// and its complete active relationship count.
type EvidenceSubjectSummaryResult struct {
	Subject                EvidenceInspectSubject `json:"subject"`
	Status                 string                 `json:"status"`
	TotalActiveRecordCount *int                   `json:"totalActiveRecordCount,omitempty"`
}

// EvidenceNavigationRequest bounds a positional Local-only graph-ref batch.
type EvidenceNavigationRequest struct {
	Refs []NodeRef `json:"refs"`
}

// EvidenceNavigationResponse preserves one result per submitted graph ref.
type EvidenceNavigationResponse struct {
	Results []EvidenceNavigationResult `json:"results"`
}

// EvidenceNavigationResult resolves retained provenance without consulting the
// current Project Index.
type EvidenceNavigationResult struct {
	Ref    NodeRef                   `json:"ref"`
	Status string                    `json:"status"`
	Target *EvidenceNavigationTarget `json:"target,omitempty"`
	Reason string                    `json:"reason,omitempty"`
}

// EvidenceNavigationTarget is one exact persisted run, span, or artifact.
type EvidenceNavigationTarget struct {
	Kind                   string                   `json:"kind"`
	RunID                  string                   `json:"runId"`
	TraceID                string                   `json:"traceId"`
	SpanID                 string                   `json:"spanId,omitempty"`
	ArtifactID             string                   `json:"artifactId,omitempty"`
	RetainedDefinitionRefs *[]DefinitionRef         `json:"retainedDefinitionRefs,omitempty"`
	Owner                  *EvidenceNavigationOwner `json:"owner,omitempty"`
}

// EvidenceNavigationOwner carries historical definition refs for an artifact's
// exact persisted owner at the read snapshot.
type EvidenceNavigationOwner struct {
	Kind                   string          `json:"kind"`
	RunID                  string          `json:"runId"`
	SpanID                 string          `json:"spanId,omitempty"`
	RetainedDefinitionRefs []DefinitionRef `json:"retainedDefinitionRefs"`
}
