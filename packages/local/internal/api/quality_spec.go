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
	// Status is a presentation verdict for completed rows, or "running" for
	// transient rows sourced from the live quality run-event stream.
	Status      string `json:"status,omitempty"`
	FilteredRun bool   `json:"filteredRun"`
	ReplayMode  string `json:"replayMode"`
	Cassette    string `json:"cassette,omitempty"`
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

// QualityExperimentsOptions are the composable server-side filters for
// GET /api/quality/experiments.
type QualityExperimentsOptions struct {
	Status     string
	Evaluation string
	Window     string
	Limit      int
	Offset     int
}

// QualityExperimentStatusCounts are computed over the current evaluation +
// window scope while intentionally ignoring the status filter.
type QualityExperimentStatusCounts struct {
	All           int `json:"all"`
	Passed        int `json:"passed"`
	Failed        int `json:"failed"`
	Informational int `json:"informational"`
	Running       int `json:"running"`
}

// QualityExperimentsPage is the paged envelope served by
// GET /api/quality/experiments. Experiments is the current page; Total counts
// all rows matching the active filters before pagination.
type QualityExperimentsPage struct {
	Tag          string                        `json:"_tag"`
	Experiments  []QualityExperimentSummary    `json:"experiments"`
	Total        int                           `json:"total"`
	NextCursor   string                        `json:"nextCursor,omitempty"`
	StatusCounts QualityExperimentStatusCounts `json:"statusCounts"`
	Evaluations  []string                      `json:"evaluations"`
}

// QualityEvaluationExperiments is the backend-owned relation read model that
// lists recent experiment summaries for one evaluation. Total counts all
// retained experiments for the evaluation before the display limit is applied.
type QualityEvaluationExperiments struct {
	Tag           string                     `json:"_tag"`
	SchemaVersion int                        `json:"schemaVersion"`
	EvaluationID  string                     `json:"evaluationId"`
	GeneratedAt   string                     `json:"generatedAt"`
	Limit         int                        `json:"limit"`
	Total         int                        `json:"total"`
	Experiments   []QualityExperimentSummary `json:"experiments"`
}

// QualityEvaluationExperimentGroup is one evaluation bucket in the grouped
// relation read model. Total counts all retained experiments for the
// evaluation before the per-group display limit is applied.
type QualityEvaluationExperimentGroup struct {
	EvaluationID string                     `json:"evaluationId"`
	Total        int                        `json:"total"`
	Experiments  []QualityExperimentSummary `json:"experiments"`
}

