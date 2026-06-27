package qualityfs

type Comparison struct {
	Tag        string                `json:"_tag"`
	ID         string                `json:"id"`
	QualityID  string                `json:"qualityId"`
	ComparedAt string                `json:"comparedAt"`
	Baseline   ComparisonSummary     `json:"baseline"`
	Candidate  ComparisonSummary     `json:"candidate"`
	Metrics    ComparisonMetrics     `json:"metrics"`
	CaseDeltas []ComparisonCaseDelta `json:"caseDeltas,omitempty"`
	Status     string                `json:"status"`
}

type ComparisonCaseDelta struct {
	CaseID       string              `json:"caseId"`
	CaseName     string              `json:"caseName,omitempty"`
	Status       string              `json:"status"`
	Baseline     *ComparisonCaseSide `json:"baseline,omitempty"`
	Candidate    *ComparisonCaseSide `json:"candidate,omitempty"`
	ScoreDelta   *float64            `json:"scoreDelta,omitempty"`
	OutputChange string              `json:"outputChange,omitempty"`
}

type ComparisonCaseSide struct {
	TraceID       string   `json:"traceId,omitempty"`
	Status        string   `json:"status"`
	OutputPreview string   `json:"outputPreview,omitempty"`
	Score         *float64 `json:"score,omitempty"`
	DurationMs    float64  `json:"durationMs"`
}

type ComparisonSummary struct {
	ExperimentID  string             `json:"experimentId"`
	VariantID     *string            `json:"variantId,omitempty"`
	Label         *string            `json:"label,omitempty"`
	Total         int                `json:"total"`
	Passed        int                `json:"passed"`
	Failed        int                `json:"failed"`
	Errored       int                `json:"errored"`
	PassRate      float64            `json:"passRate"`
	AvgDurationMs float64            `json:"avgDurationMs"`
	NumericScores map[string]float64 `json:"numericScores"`
}

type ComparisonMetrics struct {
	PassRateDelta      float64                      `json:"passRateDelta"`
	AvgDurationMsDelta float64                      `json:"avgDurationMsDelta"`
	NumericScoreDeltas map[string]NumericScoreDelta `json:"numericScoreDeltas"`
}

type NumericScoreDelta struct {
	Baseline  *float64 `json:"baseline,omitempty"`
	Candidate *float64 `json:"candidate,omitempty"`
	Delta     *float64 `json:"delta,omitempty"`
}

type Baseline struct {
	Tag          string            `json:"_tag"`
	ID           string            `json:"id"`
	QualityID    string            `json:"qualityId"`
	ExperimentID string            `json:"experimentId"`
	VariantID    *string           `json:"variantId,omitempty"`
	Label        *string           `json:"label,omitempty"`
	PromotedAt   string            `json:"promotedAt"`
	Summary      ComparisonSummary `json:"summary"`
}
