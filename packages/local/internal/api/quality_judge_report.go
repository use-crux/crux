package api

// QualityJudgeReport is the judge-vs-human agreement report for one
// evaluation (blueprint §4.5). It is computed by the Go read model
// (reporting/aggregation is allowed by I5) and served identically by the CLI
// (`crux quality judge-report --json`), the MCP tool, and the
// `GET /api/quality/judge-report/{evaluationId}` route.
type QualityJudgeReport struct {
	SchemaVersion int                        `json:"schemaVersion"`
	EvaluationID  string                     `json:"evaluationId"`
	Scorers       []QualityJudgeReportScorer `json:"scorers"`
}

// QualityJudgeReportScorer is the per-scorer agreement summary between judge
// predictions and human labels.
type QualityJudgeReportScorer struct {
	Name          string                           `json:"name"`
	Threshold     float64                          `json:"threshold"`
	Labeled       int                              `json:"labeled"`
	Confusion     QualityJudgeReportConfusion      `json:"confusion"`
	Agreement     float64                          `json:"agreement"`
	Precision     float64                          `json:"precision"`
	Recall        float64                          `json:"recall"`
	Kappa         *float64                         `json:"kappa"`
	Disagreements []QualityJudgeReportDisagreement `json:"disagreements"`
}

// QualityJudgeReportConfusion is the 2x2 confusion matrix of judge prediction
// vs human label (true/false positive/negative).
type QualityJudgeReportConfusion struct {
	TP int `json:"tp"`
	FP int `json:"fp"`
	FN int `json:"fn"`
	TN int `json:"tn"`
}

// QualityJudgeReportDisagreement is one cell where the judge prediction and
// the human label diverged.
type QualityJudgeReportDisagreement struct {
	ExperimentID string  `json:"experimentId"`
	CaseID       string  `json:"caseId"`
	Variant      string  `json:"variant"`
	Trial        int     `json:"trial"`
	Human        string  `json:"human"`
	JudgeScore   float64 `json:"judgeScore"`
	Rationale    string  `json:"rationale,omitempty"`
}
