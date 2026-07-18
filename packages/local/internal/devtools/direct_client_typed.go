package devtools

import (
	"context"
	"errors"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
)

// Typed accessors over the in-process Inspect and devtools services.
// These avoid the path-string dispatch in GetJSON and return strongly typed
// records from `internal/api`. Internally they JSON-roundtrip the unexported
// Inspect records into the exported api types so the TUI can depend only on
// `internal/api` without importing `internal/inspect`.

func (c *DirectClient) Overview(ctx context.Context) (api.InspectOverviewRecord, error) {
	if c.inspect == nil {
		return api.InspectOverviewRecord{}, errNoInspectService
	}
	return c.inspect.OverviewRecordAPI(ctx)
}

func (c *DirectClient) Insights(ctx context.Context) ([]api.InspectInsightRecord, error) {
	if c.inspect == nil {
		return nil, errNoInspectService
	}
	return endpoints.InspectInsights.Call(ctx, endpoints.Deps{Inspect: c.inspect})
}

func (c *DirectClient) Runs(ctx context.Context) ([]api.InspectRunRecord, error) {
	return c.RunsWithOptions(ctx, api.InspectRunsOptions{})
}

// RunsWithOptions calls the in-process Inspect service with full
// filter/sort/limit options — same surface as the HTTP query params on
// /api/inspect/runs.
func (c *DirectClient) RunsWithOptions(ctx context.Context, opts api.InspectRunsOptions) ([]api.InspectRunRecord, error) {
	if c.inspect == nil {
		return nil, errNoInspectService
	}
	return endpoints.InspectRuns.Call(ctx, endpoints.Deps{Inspect: c.inspect}, &endpoints.RunsParams{InspectRunsOptions: opts})
}

func (c *DirectClient) RunDetail(ctx context.Context, traceID string) (api.InspectRunDetailRecord, bool, error) {
	if c.inspect == nil {
		return api.InspectRunDetailRecord{}, false, errNoInspectService
	}
	record, err := endpoints.InspectRunDetail.Call(ctx, endpoints.Deps{Inspect: c.inspect}, &readmodel.PathID{ID: traceID})
	if errors.Is(err, readmodel.ErrNotFound) {
		return api.InspectRunDetailRecord{}, false, nil
	}
	return record, err == nil, err
}

// ObservabilityRunsPage loads the revisioned Runs read-model page.
func (c *DirectClient) ObservabilityRunsPage(ctx context.Context) (api.ObservabilityRunsPage, error) {
	if c.observability == nil {
		return api.ObservabilityRunsPage{}, errNoObservabilityService
	}
	page, err := c.observability.RunsPage(ctx, observability.RunListOptions{})
	if err != nil {
		return api.ObservabilityRunsPage{}, err
	}
	return page, nil
}

// ObservabilityRuns loads Runs rows for list-oriented CLI rendering.
func (c *DirectClient) ObservabilityRuns(ctx context.Context) ([]api.ObservabilityRunSummary, error) {
	page, err := c.ObservabilityRunsPage(ctx)
	return page.Rows, err
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

func (c *DirectClient) Activity(ctx context.Context, limit int) ([]api.InspectActivityEvent, error) {
	if c.inspect == nil {
		return nil, errNoInspectService
	}
	return endpoints.InspectActivity.Call(ctx, endpoints.Deps{Inspect: c.inspect}, &readmodel.Limit{N: limit})
}

func (c *DirectClient) DevtoolsContext(_ context.Context) (api.DevtoolsContext, error) {
	return c.devtools.Context(), nil
}

func (c *DirectClient) SubscribeInspect(ctx context.Context) <-chan api.InspectEvent {
	if c.inspect == nil {
		ch := make(chan api.InspectEvent)
		close(ch)
		return ch
	}
	return c.inspect.Events().Subscribe(ctx)
}
