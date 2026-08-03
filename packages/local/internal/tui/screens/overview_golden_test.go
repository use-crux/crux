package screens

import (
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestOverviewGoldens(t *testing.T) {
	overview, now := fixtureOverview()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	cases := []struct {
		name   string
		width  int
		height int
	}{
		{"overview-160x45", 160, 45},
		{"overview-100x30", 100, 30},
		{"overview-70x24", 70, 24},
		{"overview-empty", 100, 30},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			screen := overview
			if tc.name == "overview-empty" {
				screen = NewOverview()
				setOverviewDataForTest(screen, api.InspectOverviewRecord{Tag: "InspectOverviewRecord"}, nil, nil, nil)
			}
			screen.Resize(Size{Width: tc.width, Height: tc.height})
			uitest.Golden(t, tc.name, screen.View(Size{Width: tc.width, Height: tc.height}))
		})
	}
}

func TestOverviewFuzzResize(t *testing.T) {
	overview, now := fixtureOverview()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()
	uitest.FuzzResize(t, func(width, height int) string {
		overview.Resize(Size{Width: width, Height: height})
		return overview.View(Size{Width: width, Height: height})
	})
}

func TestOverviewLayoutTwoKeepsChartAndActivity(t *testing.T) {
	overview, now := fixtureOverview()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	overview.Resize(Size{Width: 100, Height: 30})
	view := overview.View(Size{Width: 100, Height: 30})
	for _, want := range []string{"Pass rate", "Activity"} {
		if !strings.Contains(view, want) {
			t.Fatalf("100-column Overview should render %q pane, view:\n%s", want, view)
		}
	}
}

func fixtureOverview() (*Overview, time.Time) {
	client := uitest.NewFixtureClient()
	overview, _ := client.Overview(nil)
	stats, _ := client.Stats(nil)
	timeseries, _ := client.StatsTimeseries(nil, overviewStatsBuckets)
	insights, _ := client.Insights(nil)
	runs, _ := client.Runs(nil)
	activity, _ := client.Activity(nil, 12)
	screen := NewOverview()
	setOverviewDataForTest(screen, overview, insights, runs, activity)
	applyOverviewStatsForTest(screen, stats, timeseries)
	return screen, client.Now
}
