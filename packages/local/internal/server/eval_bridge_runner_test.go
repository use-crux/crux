package server

import (
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
