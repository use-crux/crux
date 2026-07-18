package screens

import (
	"context"
	"encoding/json"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
)

var testContext = context.Background()

func runsListLoadedForTest(runs *Runs, values ...api.ObservabilityRunSummary) runsListLoadedMsg {
	_, token := runs.runsResource.Begin(testContext, runsListOwner, 0)
	token.Revision = maxRunRevision(token.Revision, values)
	return runsListLoadedMsg(resource.ResourceResult[[]api.ObservabilityRunSummary]{
		Token: token,
		Value: values,
	})
}

func setRunsForTest(runs *Runs, values ...api.ObservabilityRunSummary) {
	runs.Update(testContext, runsListLoadedForTest(runs, values...), nil)
}

func selectRunForTest(runs *Runs, id string) {
	if id == "" {
		runs.runList.SetItems(nil)
		return
	}
	if !runs.hasRun(id) {
		routed := api.ObservabilityRunSummary{RunID: id, Name: id}
		runs.routedRun = &routed
	}
	runs.runList.SetItems(runs.selectableRuns())
	if !runs.runList.Select(id) {
		panic("test selected run is not available: " + id)
	}
}

func setRunDetailForTest(runs *Runs, detail api.ObservabilityRunDetail) {
	runs.Update(testContext, runDetailLoadedForTest(runs, detail), nil)
}

func runDetailLoadedForTest(runs *Runs, detail api.ObservabilityRunDetail) runDetailLoadedMsg {
	_, token := runs.detailResource.Begin(testContext, runsDetailOwner(detail.Run.RunID), uint64(detail.Run.Revision))
	return runDetailLoadedMsg(resource.ResourceResult[api.ObservabilityRunDetail]{
		Token: token,
		Value: detail,
	})
}

func observabilityRunSummaryForTest(run api.InspectRunRecord) api.ObservabilityRunSummary {
	metrics, _ := json.Marshal(map[string]any{"totalTokens": run.TokenCount})
	startedAt := ""
	if run.StartedAt != 0 {
		startedAt = time.UnixMilli(run.StartedAt).UTC().Format(time.RFC3339Nano)
	}
	return api.ObservabilityRunSummary{
		RunID:         run.TraceID,
		TraceID:       run.TraceID,
		SessionID:     run.SessionID,
		Name:          run.TargetID,
		RootPrimitive: run.RootPrimitive,
		Status:        run.Status,
		StartedAt:     startedAt,
		DurationMs:    valueOrZero(run.DurationMs),
		Model:         run.Model,
		Provider:      run.Provider,
		SpanCount:     run.SpanCount,
		Metrics:       metrics,
	}
}

func valueOrZero(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}
