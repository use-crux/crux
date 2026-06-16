package api

// QualityCellEvidenceQuery identifies one experiment cell inside the
// server-owned Quality evidence read model.
type QualityCellEvidenceQuery struct {
	ExperimentID string `json:"experimentId"`
	CaseID       string `json:"caseId"`
	VariantName  string `json:"variantName"`
	Trial        int    `json:"trial"`
}

// QualityCellEvidence is the joined backend record for opening one Quality
// cell into debuggable evidence. It combines the redacted experiment cell,
// assertion outcomes, authored source frames, score details, baseline
// availability, and trace identifiers without asking clients to join raw
// records themselves.
type QualityCellEvidence struct {
	Tag           string                    `json:"_tag"`
	SchemaVersion int                       `json:"schemaVersion"`
	ExperimentID  string                    `json:"experimentId"`
	EvaluationID  string                    `json:"evaluationId,omitempty"`
	GeneratedAt   string                    `json:"generatedAt"`
	Cell          QualityCellIdentity       `json:"cell"`
	TrialSummary  QualityTrialSummary       `json:"trialSummary"`
	IO            QualityCellIOEvidence     `json:"io"`
	Scores        []QualityScoreEvidence    `json:"scores"`
	Assertions    QualityAssertionEvidence  `json:"assertions"`
	Checks        []QualityCheckEvidence    `json:"checks"`
	Code          QualityCodeEvidence       `json:"code"`
	Baseline      QualityBaselineEvidence   `json:"baseline"`
	Trace         QualityTraceEvidence      `json:"trace"`
	Repro         QualityReproEvidence      `json:"repro"`
	Provenance    QualityEvidenceProvenance `json:"provenance"`
}

// QualityCellIdentity is the stable identity and execution state for the
// selected case x variant x trial.
type QualityCellIdentity struct {
	CaseID          string            `json:"caseId"`
	CaseName        string            `json:"caseName,omitempty"`
	VariantName     string            `json:"variantName"`
	Trial           int               `json:"trial"`
	Status          string            `json:"status"`
	DurationMs      float64           `json:"durationMs"`
	CostUsd         *float64          `json:"costUsd,omitempty"`
	Usage           *QualityCellUsage `json:"usage,omitempty"`
	TraceIDs        []string          `json:"traceIds"`
	CapturedSignals []string          `json:"capturedSignals"`
	Error           *QualityCellError `json:"error,omitempty"`
}

// QualityTrialSummary summarizes sibling trials for the selected
// case x variant pair so clients can identify stable and flaky failures.
type QualityTrialSummary struct {
	SelectedTrial int                        `json:"selectedTrial"`
	Total         int                        `json:"total"`
	Passed        int                        `json:"passed"`
	Failed        int                        `json:"failed"`
	Errored       int                        `json:"errored"`
	Skipped       int                        `json:"skipped"`
	Verdict       string                     `json:"verdict"`
	Trials        []QualityTrialSummaryTrial `json:"trials"`
}

// QualityTrialSummaryTrial is one compact row in a trial summary.
type QualityTrialSummaryTrial struct {
	Trial          int     `json:"trial"`
	Status         string  `json:"status"`
	DurationMs     float64 `json:"durationMs"`
	PrimaryFailure string  `json:"primaryFailure,omitempty"`
}

// QualityCellIOEvidence carries the already-redacted values stored on the
// experiment cell. The evidence service never rehydrates unredacted trace
// payloads.
type QualityCellIOEvidence struct {
	Input            any  `json:"input"`
	Output           any  `json:"output,omitempty"`
	Expected         any  `json:"expected,omitempty"`
	OutputTruncated  bool `json:"outputTruncated"`
	RedactionApplied bool `json:"redactionApplied"`
}

// QualityScoreEvidence normalizes one numeric score for evidence views,
// including model-judge rationale when present in score metadata.
type QualityScoreEvidence struct {
	Name              string                 `json:"name"`
	Score             float64                `json:"score"`
	Label             string                 `json:"label,omitempty"`
	CostClass         string                 `json:"costClass,omitempty"`
	Rationale         string                 `json:"rationale,omitempty"`
	Metadata          map[string]any         `json:"metadata,omitempty"`
	Threshold         *QualityScoreThreshold `json:"threshold,omitempty"`
	DeltaFromBaseline *float64               `json:"deltaFromBaseline,omitempty"`
}

// QualityScoreThreshold is the normalized threshold behind a score check,
// whether it came from an authored assertion, a gate, or future baseline logic.
type QualityScoreThreshold struct {
	Source   string  `json:"source"`
	Operator string  `json:"operator"`
	Value    float64 `json:"value"`
	Passed   bool    `json:"passed"`
}

// QualityEvaluatedExpression is the structured comparison captured by a
// matcher. The rendered string is backend-owned so every client shows the
// same compact truth statement.
type QualityEvaluatedExpression struct {
	Left     QualityEvidenceValue  `json:"left"`
	Operator string                `json:"operator"`
	Right    *QualityEvidenceValue `json:"right,omitempty"`
	Result   bool                  `json:"result"`
	Rendered string                `json:"rendered"`
}

// QualityAssertionEvidence is the ordered assertion ledger for the selected
// cell, including synthesized outcomes for old records that only retained
// assertion counters and failures.
type QualityAssertionEvidence struct {
	Ran          int                       `json:"ran"`
	NotEvaluated int                       `json:"notEvaluated"`
	Outcomes     []QualityAssertionOutcome `json:"outcomes"`
}

