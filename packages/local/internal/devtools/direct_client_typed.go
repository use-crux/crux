package devtools

import (
	"context"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Typed accessors over the in-process quality + devtools services.
// These avoid the path-string dispatch in GetJSON and return strongly typed
// records from `internal/api`. Internally they JSON-roundtrip the unexported
// quality records into the exported api types so the TUI can depend only on
// `internal/api` without importing `internal/quality`.

func (c *DirectClient) Overview(ctx context.Context) (api.QualityOverviewRecord, error) {
	var out api.QualityOverviewRecord
	if c.quality == nil {
		return out, errNoQualityService
	}
	rec, err := c.quality.Overview(ctx)
	if err != nil {
		return out, err
	}
	return out, assignJSON(&out, rec)
}

func (c *DirectClient) Insights(ctx context.Context) ([]api.QualityInsightRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Insights(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualityInsightRecord
	return out, assignJSON(&out, recs)
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
	recs, err := c.quality.RunsWithOptions(ctx, opts)
	if err != nil {
		return nil, err
	}
	var out []api.QualityRunRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) RunDetail(ctx context.Context, traceID string) (api.QualityRunDetailRecord, bool, error) {
	var out api.QualityRunDetailRecord
	if c.quality == nil {
		return out, false, errNoQualityService
	}
	rec, found, err := c.quality.RunDetail(ctx, traceID)
	if err != nil || !found {
		return out, found, err
	}
	return out, true, assignJSON(&out, rec)
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
	var index api.IndexData
	err := c.GetJSON(ctx, "/api/project/index", &index)
	return index, err
}

func (c *DirectClient) Experiments(ctx context.Context) ([]api.QualityExperimentRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Experiments(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualityExperimentRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) Suites(ctx context.Context) ([]api.QualitySuiteRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Suites(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualitySuiteRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) Suite(ctx context.Context, suiteID string) (api.QualitySuiteRecord, bool, error) {
	var out api.QualitySuiteRecord
	if c.quality == nil {
		return out, false, errNoQualityService
	}
	rec, found, err := c.quality.Suite(ctx, suiteID)
	if err != nil || !found {
		return out, found, err
	}
	return out, true, assignJSON(&out, rec)
}

func (c *DirectClient) Comparisons(ctx context.Context) ([]api.QualityComparisonRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Comparisons(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualityComparisonRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) Baselines(ctx context.Context) ([]api.QualityBaselineRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Baselines(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualityBaselineRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) Feedback(ctx context.Context) ([]api.QualityFeedbackRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Feedback(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualityFeedbackRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) Cassettes(ctx context.Context) ([]api.QualityCassetteRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Cassettes(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualityCassetteRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) Scorers(ctx context.Context) ([]api.QualityScorerRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	recs, err := c.quality.Scorers(ctx)
	if err != nil {
		return nil, err
	}
	var out []api.QualityScorerRecord
	return out, assignJSON(&out, recs)
}

func (c *DirectClient) Activity(ctx context.Context, limit int) ([]api.QualityActivityEvent, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return c.quality.RecentActivity(ctx, limit)
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
