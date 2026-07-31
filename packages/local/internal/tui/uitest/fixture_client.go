package uitest

import (
	"context"
	"errors"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// FixtureClient serves deterministic Inspect data for TUI render tests.
type FixtureClient struct {
	Now time.Time
}

// NewFixtureClient returns the standard mockup-shaped fixture client.
func NewFixtureClient() *FixtureClient {
	return &FixtureClient{Now: time.UnixMilli(1_778_790_044_000).UTC()}
}

func (c *FixtureClient) Overview(context.Context) (api.InspectOverviewRecord, error) {
	pass := 0.88
	cost := 2.41
	p95 := 12_700.0
	return api.InspectOverviewRecord{
		Tag:                       "InspectOverviewRecord",
		RunCount:                  42,
		InsightCount:              8,
		PassRate:                  &pass,
		CostPer100Runs:            &cost,
		P95LatencyMs:              &p95,
		PassRateHistory:           []float64{0.96, 0.94, 0.91, 0.88},
		OpenInsightsHistory:       []int{2, 4, 5, 8},
		CostSpark:                 []float64{0.55, 0.82, 1.76, 2.41},
		LatencySpark:              []float64{4400, 6100, 9800, 12700},
		OpenInsightSeverityCounts: map[string]int{"high": 3, "medium": 3, "low": 2},
		RecentRuns:                c.fixtureRuns(),
	}, nil
}

func (c *FixtureClient) Insights(context.Context) ([]api.InspectInsightRecord, error) {
	return []api.InspectInsightRecord{
		{
			Tag:            "InspectInsightRecord",
			InsightID:      "INS-014",
			Title:          "docs_agent loops on retrieval",
			Severity:       "high",
			Tags:           []string{"agent-loop", "retrieval"},
			Summary:        "docs_agent loops 5-16 iterations with duplicate rag.search calls.",
			TargetID:       "docs_agent",
			LinkedTraceIDs: []string{"8af2f1c"},
			LinkedCaseIDs:  []string{"rag/typed_prompts_definition"},
			SuspectedCause: "docs_agent.run\n  retrieve(loop x16) hits=10 dup .94\n    rag.search repeats the same query after novelty drops below 0.2",
			ProposedFixConfig: &api.InspectInsightFixConfig{
				YAML: "agent.retrieve.maxIterations: 3\nretrieval.dedupe.embedding: 0.92\nearlyStop.novelDocsRatio: 0.2\n# approx 85% fewer tokens",
				ConfigKeys: []string{
					"agent.retrieve.maxIterations",
					"retrieval.dedupe.embedding",
					"earlyStop.novelDocsRatio",
				},
			},
			DetailStats: &api.InspectInsightDetailStats{
				TokensPerRun:           18_400,
				TokensDeltaVsBaseline:  "+14.0k",
				TokensSpark:            []float64{4200, 8800, 14820, 18400},
				LatencyP95Ms:           12_700,
				LatencyDeltaVsBaseline: "+8.3s",
				LatencySpark:           []float64{4400, 6100, 9800, 12700},
				CostPer100:             2.41,
				CostDeltaVsBaseline:    "+$1.86",
				CostSpark:              []float64{0.55, 0.82, 1.76, 2.41},
			},
			OccurrenceCount: 10,
			Trend:           []float64{2, 4, 7, 10},
			Status:          "open",
			UpdatedAt:       "2026-07-02T10:00:00Z",
		},
	}, nil
}

func (c *FixtureClient) Runs(context.Context) ([]api.InspectRunRecord, error) {
	return c.fixtureRuns(), nil
}

func (c *FixtureClient) Activity(_ context.Context, limit int) ([]api.InspectActivityEvent, error) {
	items := []api.InspectActivityEvent{
		{Tag: "InspectActivityEvent", Timestamp: c.Now.UnixMilli(), Kind: "insight", Severity: "error", Summary: "INS-014 high agent-loop opened", RefID: "INS-014"},
		{Tag: "InspectActivityEvent", Timestamp: c.Now.Add(-2 * time.Minute).UnixMilli(), Kind: "run", Severity: "info", Summary: "trace 8af2f1c completed", RefID: "8af2f1c"},
	}
	if limit > 0 && len(items) > limit {
		return items[:limit], nil
	}
	return items, nil
}

func (c *FixtureClient) fixtureRuns() []api.InspectRunRecord {
	duration := 14_200.0
	cost := 0.044
	score := 0.88
	return []api.InspectRunRecord{
		{
			Tag:        "InspectRunRecord",
			TraceID:    "8af2f1c",
			TargetID:   "docs_agent",
			Status:     "failed",
			StartedAt:  c.Now.Add(-14 * time.Minute).UnixMilli(),
			DurationMs: &duration,
			Model:      "gpt-5",
			TokenCount: 18_400,
			Cost:       &cost,
			Score:      &score,
			SpanCount:  24,
		},
	}
}

func (c *FixtureClient) RunsWithOptions(ctx context.Context, _ api.InspectRunsOptions) ([]api.InspectRunRecord, error) {
	return c.Runs(ctx)
}
func (c *FixtureClient) ObservabilityRuns(context.Context) ([]api.ObservabilityRunSummary, error) {
	return nil, nil
}
func (c *FixtureClient) ObservabilityRunsPage(context.Context, ...string) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{}, nil
}
func (c *FixtureClient) ObservabilityRunDetail(_ context.Context, traceID string) (api.ObservabilityRunDetail, bool, error) {
	if traceID != "8af2f1c" {
		return api.ObservabilityRunDetail{}, false, nil
	}
	return c.fixtureRunDetail(traceID), true, nil
}
func (c *FixtureClient) ObservabilityResourceActivity(context.Context, string) ([]api.ObservabilityResourceActivity, error) {
	return nil, nil
}
func (c *FixtureClient) DefinitionActivity(_ context.Context, definitionID string) (api.CatalogRuntimeActivityV1, error) {
	if definitionID != "prompt:writer.prompt" {
		return api.CatalogRuntimeActivityV1{DefinitionID: definitionID}, nil
	}
	return api.CatalogRuntimeActivityV1{
		DefinitionID: definitionID,
		RunCount:     3,
		LastRunID:    "8af2f1c",
		LastRunAt:    c.Now.Add(-14 * time.Minute).Format(time.RFC3339),
		LastStatus:   "failed",
	}, nil
}
func (c *FixtureClient) ProjectIndex(context.Context) (api.IndexData, error) {
	return api.IndexData{}, nil
}
func (c *FixtureClient) ProjectIndexWatchStatus(context.Context) (api.ProjectIndexWatchStatus, error) {
	return api.ProjectIndexWatchStatus{State: "idle"}, nil
}
func (c *FixtureClient) DevtoolsContext(context.Context) (api.DevtoolsContext, error) {
	return api.DevtoolsContext{}, nil
}
func (c *FixtureClient) InsightSilences(context.Context, bool) ([]api.InspectInsightSilenceRecord, error) {
	return nil, nil
}
func (c *FixtureClient) SetInsightStatus(context.Context, string, api.InspectInsightStatusRequest) (api.InspectInsightStatusRecord, error) {
	return api.InspectInsightStatusRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) DeleteRuns(context.Context, []string) (api.InspectDeleteRunsRecord, error) {
	return api.InspectDeleteRunsRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) CreateInsightSilence(context.Context, api.InspectInsightSilenceRequest) (api.InspectInsightSilenceRecord, error) {
	return api.InspectInsightSilenceRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) DeleteInsightSilence(context.Context, string) (api.InspectInsightSilenceRecord, error) {
	return api.InspectInsightSilenceRecord{}, errors.New("fixture client is read-only")
}