// QualityCheckEvidence is the normalized "thing to debug" projection over
// assertions, score thresholds, and runtime errors.
type QualityCheckEvidence struct {
	Kind        string                      `json:"kind"`
	OutcomeID   string                      `json:"outcomeId,omitempty"`
	Status      string                      `json:"status,omitempty"`
	Summary     string                      `json:"summary,omitempty"`
	SourceFrame *QualitySourceFrame         `json:"sourceFrame,omitempty"`
	Expression  *QualityEvaluatedExpression `json:"expression,omitempty"`
	ScoreName   string                      `json:"scoreName,omitempty"`
	Score       *float64                    `json:"score,omitempty"`
	Operator    string                      `json:"operator,omitempty"`
	Threshold   *float64                    `json:"threshold,omitempty"`
	Passed      *bool                       `json:"passed,omitempty"`
	Source      string                      `json:"source,omitempty"`
	Rationale   string                      `json:"rationale,omitempty"`
	Phase       string                      `json:"phase,omitempty"`
	Message     string                      `json:"message,omitempty"`
	SpanIDs     []string                    `json:"spanIds,omitempty"`
}

// QualityCodeEvidence is the authored-source snapshot plus curated values a
// user can inspect at the check. It intentionally does not expose arbitrary
// JavaScript locals.
type QualityCodeEvidence struct {
	PrimaryFrame   QualitySourceFrame     `json:"primaryFrame"`
	ValuesAtCheck  []QualityEvidenceValue `json:"valuesAtCheck"`
	OpenedInEditor *QualityEditorLocation `json:"openedInEditor,omitempty"`
}

// QualityEditorLocation is a best-effort local editor target for the primary
// authored frame.
type QualityEditorLocation struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column *int   `json:"column,omitempty"`
}

// QualityBaselineEvidence reports whether baseline output evidence is
// available. Phase 5 returns explicit unavailable states; Phase 6 fills the
// available branch once output retention exists.
type QualityBaselineEvidence struct {
	Kind         string                       `json:"kind"`
	BaselineID   string                       `json:"baselineId,omitempty"`
	ExperimentID string                       `json:"experimentId,omitempty"`
	SameInput    *bool                        `json:"sameInput,omitempty"`
	SameCase     *bool                        `json:"sameCase,omitempty"`
	BaselineCell *QualityBaselineCellEvidence `json:"baselineCell,omitempty"`
	Deltas       []QualityBaselineDelta       `json:"deltas,omitempty"`
	Reason       string                       `json:"reason,omitempty"`
}

// QualityBaselineCellEvidence is the comparable baseline cell snapshot used
// by future output diff evidence.
type QualityBaselineCellEvidence struct {
	Status string                 `json:"status"`
	Output any                    `json:"output,omitempty"`
	Scores []QualityScoreEvidence `json:"scores"`
}

// QualityBaselineDelta is one candidate-vs-baseline score delta.
type QualityBaselineDelta struct {
	ScoreName string  `json:"scoreName"`
	Baseline  float64 `json:"baseline"`
	Candidate float64 `json:"candidate"`
	Delta     float64 `json:"delta"`
}

// QualityTraceEvidence carries defensible trace references for the cell. The
// first implementation may omit hot spans while still preserving trace IDs.
type QualityTraceEvidence struct {
	TraceIDs         []string                   `json:"traceIds"`
	RetainedTraceIDs []string                   `json:"retainedTraceIds"`
	HotSpanIDs       []string                   `json:"hotSpanIds"`
	RootCause        *QualityTraceRootCause     `json:"rootCause,omitempty"`
	Spans            []QualityTraceSpanEvidence `json:"spans"`
}

// QualityTraceRootCause explains why a span was identified as relevant.
type QualityTraceRootCause struct {
	Summary    string `json:"summary"`
	SpanID     string `json:"spanId,omitempty"`
	Confidence string `json:"confidence"`
}

// QualityTraceSpanEvidence is a compact waterfall row for one trace span.
type QualityTraceSpanEvidence struct {
	SpanID       string  `json:"spanId"`
	ParentSpanID string  `json:"parentSpanId,omitempty"`
	Name         string  `json:"name"`
	Kind         string  `json:"kind,omitempty"`
	StartMs      float64 `json:"startMs"`
	DurationMs   float64 `json:"durationMs"`
	Status       string  `json:"status"`
	Hot          bool    `json:"hot"`
}

// QualityReproEvidence gives command surfaces enough information to reproduce
// or refetch the same evidence record.
type QualityReproEvidence struct {
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

// QualityEvidenceProvenance records which local sources contributed to the
// evidence read model when that information is available.
type QualityEvidenceProvenance struct {
	ExperimentRecordPath  string `json:"experimentRecordPath,omitempty"`
	BaselineRecordPath    string `json:"baselineRecordPath,omitempty"`
	SourceCatalogVersion  string `json:"sourceCatalogVersion,omitempty"`
	SourceResolverVersion string `json:"sourceResolverVersion,omitempty"`
}

// QualityEvidenceValue is a curated value exposed at a failed or selected
// check. Values are already redacted and bounded by the time they leave the
// evidence service.
type QualityEvidenceValue = QualityAssertionValue
