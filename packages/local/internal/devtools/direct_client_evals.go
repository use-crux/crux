package devtools

import (
	"context"
	"encoding/json"

	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
)

// EvalCatalog returns the additive discovery manifests used by Eval surfaces.
func (c *DirectClient) EvalCatalog(ctx context.Context) ([]json.RawMessage, error) {
	if c.evalCatalog == nil {
		return nil, errNoEvalReads
	}
	return endpoints.EvalCatalog.Call(ctx, c.evalDeps())
}

// EvalRuns returns validated V3/V4 artifacts without reinterpreting them.
func (c *DirectClient) EvalRuns(ctx context.Context) ([]json.RawMessage, error) {
	if c.eval == nil {
		return nil, errNoEvalReads
	}
	return endpoints.EvalRuns.Call(ctx, c.evalDeps())
}

// EvalRun returns one validated V3/V4 artifact by its persisted run ID.
func (c *DirectClient) EvalRun(ctx context.Context, id string) (json.RawMessage, error) {
	if c.eval == nil {
		return nil, errNoEvalReads
	}
	return endpoints.EvalRun.Call(ctx, c.evalDeps(), &readmodel.PathID{ID: id})
}

// EvalBaselines returns committed baselines with current compatibility attached.
func (c *DirectClient) EvalBaselines(ctx context.Context) ([]json.RawMessage, error) {
	if c.eval == nil || c.evalCatalog == nil {
		return nil, errNoEvalReads
	}
	return endpoints.EvalBaselines.Call(ctx, c.evalDeps())
}

func (c *DirectClient) evalDeps() endpoints.Deps {
	return endpoints.Deps{Eval: c.eval, EvalCatalog: c.evalCatalog}
}
