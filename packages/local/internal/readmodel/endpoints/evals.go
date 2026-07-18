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
	func(ctx context.Context, deps Deps) ([]json.RawMessage, error) {
		baselines, err := deps.Eval.ListBaselines()
		if err != nil {
			return nil, err
		}
		return attachCurrentBaselineCompatibility(ctx, deps, baselines)
	})

var EvalBaseline = readmodel.GetP[Deps, *readmodel.PathID, json.RawMessage](Registry, "GET /api/eval/baselines/{evalId}",
	func() *readmodel.PathID { return &readmodel.PathID{Name: "evalId"} },
	func(ctx context.Context, deps Deps, params *readmodel.PathID) (json.RawMessage, error) {
		baseline, found, err := deps.Eval.ReadBaselineRaw(params.ID)
		if err != nil {
			return baseline, err
		}
		if found {
			enriched, enrichErr := attachCurrentBaselineCompatibility(ctx, deps, []json.RawMessage{baseline})
			if enrichErr != nil {
				return nil, enrichErr
			}
			return enriched[0], nil
		}
		return baseline, readmodel.ErrNotFound
	})

func attachCurrentBaselineCompatibility(ctx context.Context, deps Deps, baselines []json.RawMessage) ([]json.RawMessage, error) {
	manifests, err := deps.EvalCatalog.EvalManifests(ctx)
	if err != nil {
		return nil, err
	}
	compatibility := make(map[string]json.RawMessage, len(manifests))
	for _, manifest := range manifests {
		var value struct {
			ID                    string          `json:"id"`
			BaselineCompatibility json.RawMessage `json:"baselineCompatibility"`
		}
		if err := json.Unmarshal(manifest, &value); err != nil {
			return nil, err
		}
		if value.ID != "" && len(value.BaselineCompatibility) > 0 {
			compatibility[value.ID] = value.BaselineCompatibility
		}
	}
	result := make([]json.RawMessage, 0, len(baselines))
	for _, baseline := range baselines {
		var value map[string]json.RawMessage
		if err := json.Unmarshal(baseline, &value); err != nil {
			return nil, err
		}
		var evalID string
		if err := json.Unmarshal(value["evalId"], &evalID); err != nil {
			return nil, err
		}
		if current, ok := compatibility[evalID]; ok {
			value["baselineCompatibility"] = current
		} else {
			value["baselineCompatibility"] = json.RawMessage(`{"status":"unknown","reason":"current_eval_not_discovered","cases":[],"currentOnlyCases":[]}`)
		}
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, err
		}
		result = append(result, encoded)
	}
	return result, nil
}
