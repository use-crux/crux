package uitest

import (
	"context"
	"encoding/json"
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
			Tag:             "QualityInsightRecord",
			InsightID:       "INS-014",
			Title:           "docs_agent loops on retrieval",
			Severity:        "high",
			Tags:            []string{"agent-loop", "retrieval"},
			Summary:         "docs_agent loops 5-16 iterations with duplicate rag.search calls.",
			TargetID:        "docs_agent",
			LinkedTraceIDs:  []string{"8af2f1c"},
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
func (c *FixtureClient) ExperimentSummaries(context.Context) ([]api.QualityExperimentSummary, error) {
	return nil, nil
}
func (c *FixtureClient) ExperimentDetail(context.Context, string) (api.QualityExperimentDetail, bool, error) {
	return api.QualityExperimentDetail{}, false, nil
}
func (c *FixtureClient) PromotedBaselines(context.Context) ([]api.QualityPromotedBaseline, error) {
	return nil, nil
}
func (c *FixtureClient) CassetteFiles(context.Context) ([]api.QualityCassetteFileRecord, error) {
	return nil, nil
}
func (c *FixtureClient) ScorerStats(context.Context) ([]api.QualityScorerStats, error) {
	return nil, nil
}
func (c *FixtureClient) Feedback(context.Context) ([]api.QualityFeedbackRecord, error) {
	return nil, nil
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

func (c *FixtureClient) fixtureRunSpans(traceID string) []api.QualityRunSpan {
	start := c.Now.Add(-14 * time.Minute).UnixMilli()
	cost := 0.044
	return []api.QualityRunSpan{
		{
			ID:         "root",
			Kind:       "agent",
			Op:         "agent",
			Primitive:  api.SpanPrimitiveAgent,
			Name:       "docs_agent.run",
			Status:     "failed",
			StartedAt:  start,
			DurationMs: floatPtr(14_200),
			TokenCount: 18_400,
			Cost:       &cost,
			Attributes: map[string]string{
				"agent.name":     "docs_agent",
				"agent.iter.max": "16",
			},
			LinkedInsightIDs: []string{"INS-014"},
		},
		{
			ID:         "plan",
			ParentID:   "root",
			Kind:       "llm",
			Op:         "llm",
			Primitive:  api.SpanPrimitiveGeneration,
			Name:       "plan",
			Status:     "ok",
			StartedAt:  start + 180,
			DurationMs: floatPtr(620),
		},
		{
			ID:         "retrieve",
			ParentID:   "root",
			Kind:       "agent",
			Op:         "agent",
			Primitive:  api.SpanPrimitiveAgent,
			Name:       "retrieve (loop · 16)",
			Status:     "failed",
			StartedAt:  start + 680,
			DurationMs: floatPtr(9_800),
			TokenCount: 14_820,
			Cost:       &cost,
			Attributes: map[string]string{
				"agent.iter.actual": "16",
				"agent.stop.reason": "novelty<0.05",
				"retriever.k":       "4",
			},
			LinkedInsightIDs: []string{"INS-014", "INS-013"},
		},
		fixtureToolSpan("search-1", "retrieve", traceID, start+900, 540, false),
		fixtureToolSpan("search-2", "retrieve", traceID, start+1_540, 580, true),
		fixtureToolSpan("search-3", "retrieve", traceID, start+2_180, 620, true),
		fixtureToolSpan("search-4", "retrieve", traceID, start+2_860, 600, true),
		{
			ID:         "synthesize",
			ParentID:   "root",
			Kind:       "llm",
			Op:         "llm",
			Primitive:  api.SpanPrimitiveGeneration,
			Name:       "synthesize",
			Status:     "ok",
			StartedAt:  start + 10_800,
			DurationMs: floatPtr(3_200),
		},
		{
			ID:         "verify",
			ParentID:   "root",
			Kind:       "tool",
			Op:         "tool",
			Primitive:  api.SpanPrimitiveTool,
			Name:       "verify_citations",
			Status:     "ok",
			StartedAt:  start + 13_900,
			DurationMs: floatPtr(420),
		},
	}
}

func fixtureToolSpan(id, parentID, traceID string, startedAt int64, duration float64, dup bool) api.QualityRunSpan {
	data, _ := json.Marshal(map[string]any{
		"toolName": "rag.search",
		"args": map[string]any{
			"query": "typed prompts",
			"k":     4,
		},
		"result": map[string]any{"hits": []string{"typed-prompts-definition", "prompt-api"}},
	})
	span := api.QualityRunSpan{
		ID:                id,
		ParentID:          parentID,
		Kind:              "tool",
		Op:                "tool",
		Primitive:         api.SpanPrimitiveTool,
		Name:              `rag.search "typed prompts"`,
		Status:            "ok",
		StartedAt:         startedAt,
		DurationMs:        &duration,
		Duplicate:         dup,
		DuplicateOfSpanID: "rag.search:typed-prompts",
		Attributes: map[string]string{
			"trace.id":    traceID,
			"retriever.k": "4",
		},
		Data: data,
	}
	if dup {
		span.LinkedInsightIDs = []string{"INS-014"}
	}
	return span
}

func floatPtr(v float64) *float64 {
	return &v
}
