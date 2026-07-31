package uitest

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
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
	meanScore := 0.82
	cost := 2.41
	p95 := 12_700.0
	return api.InspectOverviewRecord{
		Tag:                       "InspectOverviewRecord",
		RunCount:                  42,
		InsightCount:              8,
		PassRate:                  &pass,
		MeanScore:                 &meanScore,
		CostPer100Runs:            &cost,
		P95LatencyMs:              &p95,
		PassRateHistory:           []float64{0.96, 0.94, 0.91, 0.88},
		OpenInsightsHistory:       []int{2, 4, 5, 8},
		OpenInsightSeverityCounts: map[string]int{"high": 3, "medium": 3, "low": 2},
		RunTabCounts:              api.InspectRunTabCounts{All: 42, Live: 2, Failures: 3},
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
			Tag:           "InspectRunRecord",
			OperationID:   "8af2f1c",
			TraceID:       "8af2f1c",
			TargetID:      "docs_agent",
			RootPrimitive: "agent.run",
			Kind:          "agent",
			Status:        "failed",
			StartedAt:     c.Now.Add(-14 * time.Minute).UnixMilli(),
			DurationMs:    &duration,
			Model:         "gpt-5",
			TokenCount:    18_400,
			Cost:          &cost,
			Score:         &score,
			SpanCount:     24,
			SessionID:     "session_docs",
		},
	}
}

func (c *FixtureClient) RunsWithOptions(ctx context.Context, opts api.InspectRunsOptions) ([]api.InspectRunRecord, error) {
	runs, err := c.Runs(ctx)
	if err != nil {
		return nil, err
	}
	filtered := runs[:0]
	for _, run := range runs {
		if len(opts.Status) > 0 && !containsFixtureValue(opts.Status, run.Status) {
			continue
		}
		if len(opts.Model) > 0 && !containsFixtureValue(opts.Model, run.Model) {
			continue
		}
		if len(opts.Session) > 0 && !containsFixtureValue(opts.Session, run.SessionID) {
			continue
		}
		if opts.Since > 0 && run.StartedAt < opts.Since {
			continue
		}
		if opts.Until > 0 && run.StartedAt > opts.Until {
			continue
		}
		filtered = append(filtered, run)
	}
	return filtered, nil
}
func (c *FixtureClient) ObservabilityRuns(context.Context) ([]api.ObservabilityRunSummary, error) {
	return nil, nil
}
func (c *FixtureClient) ObservabilityRunsPage(context.Context, ...string) (api.ObservabilityRunsPage, error) {
	runs := c.fixtureRuns()
	rows := make([]api.ObservabilityRunSummary, 0, len(runs))
	for _, run := range runs {
		rows = append(rows, inspectRunSummary(run))
	}
	return api.ObservabilityRunsPage{Rows: rows}, nil
}
func (c *FixtureClient) ObservabilityRunsPageWithOptions(
	ctx context.Context,
	opts api.InspectRunsOptions,
	definitionID ...string,
) (api.ObservabilityRunsPage, error) {
	page, err := c.ObservabilityRunsPage(ctx, definitionID...)
	if err != nil {
		return page, err
	}
	rows := page.Rows[:0]
	for _, run := range page.Rows {
		startedAt := parseFixtureTime(run.StartedAt)
		if len(opts.Status) > 0 && !containsFixtureValue(opts.Status, run.Status) {
			continue
		}
		if len(opts.Model) > 0 && !containsFixtureValue(opts.Model, run.Model) {
			continue
		}
		if len(opts.Session) > 0 && !containsFixtureValue(opts.Session, run.SessionID) {
			continue
		}
		if opts.Since > 0 && startedAt < opts.Since {
			continue
		}
		if opts.Until > 0 && startedAt > opts.Until {
			continue
		}
		rows = append(rows, run)
	}
	page.Rows = rows
	return page, nil
}
func (c *FixtureClient) Sessions(context.Context) ([]store.SessionInfo, error) {
	return []store.SessionInfo{{
		SessionID:      "session_docs",
		TraceCount:     1,
		StartedAt:      c.Now.Add(-14 * time.Minute).UnixMilli(),
		LastActivityAt: c.Now.UnixMilli(),
	}}, nil
}
func (c *FixtureClient) Stats(context.Context) (store.StatsResult, error) {
	return store.StatsResult{
		TotalExecutions: 42,
		SuccessCount:    37,
		ErrorCount:      3,
		RunningCount:    2,
		AvgDurationMs:   7_415,
		TotalCost:       1.0122,
		AvgCost:         0.0241,
		ErrorRate:       3.0 / 42.0,
	}, nil
}
func (c *FixtureClient) StatsTimeseries(_ context.Context, requested int) ([]store.TimeseriesBucket, error) {
	executions := []int{4, 5, 4, 6, 5, 6, 6, 6}
	errors := []int{0, 0, 1, 0, 1, 0, 0, 1}
	durations := []float64{4_200, 5_100, 6_200, 7_800, 6_900, 8_700, 7_400, 9_300}
	costs := []float64{0.055, 0.08, 0.095, 0.13, 0.115, 0.17, 0.16, 0.2072}
	buckets := make([]store.TimeseriesBucket, len(executions))
	for i := range buckets {
		buckets[i] = store.TimeseriesBucket{
			T:             c.Now.Add(time.Duration(i-len(buckets)+1) * time.Hour).UnixMilli(),
			Executions:    executions[i],
			Errors:        errors[i],
			AvgDurationMs: durations[i],
			TotalCost:     costs[i],
		}
	}
	if requested <= 0 {
		return nil, nil
	}
	if requested < len(buckets) {
		buckets = buckets[len(buckets)-requested:]
	}
	return buckets, nil
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

func inspectRunSummary(run api.InspectRunRecord) api.ObservabilityRunSummary {
	metricValues := map[string]any{}
	if run.TokenCount > 0 {
		metricValues["totalTokens"] = run.TokenCount
	}
	if run.Cost != nil {
		metricValues["costUsd"] = *run.Cost
	}
	var metrics json.RawMessage
	if len(metricValues) > 0 {
		metrics, _ = json.Marshal(metricValues)
	}
	return api.ObservabilityRunSummary{
		RunID:         firstFixtureValue(run.OperationID, run.TraceID),
		OperationID:   firstFixtureValue(run.OperationID, run.TraceID),
		TraceID:       run.TraceID,
		SessionID:     run.SessionID,
		Name:          run.TargetID,
		RootPrimitive: run.RootPrimitive,
		Status:        run.Status,
		StartedAt:     time.UnixMilli(run.StartedAt).UTC().Format(time.RFC3339Nano),
		DurationMs:    valueOrZero(run.DurationMs),
		Model:         run.Model,
		Provider:      run.Provider,
		SpanCount:     run.SpanCount,
		Metrics:       metrics,
	}
}

func parseFixtureTime(value string) int64 {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return parsed.UnixMilli()
}

func containsFixtureValue(values []string, candidate string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), candidate) {
			return true
		}
	}
	return false
}

func firstFixtureValue(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func valueOrZero[T int | float64](value *T) T {
	if value == nil {
		return 0
	}
	return *value
}
