package devtools

import (
	"context"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
)

// Typed accessors over the in-process quality + devtools services.
// These avoid the path-string dispatch in GetJSON and return strongly typed
// records from `internal/api`. Internally they JSON-roundtrip the unexported
// quality records into the exported api types so the TUI can depend only on
// `internal/api` without importing `internal/quality`.

func (c *DirectClient) Overview(ctx context.Context) (api.QualityOverviewRecord, error) {
	if c.quality == nil {
		return api.QualityOverviewRecord{}, errNoQualityService
	}
	return endpoints.QualityOverview.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Insights(ctx context.Context) ([]api.QualityInsightRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityInsights.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Runs(ctx context.Context) ([]api.QualityRunRecord, error) {
	return c.RunsWithOptions(ctx, api.QualityRunsOptions{})
}

// RunsWithOptions calls the in-process quality service with full
// filter/sort/limit options — same surface as the HTTP query params on
// /api/quality/runs.
func (c *DirectClient) RunsWithOptions(ctx context.Context, opts api.QualityRunsOptions) ([]api.QualityRunRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityRuns.Call(ctx, endpoints.Deps{Quality: c.quality}, &endpoints.RunsParams{QualityRunsOptions: opts})
}

func (c *DirectClient) RunDetail(ctx context.Context, traceID string) (api.QualityRunDetailRecord, bool, error) {
	if c.quality == nil {
		return api.QualityRunDetailRecord{}, false, errNoQualityService
	}
	record, err := endpoints.QualityRunDetail.Call(ctx, endpoints.Deps{Quality: c.quality}, &readmodel.PathID{ID: traceID})
	if errors.Is(err, readmodel.ErrNotFound) {
		return api.QualityRunDetailRecord{}, false, nil
	}
	return record, err == nil, err
}

func (c *DirectClient) ObservabilityRuns(ctx context.Context) ([]api.ObservabilityRunSummary, error) {
	var runs []api.ObservabilityRunSummary
	err := c.GetJSON(ctx, "/api/observability/runs", &runs)
	return runs, err
}

func (c *DirectClient) ObservabilityRunDetail(ctx context.Context, runID string) (api.ObservabilityRunDetail, bool, error) {
	if c.observability == nil {
		return api.ObservabilityRunDetail{}, false, errNoObservabilityService
	}
	detail, err := c.observability.RunDetail(ctx, runID)
	if err != nil {
		if err.Error() == "not found" {
			return api.ObservabilityRunDetail{}, false, nil
		}
		return api.ObservabilityRunDetail{}, false, err
	}
	return detail, true, nil
}

func (c *DirectClient) ObservabilityResourceActivity(ctx context.Context, family string) ([]api.ObservabilityResourceActivity, error) {
	var activity []api.ObservabilityResourceActivity
	err := c.GetJSON(ctx, "/api/observability/resources/"+family, &activity)
	return activity, err
}

func (c *DirectClient) ProjectIndex(ctx context.Context) (api.IndexData, error) {
	return endpoints.ProjectIndex.Call(ctx, endpoints.Deps{Devtools: c.devtools})
}

func (c *DirectClient) Experiments(ctx context.Context) ([]api.QualityExperimentRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityExperiments.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Suites(ctx context.Context) ([]api.QualitySuiteRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualitySuites.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Suite(ctx context.Context, suiteID string) (api.QualitySuiteRecord, bool, error) {
	if c.quality == nil {
		return api.QualitySuiteRecord{}, false, errNoQualityService
	}
	record, err := endpoints.QualitySuite.Call(ctx, endpoints.Deps{Quality: c.quality}, &readmodel.PathID{ID: suiteID})
	if errors.Is(err, readmodel.ErrNotFound) {
		return api.QualitySuiteRecord{}, false, nil
	}
	return record, err == nil, err
}

func (c *DirectClient) Comparisons(ctx context.Context) ([]api.QualityComparisonRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityComparisons.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Baselines(ctx context.Context) ([]api.QualityBaselineRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityBaselines.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Feedback(ctx context.Context) ([]api.QualityFeedbackRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityFeedback.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Cassettes(ctx context.Context) ([]api.QualityCassetteRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityCassettes.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Scorers(ctx context.Context) ([]api.QualityScorerRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityScorers.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) Activity(ctx context.Context, limit int) ([]api.QualityActivityEvent, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityActivity.Call(ctx, endpoints.Deps{Quality: c.quality}, &readmodel.Limit{N: limit})
}

func (c *DirectClient) DevtoolsContext(_ context.Context) (api.DevtoolsContext, error) {
	return c.devtools.Context(), nil
}

func (c *DirectClient) SubscribeQuality(ctx context.Context) <-chan api.QualityEvent {
	if c.quality == nil {
		ch := make(chan api.QualityEvent)
		close(ch)
		return ch
	}
	return c.quality.Events().Subscribe(ctx)
}
