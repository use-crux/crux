package devtools

import (
	"context"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
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
	return c.quality.OverviewRecordAPI(ctx)
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

// ObservabilityRuns loads the revisioned runs page and returns its rows for
// list-oriented TUI and CLI rendering.
func (c *DirectClient) ObservabilityRuns(ctx context.Context) ([]api.ObservabilityRunSummary, error) {
	if c.observability == nil {
		return nil, errNoObservabilityService
	}
	page, err := c.observability.RunsPage(ctx, observability.RunListOptions{})
	if err != nil {
		return nil, err
	}
	return page.Rows, nil
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

func (c *DirectClient) ExperimentSummaries(ctx context.Context) ([]api.QualityExperimentSummary, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return c.quality.ExperimentSummariesAPI(ctx)
}

func (c *DirectClient) ExperimentDetail(ctx context.Context, experimentID string) (api.QualityExperimentDetail, bool, error) {
	if c.quality == nil {
		return api.QualityExperimentDetail{}, false, errNoQualityService
	}
	return c.quality.ExperimentDetailAPI(ctx, experimentID)
}

func (c *DirectClient) PromotedBaselines(ctx context.Context) ([]api.QualityPromotedBaseline, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return c.quality.PromotedBaselinesAPI(ctx)
}

func (c *DirectClient) EvaluationProgress(ctx context.Context, evaluationID string, limit int) (api.QualityEvaluationProgress, bool, error) {
	if c.quality == nil {
		return api.QualityEvaluationProgress{}, false, errNoQualityService
	}
	return c.quality.EvaluationProgressAPI(ctx, evaluationID, limit)
}

func (c *DirectClient) EvaluationExperiments(ctx context.Context, evaluationID string, limit int) (api.QualityEvaluationExperiments, error) {
	if c.quality == nil {
		return api.QualityEvaluationExperiments{}, errNoQualityService
	}
	return c.quality.EvaluationExperimentsAPI(ctx, evaluationID, limit)
}

func (c *DirectClient) EvaluationExperimentGroups(ctx context.Context, limit int) (api.QualityEvaluationExperimentGroups, error) {
	if c.quality == nil {
		return api.QualityEvaluationExperimentGroups{}, errNoQualityService
	}
	return c.quality.EvaluationExperimentGroupsAPI(ctx, limit)
}

func (c *DirectClient) CellEvidence(ctx context.Context, query api.QualityCellEvidenceQuery) (api.QualityCellEvidence, bool, error) {
	if c.quality == nil {
		return api.QualityCellEvidence{}, false, errNoQualityService
	}
	return c.quality.CellEvidenceAPI(ctx, query)
}

func (c *DirectClient) Feedback(ctx context.Context) ([]api.QualityFeedbackRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return endpoints.QualityFeedback.Call(ctx, endpoints.Deps{Quality: c.quality})
}

func (c *DirectClient) CassetteFiles(ctx context.Context) ([]api.QualityCassetteFileRecord, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return c.quality.CassetteFilesAPI(ctx)
}

func (c *DirectClient) ScorerStats(ctx context.Context) ([]api.QualityScorerStats, error) {
	if c.quality == nil {
		return nil, errNoQualityService
	}
	return c.quality.ScorerStatsAPI(ctx)
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