// QualityEvaluationExperimentGroups is the backend-owned relation read model
// for experiment list screens that group runs by evaluation.
type QualityEvaluationExperimentGroups struct {
	Tag              string                             `json:"_tag"`
	SchemaVersion    int                                `json:"schemaVersion"`
	GeneratedAt      string                             `json:"generatedAt"`
	Limit            int                                `json:"limit"`
	TotalEvaluations int                                `json:"totalEvaluations"`
	TotalExperiments int                                `json:"totalExperiments"`
	Groups           []QualityEvaluationExperimentGroup `json:"groups"`
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

// QualityExperimentDetail is the typed mirror of one spec-02 ExperimentRecord
// for native (TUI) rendering. The HTTP detail endpoint serves the stored
// bytes verbatim instead — this mirror exists only for in-process display
// and is NOT a serialization vehicle for the record.
type QualityExperimentDetail struct {
	SchemaVersion     int                            `json:"schemaVersion"`
	ExperimentID      string                         `json:"experimentId"`
	EvaluationID      string                         `json:"evaluationId"`
	QualityID         string                         `json:"qualityId"`
	ExperimentLabel   string                         `json:"experimentLabel,omitempty"`
	StartedAt         string                         `json:"startedAt"`
	EndedAt           string                         `json:"endedAt"`
	ConfigFingerprint string                         `json:"configFingerprint"`
	TaskFingerprint   string                         `json:"taskFingerprint"`
	FilteredRun       bool                           `json:"filteredRun"`
	Replay            QualityExperimentReplay        `json:"replay"`
	BaselineRef       *QualityExperimentBaselineRef  `json:"baselineRef,omitempty"`
	Variants          []QualityExperimentVariantDecl `json:"variants"`
	Cases             []QualityExperimentCell        `json:"cases"`
	Aggregates        QualityExperimentAggregates    `json:"aggregates"`
	Comparison        *QualityExperimentComparison   `json:"comparison,omitempty"`
	Gates             QualityExperimentGates         `json:"gates"`
	Passed            bool                           `json:"passed"`
}

type QualityExperimentReplay struct {
	Mode            string `json:"mode"`
	Cassette        string `json:"cassette,omitempty"`
	TrialsCollapsed bool   `json:"trialsCollapsed,omitempty"`
	StaleSince      string `json:"staleSince,omitempty"`
}

type QualityExperimentBaselineRef struct {
	BaselineID   string `json:"baselineId"`
	ExperimentID string `json:"experimentId"`
	VariantName  string `json:"variantName,omitempty"`
}

type QualityExperimentVariantDecl struct {
	Name         string         `json:"name"`
	OverrideKeys []string       `json:"overrideKeys"`
	Overrides    map[string]any `json:"overrides,omitempty"`
}

type QualityExperimentAggregates struct {
	PerVariant map[string]QualityVariantAggregate `json:"perVariant"`
}

type QualityVariantAggregate struct {
	Cells       int                          `json:"cells"`
	Passed      int                          `json:"passed"`
	Failed      int                          `json:"failed"`
	Errored     int                          `json:"errored"`
	Skipped     int                          `json:"skipped"`
	PassRate    float64                      `json:"passRate"`
	Scores      map[string]QualityScoreStats `json:"scores"`
	Consistency *QualityConsistencyStats     `json:"consistency,omitempty"`
	Latency     QualityLatencyStats          `json:"latency"`
	CostUsd     *float64                     `json:"costUsd,omitempty"`
}

type QualityScoreStats struct {
	Mean float64 `json:"mean"`
	SEM  float64 `json:"sem"`
	N    int     `json:"n"`
}

type QualityConsistencyStats struct {
	PassAtK       float64 `json:"passAtK"`
	PassAllTrials float64 `json:"passAllTrials"`
}

type QualityLatencyStats struct {
	MeanMs float64 `json:"meanMs"`
	P95Ms  float64 `json:"p95Ms"`
}

type QualityExperimentCell struct {
	CaseID          string                `json:"caseId"`
	CaseName        string                `json:"caseName,omitempty"`
	VariantName     string                `json:"variantName"`
	Trial           int                   `json:"trial"`
	Status          string                `json:"status"`
	SkipReason      string                `json:"skipReason,omitempty"`
	Input           any                   `json:"input"`
	Output          any                   `json:"output,omitempty"`
	Expected        any                   `json:"expected,omitempty"`
	Scores          []QualityCellScore    `json:"scores"`
	Assertions      QualityCellAssertions `json:"assertions"`
	Error           *QualityCellError     `json:"error,omitempty"`
	DurationMs      float64               `json:"durationMs"`
	CostUsd         *float64              `json:"costUsd,omitempty"`
	Usage           *QualityCellUsage     `json:"usage,omitempty"`
	TraceIDs        []string              `json:"traceIds"`
	CapturedSignals []string              `json:"capturedSignals"`
	Metadata        map[string]any        `json:"metadata,omitempty"`
}

type QualityCellScore struct {
	Name      string         `json:"name"`
	Score     *float64       `json:"score"`
	Label     string         `json:"label,omitempty"`
	CostClass string         `json:"costClass,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type QualityCellAssertions struct {
	Ran          int                       `json:"ran"`
	NotEvaluated int                       `json:"notEvaluated"`
	Failures     []QualityAssertionFailure `json:"failures"`
	Outcomes     []QualityAssertionOutcome `json:"outcomes,omitempty"`
}

type QualityAssertionFailure struct {
	Level           string `json:"level"`
	Index           int    `json:"index"`
	Matcher         string `json:"matcher"`
	Soft            bool   `json:"soft"`
	Message         string `json:"message"`
	ExpectedPreview string `json:"expectedPreview,omitempty"`
	ActualPreview   string `json:"actualPreview,omitempty"`
	SourceRef       string `json:"sourceRef,omitempty"`
}

type QualityAssertionOutcome struct {
	ID              string                      `json:"id"`
	Level           string                      `json:"level"`
	Phase           string                      `json:"phase"`
	Index           int                         `json:"index"`
	Status          string                      `json:"status"`
	Matcher         string                      `json:"matcher"`
	Soft            bool                        `json:"soft"`
	Message         string                      `json:"message,omitempty"`
	SubjectExpr     string                      `json:"subjectExpr,omitempty"`
	Actual          *QualityAssertionValue      `json:"actual,omitempty"`
	Expected        *QualityAssertionValue      `json:"expected,omitempty"`
	Expression      *QualityEvaluatedExpression `json:"expression,omitempty"`
	SourceRef       string                      `json:"sourceRef,omitempty"`
	AssertionSiteID string                      `json:"assertionSiteId,omitempty"`
	SpanIDs         []string                    `json:"spanIds,omitempty"`
	SourceFrame     *QualitySourceFrame         `json:"sourceFrame,omitempty"`
}

type QualityAssertionValue struct {
	Label    string `json:"label"`
	Value    any    `json:"value"`
	Preview  string `json:"preview"`
	Redacted bool   `json:"redacted"`
}

type QualitySourceFrame struct {
	Kind           string                   `json:"kind"`
	Reason         string                   `json:"reason,omitempty"`
	SourceRef      string                   `json:"sourceRef,omitempty"`
	AuthoredFile   string                   `json:"authoredFile,omitempty"`
	AuthoredLine   int                      `json:"authoredLine,omitempty"`
	AuthoredColumn *int                     `json:"authoredColumn,omitempty"`
	FrameStartLine int                      `json:"frameStartLine,omitempty"`
	FrameEndLine   int                      `json:"frameEndLine,omitempty"`
	Lines          []QualitySourceFrameLine `json:"lines,omitempty"`
	ContentHash    string                   `json:"contentHash,omitempty"`
	CapturedAt     string                   `json:"capturedAt,omitempty"`
	Stale          bool                     `json:"stale,omitempty"`
	Resolver       string                   `json:"resolver,omitempty"`
}

type QualitySourceFrameLine struct {
	Line int    `json:"line"`
	Text string `json:"text"`
	Role string `json:"role"`
}

type QualityCellError struct {
	Message            string              `json:"message"`
	Phase              string              `json:"phase"`
	MissingCassetteKey string              `json:"missingCassetteKey,omitempty"`
	SourceRef          string              `json:"sourceRef,omitempty"`
	SourceFrame        *QualitySourceFrame `json:"sourceFrame,omitempty"`
}

type QualityCellUsage struct {
	InputTokens  int `json:"inputTokens"`
	OutputTokens int `json:"outputTokens"`
}

type QualityExperimentComparison struct {
	Kind           string                     `json:"kind"`
	Baseline       string                     `json:"baseline"`
	Deltas         []QualityComparisonDelta   `json:"deltas"`
	UnmatchedCases QualityUnmatchedCases      `json:"unmatchedCases"`
	Demoted        *QualityComparisonDemotion `json:"demoted,omitempty"`
}

type QualityComparisonDelta struct {
	VariantName string  `json:"variantName"`
	ScoreName   string  `json:"scoreName"`
	MeanDelta   float64 `json:"meanDelta"`
	SEM         float64 `json:"sem"`
	N           int     `json:"n"`
}

type QualityUnmatchedCases struct {
	BaselineOnly  []string `json:"baselineOnly"`
	CandidateOnly []string `json:"candidateOnly"`
}

type QualityComparisonDemotion struct {
	Reason string `json:"reason"`
}

type QualityExperimentGates struct {
	Passed        bool                `json:"passed"`
	Informational bool                `json:"informational"`
	Results       []QualityGateResult `json:"results"`
}

type QualityGateResult struct {
	Gate          string `json:"gate"`
	VariantName   string `json:"variantName,omitempty"`
	Threshold     any    `json:"threshold"`
	Actual        any    `json:"actual"`
	Passed        bool   `json:"passed"`
	Informational bool   `json:"informational,omitempty"`
}

// QualityEvaluationProgress is the backend-owned "go again" progress read
// model over recent experiment records plus the current promoted baseline.
type QualityEvaluationProgress struct {
	Tag           string                         `json:"_tag"`
	SchemaVersion int                            `json:"schemaVersion"`
	EvaluationID  string                         `json:"evaluationId"`
	GeneratedAt   string                         `json:"generatedAt"`
	Limit         int                            `json:"limit"`
	Runs          []QualityEvaluationProgressRun `json:"runs"`
	ScoreSeries   []QualityScoreProgressSeries   `json:"scoreSeries"`
}

type QualityEvaluationProgressRun struct {
	ExperimentID string   `json:"experimentId"`
	StartedAt    string   `json:"startedAt,omitempty"`
	FinishedAt   string   `json:"finishedAt,omitempty"`
	Verdict      string   `json:"verdict"`
	PassRate     float64  `json:"passRate"`
	DurationMs   *float64 `json:"durationMs,omitempty"`
	CostUsd      *float64 `json:"costUsd,omitempty"`
}

type QualityScoreProgressSeries struct {
	ScoreName string                        `json:"scoreName"`
	Baseline  *QualityScoreProgressBaseline `json:"baseline,omitempty"`
	Points    []QualityScoreProgressPoint   `json:"points"`
}

type QualityScoreProgressBaseline struct {
	Value      float64 `json:"value"`
	BaselineID string  `json:"baselineId"`
}

type QualityScoreProgressPoint struct {
	ExperimentID string  `json:"experimentId"`
	Mean         float64 `json:"mean"`
	SEM          float64 `json:"sem"`
	N            int     `json:"n"`
	PassedGate   *bool   `json:"passedGate,omitempty"`
}

// QualityPromotedBaseline is the typed mirror of a spec-02 BaselineRecord
// (committed `baselines/<evaluationId>.json`) for native rendering.
type QualityPromotedBaseline struct {
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

// QualityPromoteResult is the outcome of a server-side promotion (the
// embedded worker's --promote mode).
type QualityPromoteResult struct {
	BaselineID   string `json:"baselineId"`
	EvaluationID string `json:"evaluationId"`
	ExperimentID string `json:"experimentId"`
	VariantName  string `json:"variantName,omitempty"`
	Path         string `json:"path"`
	PinHint      string `json:"pinHint,omitempty"`
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
