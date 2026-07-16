package endpoints

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

// EvalReads is the private V3 run read boundary shared by future CLI and
// Devtools surfaces. It deliberately exposes no Experiment-era vocabulary.
type EvalReads interface {
	ListRuns() ([]json.RawMessage, error)
	ReadRunRaw(string) (json.RawMessage, bool, error)
}

// EvalRuns lists exact future-additive Eval V3 records.
var EvalRuns = readmodel.Get(Registry, "GET /api/eval/runs",
	func(_ context.Context, deps Deps) ([]json.RawMessage, error) {
		return deps.Eval.ListRuns()
	})

// EvalRun serves one exact future-additive Eval V3 record.
var EvalRun = readmodel.GetP[Deps, *readmodel.PathID, json.RawMessage](Registry, "GET /api/eval/runs/{runId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "runId"} },
	func(_ context.Context, deps Deps, params *readmodel.PathID) (json.RawMessage, error) {
		run, found, err := deps.Eval.ReadRunRaw(params.ID)
		if err != nil || found {
			return run, err
		}
		return run, readmodel.ErrNotFound
	})
