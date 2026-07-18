// Package evalrunner invokes the project-local Eval coordinator.
package evalrunner

import "context"

// RunRequest selects one discovered Eval for execution.
type RunRequest struct {
	EvalID             string `json:"evalId"`
	ConfirmUnknownCost bool   `json:"confirmUnknownCost"`
}

// RunResult identifies the persisted run produced by the coordinator.
type RunResult struct {
	EvalID   string   `json:"evalId"`
	RunID    string   `json:"runId"`
	RunIDs   []string `json:"runIds"`
	ExitCode int      `json:"exitCode"`
	Passed   bool     `json:"passed"`
}

// Runner executes one Eval through the canonical coordinator.
type Runner interface {
	Run(context.Context, RunRequest) (RunResult, error)
}
