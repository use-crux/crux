package api

// QualityFailureArtifact mirrors one core-owned failure artifact embedded in
// an experiment record under `failures` (core `quality/failure-artifact.ts`).
// The Quality engine derives one artifact per failing/errored cell, including
// the fix-surface classification (I5: core decides, Go renders). These structs
// exist for native (TUI) and typed detail rendering only — the HTTP experiment
// endpoint still serves the stored record bytes verbatim.
type QualityFailureArtifact struct {
	CaseID               string                         `json:"caseId"`
	CaseName             string                         `json:"caseName,omitempty"`
	Variant              string                         `json:"variant"`
	Trial                int                            `json:"trial"`
	Phase                string                         `json:"phase"`
	Scores               []QualityFailureArtifactScore  `json:"scores"`
	SourceRef            string                         `json:"sourceRef,omitempty"`
	Covers               []string                       `json:"covers"`
	TraceID              string                         `json:"traceId,omitempty"`
	SpanIDs              []string                       `json:"spanIds"`
	CassetteID           string                         `json:"cassetteId,omitempty"`
	Cost                 *QualityFailureArtifactCost    `json:"cost,omitempty"`
	DurationMs           *float64                       `json:"durationMs,omitempty"`
	DatasetProvenance    *QualityFailureArtifactDataset `json:"datasetProvenance,omitempty"`
	SuggestedFixSurfaces []string                       `json:"suggestedFixSurfaces"`
}

// QualityFailureArtifactScore is one score entry in a failure artifact,
// carrying the candidate score plus baseline delta and judge rationale when
// available.
type QualityFailureArtifactScore struct {
	Name          string   `json:"name"`
	Score         *float64 `json:"score"`
	BaselineScore *float64 `json:"baselineScore,omitempty"`
	Delta         *float64 `json:"delta,omitempty"`
	Rationale     string   `json:"rationale,omitempty"`
}

// QualityFailureArtifactCost is the optional per-cell cost on a failure
// artifact.
type QualityFailureArtifactCost struct {
	Usd *float64 `json:"usd,omitempty"`
}

// QualityFailureArtifactDataset is the dataset source fingerprint attached to
// dataset-backed or imported cases.
type QualityFailureArtifactDataset struct {
	Path               string `json:"path"`
	ContentFingerprint string `json:"contentFingerprint"`
}
