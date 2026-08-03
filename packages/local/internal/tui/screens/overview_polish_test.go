package screens

import (
	"image/color"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func TestDeltaColorUsesMetricFavorableDirection(t *testing.T) {
	for _, test := range []struct {
		name      string
		change    float64
		favorable favorableDirection
		want      color.Color
	}{
		{name: "pass rate up", change: 1, favorable: favorableUp, want: shell.ColorGreen},
		{name: "pass rate down", change: -1, favorable: favorableUp, want: shell.ColorRose},
		{name: "cost down", change: -1, favorable: favorableDown, want: shell.ColorGreen},
		{name: "cost up", change: 1, favorable: favorableDown, want: shell.ColorRose},
		{name: "neutral", change: 0, favorable: favorableDown, want: shell.ColorAmber},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := deltaColor(test.change, test.favorable); got != test.want {
				t.Fatalf("deltaColor() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestPassRateHistoryDoesNotUseSyntheticSpark(t *testing.T) {
	current := 0.88
	summary := api.InspectOverviewRecord{PassRate: &current}
	if got := passRateHistory(summary); len(got) != 0 {
		t.Fatalf("passRateHistory() invented history: %v", got)
	}
}

func TestOverviewRowsPreferHumanNames(t *testing.T) {
	overview := NewOverview()
	applyOverviewInsightsForTest(overview, []api.InspectInsightRecord{{
		InsightID: "run-suspended-run_demo_support_approval",
		Title:     "Run is waiting on a suspension",
		Tags:      []string{"Flow"},
	}})
	applyOverviewRunsForTest(overview, []api.InspectRunRecord{{
		OperationID: "run_demo_support_approval",
		TargetID:    "Refund exception · approval",
	}})
	overview.runNames = map[string]string{
		"run_demo_support_approval": "Refund exception · named run",
	}
	overview.insightList.SetSize(90, 3)
	overview.runList.SetSize(90, 3)

	insights := stripANSI(overview.renderInsightsBlock(90, 6))
	if !strings.Contains(insights, "Run is waiting on a suspension") || strings.Contains(insights, "run-suspended") {
		t.Fatalf("Overview insight row did not prefer title:\n%s", insights)
	}
	runs := stripANSI(overview.renderRecentRunsBlock(90, 6))
	if !strings.Contains(runs, "Refund excep") || !strings.Contains(runs, "named run") || strings.Contains(runs, "run_demo") {
		t.Fatalf("Overview run row did not prefer human name:\n%s", runs)
	}
}
