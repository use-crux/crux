package uitest

import (
	"context"
	"errors"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// FixtureClient serves deterministic quality data for TUI render tests.
type FixtureClient struct {
	Now time.Time
}

// NewFixtureClient returns the standard mockup-shaped fixture client.
func NewFixtureClient() *FixtureClient {
	return &FixtureClient{Now: time.UnixMilli(1_778_790_044_000).UTC()}
}

func (c *FixtureClient) Overview(context.Context) (api.QualityOverviewRecord, error) {
	pass := 0.88
	latest := 0.96
	cost := 2.41
	p95 := 12_700.0
	return api.QualityOverviewRecord{
		Tag:                        "QualityOverviewRecord",
		RunCount:                   42,
		ExperimentCount:            4,
		BaselineCount:              3,
		FeedbackCount:              6,
		FeedbackNeedingReviewCount: 2,
		CassetteCount:              98,
		StaleCassetteCount:         5,
		InsightCount:               8,
		LatestExperimentID:         "exp-043",
		LatestExperimentPassRate:   &latest,
		PassRate:                   &pass,
		CostPer100Runs:             &cost,
		P95LatencyMs:               &p95,
		PassRateHistory:            []float64{0.96, 0.94, 0.91, 0.88},
		OpenInsightsHistory:        []int{2, 4, 5, 8},
		CostSpark:                  []float64{0.55, 0.82, 1.76, 2.41},
		LatencySpark:               []float64{4400, 6100, 9800, 12700},
		OpenInsightSeverityCounts:  map[string]int{"high": 3, "medium": 3, "low": 2},
		RecentRuns:                 c.fixtureRuns(),
	}, nil
}

func (c *FixtureClient) Insights(context.Context) ([]api.QualityInsightRecord, error) {
	return []api.QualityInsightRecord{
		{
			Tag:            "QualityInsightRecord",
			InsightID:      "INS-014",
			Title:          "docs_agent loops on retrieval",
			Severity:       "high",
			Tags:           []string{"agent-loop", "retrieval"},
			Summary:        "docs_agent loops 5-16 iterations with duplicate rag.search calls.",
			TargetID:       "docs_agent",
			LinkedTraceIDs: []string{"8af2f1c"},
			LinkedCaseIDs:  []string{"rag/typed_prompts_definition"},
			SuspectedCause: "docs_agent.run\n  retrieve(loop x16) hits=10 dup .94\n    rag.search repeats the same query after novelty drops below 0.2",
			ProposedFixConfig: &api.QualityInsightFixConfig{
				YAML: "agent.retrieve.maxIterations: 3\nretrieval.dedupe.embedding: 0.92\nearlyStop.novelDocsRatio: 0.2\n# approx 85% fewer tokens",
				ConfigKeys: []string{
					"agent.retrieve.maxIterations",
					"retrieval.dedupe.embedding",
					"earlyStop.novelDocsRatio",
				},
			},
			DetailStats: &api.QualityInsightDetailStats{
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

func (c *FixtureClient) Runs(context.Context) ([]api.QualityRunRecord, error) {
	return c.fixtureRuns(), nil
}

func (c *FixtureClient) Activity(_ context.Context, limit int) ([]api.QualityActivityEvent, error) {
	items := []api.QualityActivityEvent{
		{Tag: "QualityActivityEvent", Timestamp: c.Now.UnixMilli(), Kind: "insight", Severity: "error", Summary: "INS-014 high agent-loop opened", RefID: "INS-014"},
		{Tag: "QualityActivityEvent", Timestamp: c.Now.Add(-2 * time.Minute).UnixMilli(), Kind: "run", Severity: "info", Summary: "trace 8af2f1c completed", RefID: "8af2f1c"},
	}
	if limit > 0 && len(items) > limit {
		return items[:limit], nil
	}
	return items, nil
}

func (c *FixtureClient) fixtureRuns() []api.QualityRunRecord {
	duration := 14_200.0
	cost := 0.044
	score := 0.88
	return []api.QualityRunRecord{
		{
			Tag:        "QualityRunRecord",
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

func (c *FixtureClient) RunsWithOptions(ctx context.Context, _ api.QualityRunsOptions) ([]api.QualityRunRecord, error) {
	return c.Runs(ctx)
}
func (c *FixtureClient) RunDetail(_ context.Context, traceID string) (api.QualityRunDetailRecord, bool, error) {
	if traceID != "8af2f1c" {
		return api.QualityRunDetailRecord{}, false, nil
	}
	run := c.fixtureRuns()[0]
	return api.QualityRunDetailRecord{
		Tag: "QualityRunDetailRecord",
		Run: run,
		Trace: api.QualityTraceRecord{
			TraceID:    run.TraceID,
			StartedAt:  c.Now.Add(-14 * time.Minute).UnixMilli(),
			Model:      "gpt-5",
			Provider:   "openai",
			DurationMs: run.DurationMs,
			Status:     run.Status,
		},
		Spans: c.fixtureRunSpans(run.TraceID),
	}, true, nil
}
func (c *FixtureClient) ObservabilityRuns(context.Context) ([]api.ObservabilityRunSummary, error) {
	return nil, nil
}
func (c *FixtureClient) ObservabilityRunDetail(context.Context, string) (api.ObservabilityRunDetail, bool, error) {
	return api.ObservabilityRunDetail{}, false, nil
}
func (c *FixtureClient) ObservabilityResourceActivity(context.Context, string) ([]api.ObservabilityResourceActivity, error) {
	return nil, nil
}
func (c *FixtureClient) ProjectIndex(context.Context) (api.IndexData, error) {
	return api.IndexData{}, nil
}
func (c *FixtureClient) PromotedBaselines(context.Context) ([]api.QualityPromotedBaseline, error) {
	return c.fixtureBaselines(), nil
}
func (c *FixtureClient) CassetteFiles(context.Context) ([]api.QualityCassetteFileRecord, error) {
	return c.fixtureCassettes(), nil
}
func (c *FixtureClient) ScorerStats(context.Context) ([]api.QualityScorerStats, error) {
	return nil, nil
}
func (c *FixtureClient) Feedback(context.Context) ([]api.QualityFeedbackRecord, error) {
	return c.fixtureFeedback(), nil
}
func (c *FixtureClient) DevtoolsContext(context.Context) (api.DevtoolsContext, error) {
	return api.DevtoolsContext{}, nil
}
func (c *FixtureClient) SubscribeQuality(ctx context.Context) <-chan api.QualityEvent {
	ch := make(chan api.QualityEvent)
	go func() {
		<-ctx.Done()
		close(ch)
	}()
	return ch
}
func (c *FixtureClient) InsightSilences(context.Context, bool) ([]api.QualityInsightSilenceRecord, error) {
	return nil, nil
}
func (c *FixtureClient) SetInsightStatus(context.Context, string, api.QualityInsightStatusRequest) (api.QualityInsightStatusRecord, error) {
	return api.QualityInsightStatusRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) CreateFeedbackAnnotation(context.Context, api.QualityFeedbackAnnotationPostRequest) (api.QualityFeedbackAnnotationRecord, error) {
	return api.QualityFeedbackAnnotationRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) DeleteRuns(context.Context, []string) (api.QualityDeleteRunsRecord, error) {
	return api.QualityDeleteRunsRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) CreateInsightSilence(context.Context, api.QualityInsightSilenceRequest) (api.QualityInsightSilenceRecord, error) {
	return api.QualityInsightSilenceRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) DeleteInsightSilence(context.Context, string) (api.QualityInsightSilenceRecord, error) {
	return api.QualityInsightSilenceRecord{}, errors.New("fixture client is read-only")
}
func (c *FixtureClient) PromoteBaseline(context.Context, string, string, string) (api.QualityPromoteResult, error) {
	return api.QualityPromoteResult{}, errors.New("fixture client is read-only")
}
