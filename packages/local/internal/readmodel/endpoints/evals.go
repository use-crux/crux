package endpoints

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
)

// EvalReads owns exact V3 run and committed Baseline artifacts.
type EvalReads interface {
	ListRuns() ([]json.RawMessage, error)
	ReadRunRaw(string) (json.RawMessage, bool, error)
	ListBaselines() ([]json.RawMessage, error)
	ReadBaselineRaw(string) (json.RawMessage, bool, error)
}

var EvalCatalog = readmodel.Get(Registry, "GET /api/eval/catalog",
	func(ctx context.Context, deps Deps) ([]json.RawMessage, error) {
		return deps.EvalCatalog.EvalManifests(ctx)
	})

var EvalRuns = readmodel.Get(Registry, "GET /api/eval/runs",
	func(_ context.Context, deps Deps) ([]json.RawMessage, error) {
		return deps.Eval.ListRuns()
	})

var EvalRun = readmodel.GetP[Deps, *readmodel.PathID, json.RawMessage](Registry, "GET /api/eval/runs/{runId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "runId"} },
	func(_ context.Context, deps Deps, params *readmodel.PathID) (json.RawMessage, error) {
		run, found, err := deps.Eval.ReadRunRaw(params.ID)
		if err != nil || found {
			return run, err
		}
		return run, readmodel.ErrNotFound
	})

var EvalBaselines = readmodel.Get(Registry, "GET /api/eval/baselines",
	func(_ context.Context, deps Deps) ([]json.RawMessage, error) {
		return deps.Eval.ListBaselines()
	})

var EvalBaseline = readmodel.GetP[Deps, *readmodel.PathID, json.RawMessage](Registry, "GET /api/eval/baselines/{evalId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "evalId"} },
	func(_ context.Context, deps Deps, params *readmodel.PathID) (json.RawMessage, error) {
		baseline, found, err := deps.Eval.ReadBaselineRaw(params.ID)
		if err != nil || found {
			return baseline, err
		}
		return baseline, readmodel.ErrNotFound
	})
