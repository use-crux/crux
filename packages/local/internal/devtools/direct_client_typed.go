package devtools

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/readmodel"
	"github.com/use-crux/crux/packages/local/internal/readmodel/endpoints"
	"github.com/use-crux/crux/packages/local/internal/store"
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

// ObservabilityRunsPage loads the revisioned Runs read-model page.
func (c *DirectClient) ObservabilityRunsPage(ctx context.Context, definitionID ...string) (api.ObservabilityRunsPage, error) {
	return c.ObservabilityRunsPageWithOptions(ctx, api.InspectRunsOptions{}, definitionID...)
}

// ObservabilityRunsPageWithOptions applies list filters before the bounded
// canonical page is enriched with usage rollups.
func (c *DirectClient) ObservabilityRunsPageWithOptions(
	ctx context.Context,
	filters api.InspectRunsOptions,
	definitionID ...string,
) (api.ObservabilityRunsPage, error) {
	if c.observability == nil {
		return api.ObservabilityRunsPage{}, errNoObservabilityService
	}
	opts := observability.RunListOptions{
		Limit:                   100,
		IncludeExpensiveRollups: true,
		Status:                  filters.Status,
	}
	if filters.Since > 0 {
		opts.Since = time.UnixMilli(filters.Since).UTC().Format(time.RFC3339Nano)
	}
	if filters.Until > 0 {
		opts.Until = time.UnixMilli(filters.Until).UTC().Format(time.RFC3339Nano)
	}
	if len(filters.Session) == 1 {
		opts.SessionID = filters.Session[0]
	}
	if len(definitionID) > 0 {
		opts.DefinitionID = definitionID[0]
	}
	page, err := c.observability.RunsPage(ctx, opts)
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

// Sessions returns the in-process session summaries used by Runs grouping.
func (c *DirectClient) Sessions(ctx context.Context) ([]store.SessionInfo, error) {
	if c.devtools == nil {
		return nil, errNoDevtoolsService
	}
	return c.devtools.Sessions(ctx), nil
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

// DefinitionActivity returns the bounded per-definition runtime join used by
// Catalog surfaces without routing through HTTP.
func (c *DirectClient) DefinitionActivity(ctx context.Context, definitionID string) (api.CatalogRuntimeActivityV1, error) {
	activity := api.CatalogRuntimeActivityV1{DefinitionID: definitionID}
	if c.observability == nil {
		return activity, errNoObservabilityService
	}
	summary, err := c.observability.DefinitionActivitySummary(ctx, definitionID)
	if err != nil {
		return activity, err
	}
	activity.RunCount = summary.RunCount
	if summary.LastRun != nil {
		activity.LastRunID = summary.LastRun.RunID
		activity.LastRunAt = summary.LastRun.StartedAt
		activity.LastStatus = summary.LastRun.Status
	}
	return activity, nil
}

func (c *DirectClient) ProjectIndex(ctx context.Context) (api.IndexData, error) {
	return endpoints.ProjectIndex.Call(ctx, endpoints.Deps{Devtools: c.devtools})
}

func (c *DirectClient) ProjectIndexWatchStatus(ctx context.Context) (api.ProjectIndexWatchStatus, error) {
	if c.devtools == nil {
		return api.ProjectIndexWatchStatus{}, errNoDevtoolsService
	}
	return c.devtools.ProjectIndexWatchStatus(ctx)
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
