package domain

import (
	"encoding/json"
	"fmt"
)

// ExitError signals that the CLI should terminate with a specific exit code.
// Commands return this instead of calling os.Exit directly, allowing main to
// handle cleanup and defer statements before exiting. Check for it with
// errors.As in the top-level error handler.
type ExitError struct{ Code int }

// Error implements the error interface.
func (e ExitError) Error() string { return fmt.Sprintf("exit %d", e.Code) }

// NDJSON protocol types mirroring the eval-runner.ts streaming format.
// These types are used by both CI mode (direct parsing) and TUI mode
// (Bubbletea message passing) in the eval command.

// EvalEvent represents a single event in the eval NDJSON stream.
type EvalEvent struct {
	Type string `json:"type"`

	// config
	EvalCount  int    `json:"evalCount,omitempty"`
	FlowCount  int    `json:"flowCount,omitempty"`
	RagCount   int    `json:"ragCount,omitempty"`
	ConfigPath string `json:"configPath,omitempty"`

	// eval:start / eval:done / flow:start / flow:done
	Name   string           `json:"name,omitempty"`
	Index  int              `json:"index,omitempty"`
	Total  int              `json:"total,omitempty"`
	Result *json.RawMessage `json:"result,omitempty"`

	// flow:case
	CaseResult *json.RawMessage `json:"caseResult,omitempty"`

	// summary
	Summary        *json.RawMessage `json:"summary,omitempty"`
	Export         *json.RawMessage `json:"export,omitempty"`
	AnalysisPrompt string           `json:"analysisPrompt,omitempty"`

	// quality:persisted
	QualityExperimentCount int      `json:"count,omitempty"`
	QualityExperimentIDs   []string `json:"experimentIds,omitempty"`

	// error
	Message   string           `json:"message,omitempty"`
	ErrorName string           `json:"name,omitempty"`
	Stack     string           `json:"stack,omitempty"`
	Details   *json.RawMessage `json:"details,omitempty"`
}

// EvalRunResult holds the outcome of a single eval or flow run.
type EvalRunResult struct {
	Name       string      `json:"name"`
	DurationMs float64     `json:"durationMs"`
	CaseCount  int         `json:"caseCount"`
	Error      string      `json:"error,omitempty"`
	Report     *EvalReport `json:"report,omitempty"`
}

// EvalReport contains the detailed results of an eval run.
type EvalReport struct {
	Summary EvalReportSummary `json:"summary"`
	Results []EvalCaseResult  `json:"results"`
}

// EvalReportSummary aggregates pass/fail counts.
type EvalReportSummary struct {
	Total   int                    `json:"total"`
	Passed  int                    `json:"passed"`
	Failed  int                    `json:"failed"`
	ByModel map[string]ModelCounts `json:"byModel"`
}

// ModelCounts tracks per-model pass/fail.
type ModelCounts struct {
	Total  int `json:"total"`
	Passed int `json:"passed"`
	Failed int `json:"failed"`
}

// EvalCaseResult holds the result for a single eval case.
type EvalCaseResult struct {
	CaseName   string  `json:"caseName"`
	ModelID    string  `json:"modelId"`
	Passed     bool    `json:"passed"`
	DurationMs float64 `json:"durationMs"`
	Error      string  `json:"error,omitempty"`
}

// EvalSummaryData is the final summary emitted at the end of an eval run.
type EvalSummaryData struct {
	TotalPassed int                       `json:"totalPassed"`
	TotalFailed int                       `json:"totalFailed"`
	TotalTokens int                       `json:"totalTokens"`
	TotalCost   float64                   `json:"totalCost"`
	ByModel     map[string]ModelStatsData `json:"byModel"`
	ExitCode    int                       `json:"exitCode"`
}

// ModelStatsData tracks per-model stats in the summary.
type ModelStatsData struct {
	Passed     int     `json:"passed"`
	Failed     int     `json:"failed"`
	Tokens     int     `json:"tokens"`
	Cost       float64 `json:"cost"`
	DurationMs float64 `json:"durationMs"`
}

// DeriveStatus computes the display status for an eval result.
// Returns "error" if the run itself errored, "fail" if any cases failed,
// or "success" if all cases passed. Error takes precedence over failure.
func DeriveStatus(result *EvalRunResult) string {
	if result.Error != "" {
		return "error"
	}
	if result.Report != nil && result.Report.Summary.Failed > 0 {
		return "fail"
	}
	return "success"
}
