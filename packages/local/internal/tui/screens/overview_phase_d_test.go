package screens

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestProjectOverviewStatsUsesOnlyRealExecutionBuckets(t *testing.T) {
	stats := store.StatsResult{
		TotalExecutions: 4,
		SuccessCount:    3,
		AvgCost:         0.025,
	}
	projection := projectOverviewStats(&stats, []store.TimeseriesBucket{
		{Executions: 2, Errors: 1, AvgDurationMs: 200, TotalCost: 0.02},
		{},
		{Executions: 2, AvgDurationMs: 600, TotalCost: 0.08},
	})

	if projection.PassRate == nil || *projection.PassRate != 0.75 {
		t.Fatalf("pass rate = %v, want stats-derived 0.75", projection.PassRate)
	}
	if projection.CostPer100Runs == nil || *projection.CostPer100Runs != 2.5 {
		t.Fatalf("cost / 100 = %v, want stats-derived 2.5", projection.CostPer100Runs)
	}
	assertFloatSeries(t, "pass", projection.PassRateSeries, []float64{0.5, 1})
	assertFloatSeries(t, "cost", projection.CostSeries, []float64{1, 4})
	assertFloatSeries(t, "latency", projection.LatencySeries, []float64{200, 600})
}

func TestProjectOverviewStatsHidesMissingSeries(t *testing.T) {
	projection := projectOverviewStats(nil, []store.TimeseriesBucket{{}})
	if projection.PassRate != nil || projection.CostPer100Runs != nil ||
		len(projection.PassRateSeries) != 0 || len(projection.CostSeries) != 0 ||
		len(projection.LatencySeries) != 0 {
		t.Fatalf("missing stats produced KPI evidence: %+v", projection)
	}
}

func TestOverviewKPIRowUsesStatsCostAndRendersMeanScore(t *testing.T) {
	overview := NewOverview()
	inspectCost := 99.0
	meanScore := 0.82
	p95 := 900.0
	applyOverviewSummaryForTest(overview, api.InspectOverviewRecord{
		Tag:            "InspectOverviewRecord",
		RunCount:       4,
		InsightCount:   1,
		MeanScore:      &meanScore,
		CostPer100Runs: &inspectCost,
		P95LatencyMs:   &p95,
	})
	applyOverviewStatsForTest(overview, store.StatsResult{
		TotalExecutions: 4,
		SuccessCount:    3,
		AvgCost:         0.025,
	}, []store.TimeseriesBucket{
		{Executions: 2, TotalCost: 0.02, AvgDurationMs: 200},
		{Executions: 2, TotalCost: 0.08, AvgDurationMs: 600},
	})

	rendered := stripANSI(overview.renderKPIStrip(120))
	for _, want := range []string{"MEAN SCORE", "0.82", "$2.50", "+$3.00"} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("KPI row missing %q:\n%s", want, rendered)
		}
	}
	if strings.Contains(rendered, "$99.00") {
		t.Fatalf("cost KPI used Inspect fallback instead of stats evidence:\n%s", rendered)
	}
}

func TestOverviewRecentRunsShowsCountsAndDimsRepeatedSessions(t *testing.T) {
	overview := NewOverview()
	applyOverviewSummaryForTest(overview, api.InspectOverviewRecord{
		Tag:          "InspectOverviewRecord",
		RunCount:     3,
		RunTabCounts: api.InspectRunTabCounts{All: 3, Live: 1, Failures: 1},
	})
	applyOverviewRunsForTest(overview, []api.InspectRunRecord{
		{OperationID: "run-a", TargetID: "first"},
		{OperationID: "run-b", TargetID: "second"},
		{OperationID: "run-c", TargetID: "third"},
	})
	overview.runSessions = map[string]string{
		"run-a": "session_demo_support",
		"run-b": "session_demo_support",
		"run-c": "session_demo_billing",
	}
	overview.runList.SetSize(100, 6)

	rendered := stripANSI(overview.renderRecentRunsBlock(100, 7))
	for _, want := range []string{"all 3 · live 1 · failures 1", "demo_support", "demo_billing"} {
		if !strings.Contains(rendered, want) {
			t.Fatalf("Recent runs missing %q:\n%s", want, rendered)
		}
	}
	if strings.Count(rendered, "demo_support") != 2 {
		t.Fatalf("repeat session label was not retained for visual dimming:\n%s", rendered)
	}
}

func assertFloatSeries(t *testing.T, label string, got, want []float64) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("%s series = %v, want %v", label, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("%s series = %v, want %v", label, got, want)
		}
	}
}
