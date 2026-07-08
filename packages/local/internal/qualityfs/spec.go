package qualityfs

// Go mirrors of the spec-02 result schemas: the Experiment record (§1) and
// the Baseline record (§3) written by the Quality engine, plus the cassette
// file the executor-boundary replay layer persists.
//
// These structs exist for presentation and derivation (list rows, overview
// counts, scorer stats) ONLY. Both schemas evolve additively — a re-marshalled
// struct would silently drop fields the engine added after this code was
// written — so endpoints that serve a record verbatim must serve the stored
// bytes (see ExperimentRecordFile.Raw), never a round-trip through these types.

// ExperimentRecord is the spec-02 §1 record at `experiments/<experimentId>.json`.
type ExperimentRecord struct {
	SchemaVersion     int                  `json:"schemaVersion"`
	ExperimentID      string               `json:"experimentId"`
	EvaluationID      string               `json:"evaluationId"`
	QualityID         string               `json:"qualityId"`
	ExperimentLabel   string               `json:"experimentLabel,omitempty"`
	StartedAt         string               `json:"startedAt"`
	EndedAt           string               `json:"endedAt"`
	ConfigFingerprint string               `json:"configFingerprint"`
	TaskFingerprint   string               `json:"taskFingerprint"`
	FilteredRun       bool                 `json:"filteredRun"`
	Replay            ExperimentReplay     `json:"replay"`
	BaselineRef       *ExperimentBaseline  `json:"baselineRef,omitempty"`
	Variants          []ExperimentVariants `json:"variants"`
	Cells             []SpecExperimentCell `json:"cells"`
	Aggregates        ExperimentAggregates `json:"aggregates"`
	Comparison        *SpecComparison      `json:"comparison,omitempty"`
	Gates             SpecGates            `json:"gates"`
	Passed            bool                 `json:"passed"`
}

type ExperimentReplay struct {
	Mode            string `json:"mode"`
	Cassette        string `json:"cassette,omitempty"`
	TrialsCollapsed bool   `json:"trialsCollapsed,omitempty"`
	StaleSince      string `json:"staleSince,omitempty"`
}

type ExperimentBaseline struct {
	BaselineID   string `json:"baselineId"`
	ExperimentID string `json:"experimentId"`
	VariantName  string `json:"variantName,omitempty"`
}

type ExperimentVariants struct {
	Name         string         `json:"name"`
	OverrideKeys []string       `json:"overrideKeys"`
	Overrides    map[string]any `json:"overrides,omitempty"`
}

type ExperimentAggregates struct {
	PerVariant map[string]SpecVariantAggregate `json:"perVariant"`
}

type SpecVariantAggregate struct {
	Cells       int                       `json:"cells"`
	Passed      int                       `json:"passed"`
	Failed      int                       `json:"failed"`
	Errored     int                       `json:"errored"`
	Skipped     int                       `json:"skipped"`
	PassRate    float64                   `json:"passRate"`
	Scores      map[string]SpecScoreStats `json:"scores"`
	Consistency *SpecConsistency          `json:"consistency,omitempty"`
	Latency     SpecLatency               `json:"latency"`
	CostUsd     *float64                  `json:"costUsd,omitempty"`
}

type SpecScoreStats struct {
	Mean float64 `json:"mean"`
	SEM  float64 `json:"sem"`
	N    int     `json:"n"`
}

type SpecConsistency struct {
	PassAtK       float64 `json:"passAtK"`
	PassAllTrials float64 `json:"passAllTrials"`
}

type SpecLatency struct {
	MeanMs float64 `json:"meanMs"`
	P95Ms  float64 `json:"p95Ms"`
}

type SpecExperimentCell struct {
	CaseID          string          `json:"caseId"`
	CaseName        string          `json:"caseName,omitempty"`
	VariantName     string          `json:"variantName"`
	Trial           int             `json:"trial"`
	Status          string          `json:"status"`
	SkipReason      string          `json:"skipReason,omitempty"`
	Input           any             `json:"input"`
	Output          any             `json:"output,omitempty"`
	Expected        any             `json:"expected,omitempty"`
	Scores          []SpecCellScore `json:"scores"`
	Assertions      SpecAssertions  `json:"assertions"`
	Error           *SpecCellError  `json:"error,omitempty"`
	DurationMs      float64         `json:"durationMs"`
	CostUsd         *float64        `json:"costUsd,omitempty"`
	Usage           *SpecUsage      `json:"usage,omitempty"`
	TraceIDs        []string        `json:"traceIds"`
	CapturedSignals []string        `json:"capturedSignals"`
	Metadata        map[string]any  `json:"metadata,omitempty"`
}

