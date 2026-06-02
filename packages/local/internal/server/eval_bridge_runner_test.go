package server

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/runtimebridge"
)

func TestEvalRunFilter(t *testing.T) {
	tests := []struct {
		name string
		req  runtimebridge.EvalRunRequest
		want string
	}{
		{name: "suite wins", req: runtimebridge.EvalRunRequest{SuiteID: "writer", TargetID: "eval:ignored"}, want: "writer"},
		{name: "eval target prefix", req: runtimebridge.EvalRunRequest{TargetID: "eval:daily-briefing"}, want: "daily-briefing"},
		{name: "rag target prefix", req: runtimebridge.EvalRunRequest{TargetID: "rag-eval:retrieval"}, want: "retrieval"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := evalRunFilter(tt.req); got != tt.want {
				t.Fatalf("evalRunFilter() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestEvalRunnerErrorEventPreservesDetails(t *testing.T) {
	err := evalRunnerCommandError(evalRunnerEvent{
		Type:    "error",
		Message: "runner exploded",
		Name:    "RunnerError",
		Stack:   "RunnerError: runner exploded\n    at eval.ts:4:1",
		Details: json.RawMessage(`{"phase":"eval_runner.main","summary":{"message":"runner exploded","name":"RunnerError"}}`),
	})

	var commandErr *runtimebridge.CommandExecutionError
	if !errors.As(err, &commandErr) {
		t.Fatalf("expected CommandExecutionError, got %T", err)
	}
	if commandErr.Code != "eval_runner_error" || commandErr.Message != "runner exploded" {
		t.Fatalf("unexpected command error: %#v", commandErr)
	}
	var details map[string]any
	if err := json.Unmarshal(commandErr.Details, &details); err != nil {
		t.Fatalf("decode details: %v", err)
	}
	if details["phase"] != "eval_runner.main" || details["stack"] != "RunnerError: runner exploded\n    at eval.ts:4:1" {
		t.Fatalf("unexpected details: %#v", details)
	}
}
