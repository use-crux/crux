package inspect

import (
	"context"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// OverviewRecordAPI returns the read-only Inspect summary. It derives every
// value from canonical observability runs and Inspect insights; legacy Inspect
// Eval artifacts are read through the dedicated Eval filesystem model.
func (s *Service) OverviewRecordAPI(ctx context.Context, windows ...string) (api.InspectOverviewRecord, error) {
	windowName := "all"
	if len(windows) > 0 {
		windowName = windows[0]
	}
	window := newInspectOverviewWindow(windowName, time.Now().UTC())
	runs, err := s.Runs(ctx)
	if err != nil {
		return api.InspectOverviewRecord{}, err
	}
	runs = filterRunsForOverviewWindow(runs, window)
	insights, err := s.Insights(ctx)
	if err != nil {
		return api.InspectOverviewRecord{}, err
	}

	passRate := runPassRate(runs)
	totalCost := inspectTotalCost(runs)
	var costPer100 *float64
	if len(runs) > 0 {
		value := totalCost / float64(len(runs)) * 100
		costPer100 = &value
	}
	severityCounts := map[string]int{}
	openInsights := 0
	for _, insight := range insights {
		if insight.Status == "" || insight.Status == "open" {
			openInsights++
			severityCounts[insight.Severity]++
		}
	}
	recent := runs
	if len(recent) > 10 {
		recent = recent[:10]
	}
	counts := inspectRunTabCountsFromRuns(runs)
	return api.InspectOverviewRecord{
		Tag:                       "InspectOverview",
		RunCount:                  len(runs),
		InsightCount:              openInsights,
		PassRate:                  passRate,
		MeanScore:                 inspectMeanRunScore(runs),
		TotalCost:                 totalCost,
		P50LatencyMs:              inspectP50Latency(runs),
		P95LatencyMs:              inspectP95Latency(runs),
		CostPer100Runs:            costPer100,
		PassRateHistory:           inspectOverviewPassRateSpark(runs, window),
		OpenInsightsHistory:       inspectOpenInsightsHistory(insights),
		PassRateSpark:             inspectOverviewPassRateSpark(runs, window),
		CostSpark:                 inspectOverviewCostSpark(runs, window),
		LatencySpark:              inspectOverviewLatencySpark(runs, window),
		OpenInsightSeverityCounts: severityCounts,
		RunTabCounts: api.InspectRunTabCounts{
			All: counts.All, Live: counts.Live, Failures: counts.Failures,
		},
		RecentRuns: mustRunRecordsAPI(recent),
	}, nil
}

func runPassRate(runs []inspectRunRecord) *float64 {
	if len(runs) == 0 {
		return nil
	}
	passed := 0
	for _, run := range runs {
		if isPassingRunStatus(run.Status) {
			passed++
		}
	}
	value := float64(passed) / float64(len(runs))
	return &value
}

func mustRunRecordsAPI(runs []inspectRunRecord) []api.InspectRunRecord {
	records, err := toAPI[[]api.InspectRunRecord](runs, nil)
	if err != nil {
		return []api.InspectRunRecord{}
	}
	return records
}