type SpecCellScore struct {
	Name      string         `json:"name"`
	Score     *float64       `json:"score"`
	Label     string         `json:"label,omitempty"`
	CostClass string         `json:"costClass,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type SpecAssertions struct {
	Ran          int                    `json:"ran"`
	NotEvaluated int                    `json:"notEvaluated"`
	Outcomes     []SpecAssertionOutcome `json:"outcomes"`
}

type SpecAssertionOutcome struct {
	ID        string `json:"id"`
	Level     string `json:"level"`
	Phase     string `json:"phase"`
	Index     int    `json:"index"`
	Status    string `json:"status"`
	Matcher   string `json:"matcher"`
	Soft      bool   `json:"soft"`
	Message   string `json:"message,omitempty"`
	SourceRef string `json:"sourceRef,omitempty"`
}

type SpecCellError struct {
	Message            string `json:"message"`
	Phase              string `json:"phase"`
	MissingCassetteKey string `json:"missingCassetteKey,omitempty"`
}

type SpecUsage struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}

type SpecComparison struct {
	Kind           string               `json:"kind"`
	Baseline       string               `json:"baseline"`
	Deltas         []SpecComparisonRow  `json:"deltas"`
	UnmatchedCases SpecUnmatchedCases   `json:"unmatchedCases"`
	Demoted        *SpecComparisonNotes `json:"demoted,omitempty"`
}

type SpecComparisonRow struct {
	VariantName string  `json:"variantName"`
	ScoreName   string  `json:"scoreName"`
	MeanDelta   float64 `json:"meanDelta"`
	SEM         float64 `json:"sem"`
	N           int     `json:"n"`
}

type SpecUnmatchedCases struct {
	BaselineOnly  []string `json:"baselineOnly"`
	CandidateOnly []string `json:"candidateOnly"`
}

type SpecComparisonNotes struct {
	Reason string `json:"reason"`
}

type SpecGates struct {
	Passed        bool             `json:"passed"`
	Informational bool             `json:"informational"`
	Results       []SpecGateResult `json:"results"`
}

type SpecGateResult struct {
	Gate          string `json:"gate"`
	VariantName   string `json:"variantName,omitempty"`
	Threshold     any    `json:"threshold"`
	Actual        any    `json:"actual"`
	Passed        bool   `json:"passed"`
	Informational bool   `json:"informational,omitempty"`
}

// SpecBaselineRecord is the spec-02 §3 committed record at
// `baselines/<evaluationId>.json`.
type SpecBaselineRecord struct {
	SchemaVersion     int                           `json:"schemaVersion"`
	BaselineID        string                        `json:"baselineId"`
	EvaluationID      string                        `json:"evaluationId"`
	ExperimentID      string                        `json:"experimentId"`
	VariantName       string                        `json:"variantName,omitempty"`
	PromotedAt        string                        `json:"promotedAt"`
	PromotedBy        string                        `json:"promotedBy,omitempty"`
	ConfigFingerprint string                        `json:"configFingerprint"`
	Reference         map[string]map[string]float64 `json:"reference"`
}

// CassetteFileRecord is the executor-boundary cassette at
// `cassettes/<name>.json` (core quality/internal/cassette.ts CassetteFile).
// Entries are intentionally NOT modelled: they carry recorded model output
// and can be megabytes — read models surface counts and metadata only.
type CassetteFileRecord struct {
	Version  int                  `json:"version"`
	Metadata CassetteFileMetadata `json:"metadata"`
}

type CassetteFileMetadata struct {
	RecordedAt string   `json:"recordedAt"`
	SdkVersion string   `json:"sdkVersion"`
	Models     []string `json:"models"`
}
