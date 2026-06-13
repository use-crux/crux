package api

// API types for the spec-02 Quality contracts (the rewritten engine's
// Experiment record, Baseline record, executor cassettes, and the manifests
// surface). These are PRESENTATION shapes: experiment/baseline detail
// endpoints serve the stored record bytes verbatim (json.RawMessage), because
// the result schemas evolve additively and a struct round-trip would drop
// newer fields. List rows below are additive derivations, never replacements
// for the records themselves.

// QualityExperimentSummary is one row of the experiments list: the
// presentation projection of a spec-02 ExperimentRecord. The full record is
// served verbatim by the detail endpoint.
type QualityExperimentSummary struct {
	ExperimentID    string `json:"experimentId"`
	EvaluationID    string `json:"evaluationId"`
	QualityID       string `json:"qualityId"`
	ExperimentLabel string `json:"experimentLabel,omitempty"`
	StartedAt       string `json:"startedAt"`
	EndedAt         string `json:"endedAt"`
	FilteredRun     bool   `json:"filteredRun"`
	ReplayMode      string `json:"replayMode"`
	Cassette        string `json:"cassette,omitempty"`
	// BaselineID is the promoted baseline this run compared against, if any.
	BaselineID string   `json:"baselineId,omitempty"`
	Variants   []string `json:"variants"`
	// Cell counts aggregated across all variants.
	Cells        int `json:"cells"`
	CellsPassed  int `json:"cellsPassed"`
	CellsFailed  int `json:"cellsFailed"`
	CellsErrored int `json:"cellsErrored"`
	CellsSkipped int `json:"cellsSkipped"`
	// Gate verdicts (spec-02 §1 gates block).
	GatesPassed        bool `json:"gatesPassed"`
	GatesInformational bool `json:"gatesInformational"`
	GateFailures       int  `json:"gateFailures"`
	HasComparison      bool `json:"hasComparison"`
	ComparisonDemoted  bool `json:"comparisonDemoted,omitempty"`
	// Passed mirrors the record's top-level convenience verdict.
	Passed bool `json:"passed"`
}

// QualityCassetteFileRecord describes one executor-boundary cassette file
// under `.crux/quality/cassettes/`. Entries are deliberately not exposed in
// bulk: they carry recorded model output and can be megabytes.
type QualityCassetteFileRecord struct {
	Name       string   `json:"name"`
	Path       string   `json:"path"`
	RecordedAt string   `json:"recordedAt"`
	SdkVersion string   `json:"sdkVersion"`
	Models     []string `json:"models"`
	EntryCount int      `json:"entryCount"`
	// Stale mirrors the engine's 90-day replay staleness window.
	Stale     bool  `json:"stale"`
	SizeBytes int64 `json:"sizeBytes"`
}

// QualityWorkbenchOverview is the dashboard projection over the spec-02
// quality tree: record counts plus the most recent experiment.
type QualityWorkbenchOverview struct {
	Experiments    int `json:"experiments"`
	Baselines      int `json:"baselines"`
	Cassettes      int `json:"cassettes"`
	StaleCassettes int `json:"staleCassettes"`
	// LegacyExperimentsSkipped counts pre-rewrite record files present in the
	// experiments dir that the spec read model ignored (never silently
	// coerced) — nonzero means stale files worth cleaning up.
	LegacyExperimentsSkipped int                    `json:"legacyExperimentsSkipped"`
	LastExperiment           *QualityLastExperiment `json:"lastExperiment,omitempty"`
}

type QualityLastExperiment struct {
	ExperimentID string `json:"experimentId"`
	EvaluationID string `json:"evaluationId"`
	EndedAt      string `json:"endedAt"`
	Passed       bool   `json:"passed"`
}

// QualityScorerStats aggregates one scorer's usage across all spec-02
// experiment records: which evaluations use it, how many cells it scored,
// and the mean score over non-null values.
type QualityScorerStats struct {
	Name          string   `json:"name"`
	CostClass     string   `json:"costClass,omitempty"`
	EvaluationIDs []string `json:"evaluationIds"`
	CellCount     int      `json:"cellCount"`
	MeanScore     *float64 `json:"meanScore,omitempty"`
	LastUsedAt    string   `json:"lastUsedAt,omitempty"`
}
